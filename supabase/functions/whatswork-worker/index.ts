// WhatsWork background worker
// - "cron" (every 5 min): the 9 am and 8 pm briefings across all calendars, and the Sunday evening review
// - "test_push", "quick_add", "review_now": called from the app by a signed-in user
// - "health": posted by the iPhone Shortcut with an x-health-token header
// - "message" / "task": kept for the old chat; nothing sends these any more
import postgres from "npm:postgres@3.4.5";
import webpush from "npm:web-push@3.6.7";
import { WWCore, normaliseState } from "https://cdn.jsdelivr.net/gh/Ateebhassan/whatswork@81c4e90/core.mjs";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 3 });
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

let cfg: Record<string, string> | null = null;
async function config() {
  if (cfg) return cfg;
  const rows = await sql`select key, value from private.app_config where key not like 'pdigest:%'`;
  cfg = Object.fromEntries(rows.map((r: any) => [r.key, r.value]));
  webpush.setVapidDetails(cfg.vapid_subject, cfg.vapid_public, cfg.vapid_private);
  return cfg;
}

// ---------- PUSH ----------
async function pushTo(userIds: string[], payload: Record<string, unknown>) {
  if (!userIds.length) return 0;
  await config();
  const subs = await sql`select id, endpoint, p256dh, auth from public.push_subscriptions where user_id = any(${userIds}::uuid[])`;
  let sent = 0;
  await Promise.all(subs.map(async (s: any) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        { TTL: 60 * 60 * 6 },
      );
      sent++;
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) await sql`delete from public.push_subscriptions where id = ${s.id}`;
      else console.error("push failed", e?.statusCode, e?.body ?? e?.message);
    }
  }));
  return sent;
}

// ---------- BRIEFINGS (9 am: today, 8 pm: tomorrow) ----------
function localParts(tz: string) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}
async function exists(rel: string) {
  const [r] = await sql`select to_regclass(${rel}) is not null as ok`;
  return !!r?.ok;
}

/* Everything one person's briefing needs, read straight from the database. */
async function contextFor(uid: string, day: string, hasCal: boolean) {
  const W = WWCore as any;
  const docs = await sql`select name, json from public.planner_docs where user_id = ${uid}`;
  let planner = null; const tracks: Record<string, any> = {};
  for (const d of docs as any[]) {
    try { const j = JSON.parse(d.json); if (d.name === "main") planner = normaliseState(j); else tracks[d.name.slice(6)] = j; } catch { /* skip a broken record */ }
  }
  let calendars: any[] = [], events: any[] = [], postStatus: Record<string, any> = {};
  if (hasCal) {
    calendars = (await sql`select * from public.calendars where user_id = ${uid} and not archived order by sort`) as any[];
    events = (await sql`select id, calendar_id, title, kind, to_char(date,'YYYY-MM-DD') as date,
      to_char(start_time,'HH24:MI') as start_time, to_char(end_time,'HH24:MI') as end_time, repeat, repeat_days,
      to_char(repeat_until,'YYYY-MM-DD') as repeat_until, (select array_agg(to_char(x,'YYYY-MM-DD')) from unnest(skip_dates) x) as skip_dates
      from public.events where user_id = ${uid}`) as any[];
    for (const r of (await sql`select * from public.post_status where user_id = ${uid}`) as any[]) (postStatus[r.calendar_id] ??= {})[r.item_key] = r;
  }
  if (!calendars.length) calendars = W.fallbackCalendars();
  const occs = W.occurrences(events, calendars, W.addDays(day, -1), W.addDays(day, 1));
  return { planner, tracks, calendars, postStatus, occs };
}

async function briefings() {
  const W = WWCore as any;
  const hasCal = await exists("public.calendars");
  const [tzCol] = await sql`select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'tz') as ok`;
  const users = hasCal
    ? await sql`select distinct user_id as id from public.calendars union select distinct user_id from public.planner_docs`
    : await sql`select distinct user_id as id from public.planner_docs`;
  let sent = 0;
  for (const u of users as any[]) {
    try {
      let tz = "Asia/Karachi";
      if (tzCol?.ok) { const [p] = await sql`select tz from public.profiles where id = ${u.id}`; if (p?.tz) tz = p.tz; }
      const { date, hour } = localParts(tz);
      const slot = hour >= 9 && hour < 12 ? "am" : hour >= 20 && hour < 23 ? "pm" : null;
      if (!slot) continue;
      const key = `pdigest:${slot}:${u.id}`;
      const [prev] = await sql`select value from private.app_config where key = ${key}`;
      if (prev?.value === date) continue;
      await sql`insert into private.app_config (key, value) values (${key}, ${date}) on conflict (key) do update set value = excluded.value`;
      const day = slot === "am" ? date : W.addDays(date, 1);
      const b = W.briefing(day, slot, await contextFor(u.id, day, hasCal));
      if (!b) continue;
      sent += await pushTo([u.id], { title: b.title, body: b.body, tag: `brief-${slot}`, url: `./?d=${day}` });
    } catch (e) { console.error("briefing", u.id, e); }
  }
  return sent;
}

async function cron() {
  const sent = await briefings();
  const reviews = await weeklyReviews();
  return { briefings: sent, reviews };
}

// ---------- AI (your saved provider and key) ----------
async function callAI(provider: string, model: string, key: string, system: string, user: string, maxTokens = 1200): Promise<string> {
  if (provider === "gemini") {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.2 } }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error?.message ?? `Gemini error ${r.status}`);
    return (j.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("");
  }
  if (provider === "claude") {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error?.message ?? `Claude error ${r.status}`);
    return (j.content ?? []).map((c: any) => c.text ?? "").join("");
  }
  const base = provider === "openrouter" ? "https://openrouter.ai/api/v1" : "https://api.openai.com/v1";
  const body: any = { model, messages: [{ role: "system", content: system }, { role: "user", content: user }] };
  if (provider === "openai") body.response_format = { type: "json_object" };
  const r = await fetch(`${base}/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message ?? `${provider} error ${r.status}`);
  return j.choices?.[0]?.message?.content ?? "";
}
function firstJson(text: string): any {
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s < 0 || e < 0) throw new Error("The AI didn't answer in the expected format");
  return JSON.parse(text.slice(s, e + 1));
}
async function aiSettings(uid: string) {
  const [st] = await sql`select enabled, provider, model, api_key from private.ai_settings where user_id = ${uid}`;
  if (!st?.enabled || !st.api_key || !st.model) throw new Error("AI is off. Turn it on in Settings.");
  return st;
}

// ---------- QUICK ADD ----------
const QUICK_SYSTEM = `You turn one short note into one calendar entry for a planner app.
Answer ONLY with JSON: {"title": string, "calendar": string, "kind": string, "date": "YYYY-MM-DD", "start": "HH:MM" or null, "end": "HH:MM" or null, "repeat": "none"|"daily"|"weekly", "repeat_days": [numbers 0-6, 0 = Sunday]}
Rules:
- title: short and clear, without the date or time words (e.g. "Meeting with Sam").
- calendar: exactly one of the calendar names given. Pick by meaning (a client, a college, a job). If nothing fits, use the personal calendar.
- kind: one of sleep, shift, university, work, meeting, call, personal, post. A "post" is an all-day social media post with start and end null.
- date: work it out from today's date given. A weekday name means the next one coming (today if it is that weekday and the time has not passed). "next Thursday" said on a Thursday means a week later.
- times are 24-hour local time. If a time has no am/pm, choose the sensible one: this person works night shifts, so late-evening times are common. If no end time, meetings and work last 1 hour, calls 30 minutes.
- If the note says "every day" use repeat "daily"; "every Monday and Wednesday" use "weekly" with those days.`;

async function quickAdd(uid: string, text: string, today: string, now: string) {
  const st = await aiSettings(uid);
  const cals = await sql`select name, short_name, billing, kind from public.calendars where user_id = ${uid} and not archived order by sort`;
  const wd = new Date(today + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
  const user = `Today is ${wd} ${today}. The time now is ${now}.
Calendars: ${(cals as any[]).map((c) => `${c.name}${c.short_name ? ` (also called ${c.short_name})` : ""}${c.billing === "personal" ? " [personal]" : ""}${c.kind === "planner" ? " [college social media]" : ""}`).join("; ")}.
Note: ${String(text).slice(0, 300)}`;
  return firstJson(await callAI(st.provider, st.model, st.api_key, QUICK_SYSTEM, user, 400));
}

// ---------- HEALTH (from the iPhone Shortcut) ----------
async function sha256hex(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function tzOf(uid: string) {
  try { const [p] = await sql`select tz from public.profiles where id = ${uid}`; return p?.tz || "Asia/Karachi"; } catch { return "Asia/Karachi"; }
}
function localDateOf(iso: string, tz: string) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  return f.format(new Date(iso));
}
/* Shortcuts can send dates in a few shapes; accept ISO 8601 and "YYYY-MM-DD HH:MM". */
function parseWhen(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  let t = v.trim().replace(/^(\d{4}-\d{2}-\d{2}) (\d{1,2}:\d{2})/, "$1T$2");
  const d = new Date(t);
  return isNaN(d.getTime()) ? null : d.toISOString();
}
async function healthFromShortcut(token: string, body: any) {
  const hash = await sha256hex(token.trim());
  const [row] = await sql`select user_id from private.health_tokens where token_hash = ${hash}`;
  if (!row) return { ok: false, error: "This Shortcut's key isn't recognised. Make a new key in WhatsWork (Review tab, Sleep, Set up iPhone Shortcut)." };
  const uid = row.user_id, tz = await tzOf(uid);
  const start = parseWhen(body.sleep_start), end = parseWhen(body.sleep_end);
  const asleep = Number.isFinite(+body.asleep_minutes) && body.asleep_minutes !== "" && body.asleep_minutes != null ? Math.round(+body.asleep_minutes) : null;
  const screen = Number.isFinite(+body.screen_minutes) && body.screen_minutes !== "" && body.screen_minutes != null ? Math.round(+body.screen_minutes) : null;
  if (!end && asleep == null && screen == null) return { ok: false, error: "No sleep found. Check the Shortcut finds Sleep samples from the last day." };
  if (start && end) {
    const mins = (Date.parse(end) - Date.parse(start)) / 60000;
    if (mins <= 0 || mins > 20 * 60) return { ok: false, error: "The sleep times look wrong (start must be before end, under 20 hours)." };
  }
  const date = end ? localDateOf(end, tz) : (typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : localParts(tz).date);
  await sql`insert into public.health_days (user_id, date, sleep_start, sleep_end, asleep_minutes, screen_minutes, source, updated_at)
    values (${uid}, ${date}, ${start}, ${end}, ${asleep != null ? Math.max(0, Math.min(1440, asleep)) : null}, ${screen != null ? Math.max(0, Math.min(1440, screen)) : null}, 'shortcut', now())
    on conflict (user_id, date) do update set
      sleep_start = coalesce(excluded.sleep_start, public.health_days.sleep_start), sleep_end = coalesce(excluded.sleep_end, public.health_days.sleep_end),
      asleep_minutes = coalesce(excluded.asleep_minutes, public.health_days.asleep_minutes), screen_minutes = coalesce(excluded.screen_minutes, public.health_days.screen_minutes),
      source = 'shortcut', updated_at = now()`;
  await sql`update private.health_tokens set last_used = now() where user_id = ${uid}`;
  const W = WWCore as any;
  const mins = asleep ?? (start && end ? Math.round((Date.parse(end) - Date.parse(start)) / 60000) : null);
  return { ok: true, date, slept: mins != null ? W.fmtDur(mins) : null };
}

// ---------- REVIEWS ----------
const REVIEW_SYSTEM = `You write a short weekly review for one person's planner app. Use ONLY the facts given; never invent events, people or numbers.
Write in plain, friendly English with short sentences. Be concrete: name the day, time, calendar and what to do.
Answer ONLY with JSON: {"title": string (at most 8 words), "summary": string (one sentence), "items": [{"type": "warning" | "tip" | "win", "text": string (one or two sentences)}]}
Give 3 to 6 items, most urgent first: clashes and short sleep first, then posts that aren't scheduled, then unpaid hours (name them and how many hours), then sleep and screen time, then one thing that went well if there is one.`;

async function reviewInput(uid: string, today: string) {
  const W = WWCore as any;
  const ctx = await contextFor(uid, today, await exists("public.calendars"));
  const events = (await exists("public.events")) ? await sql`select id, calendar_id, title, kind, to_char(date,'YYYY-MM-DD') as date,
      to_char(start_time,'HH24:MI') as start_time, to_char(end_time,'HH24:MI') as end_time, repeat, repeat_days,
      to_char(repeat_until,'YYYY-MM-DD') as repeat_until, (select array_agg(to_char(x,'YYYY-MM-DD')) from unnest(skip_dates) x) as skip_dates
      from public.events where user_id = ${uid}` : [];
  const health = await sql`select to_char(date,'YYYY-MM-DD') as date, sleep_start, sleep_end, asleep_minutes from public.health_days where user_id = ${uid} and date >= ${W.addDays(today, -14)}::date`;
  const screen = await sql`select to_char(week_start,'YYYY-MM-DD') as week_start, screen_avg_minutes from public.health_weeks where user_id = ${uid} and screen_avg_minutes is not null order by week_start desc limit 6`;
  return { today, calendars: ctx.calendars, events, planner: ctx.planner, tracks: ctx.tracks, postStatus: ctx.postStatus,
    health: (health as any[]).map((h) => ({ ...h, sleep_start: h.sleep_start ? new Date(h.sleep_start).toISOString() : null, sleep_end: h.sleep_end ? new Date(h.sleep_end).toISOString() : null })),
    screen };
}
function cleanItems(items: any): { type: string; text: string }[] {
  if (!Array.isArray(items)) return [];
  return items.filter((i) => i && typeof i.text === "string" && i.text.trim())
    .map((i) => ({ type: ["warning", "tip", "win"].includes(i.type) ? i.type : "tip", text: String(i.text).trim().slice(0, 400) })).slice(0, 8);
}
async function writeReview(uid: string, kind: "weekly" | "on_demand") {
  const W = WWCore as any;
  const tz = await tzOf(uid), today = localParts(tz).date;
  const base = W.buildReview(await reviewInput(uid, today));
  let row = { title: base.title, summary: base.summary, items: base.items, source: "rules", model: null as string | null, note: "" };
  try {
    const st = await aiSettings(uid);
    const out = firstJson(await callAI(st.provider, st.model, st.api_key, REVIEW_SYSTEM,
      `Facts:\n${JSON.stringify(base.facts)}\n\nPoints found by simple rules (use them, improve the wording, add anything they missed):\n${base.items.map((i: any) => "- " + i.text).join("\n")}`, 1200));
    const items = cleanItems(out.items);
    if (items.length) row = { title: String(out.title || base.title).slice(0, 120), summary: String(out.summary || base.summary).slice(0, 600), items, source: "ai", model: `${st.provider}: ${st.model}`, note: "" };
  } catch (e: any) { row.note = String(e?.message ?? e); }
  const [saved] = await sql`insert into public.reviews (user_id, period_start, period_end, kind, source, model, title, summary, items)
    values (${uid}, ${base.period_start}, ${base.period_end}, ${kind}, ${row.source}, ${row.model}, ${row.title}, ${row.summary}, ${sql.json(row.items)})
    returning id, title, summary, items, source, created_at`;
  return { review: saved, aiNote: row.source === "rules" ? row.note : "" };
}
/* Sunday between 7 and 11 pm local: one review a week, then a notification. */
async function weeklyReviews() {
  if (!(await exists("public.reviews"))) return 0;
  const W = WWCore as any;
  const users = await sql`select distinct user_id as id from public.calendars`;
  let n = 0;
  for (const u of users as any[]) {
    try {
      const tz = await tzOf(u.id), { date, hour } = localParts(tz);
      if (W.weekday(W.dnum(date)) !== 0 || hour < 19 || hour >= 23) continue;
      const key = `review:week:${u.id}`;
      const [prev] = await sql`select value from private.app_config where key = ${key}`;
      if (prev?.value === date) continue;
      await sql`insert into private.app_config (key, value) values (${key}, ${date}) on conflict (key) do update set value = excluded.value`;
      const { review } = await writeReview(u.id, "weekly");
      const first = (review.items || [])[0]?.text || review.summary || "";
      await pushTo([u.id], { title: "📝 Your weekly review is ready", body: first.slice(0, 180), tag: "review", url: "./?review=1" });
      n++;
    } catch (e) { console.error("weekly review", u.id, e); }
  }
  return n;
}

// ---------- AUTH ----------
async function signedInUser(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization");
  const apikey = req.headers.get("apikey");
  if (!auth || !apikey) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: auth, apikey } });
  if (!r.ok) return null;
  const u = await r.json();
  return u?.id ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const c = await config();
    const secret = req.headers.get("x-worker-secret");
    const healthToken = req.headers.get("x-health-token");
    if (healthToken) {
      const r = await healthFromShortcut(healthToken, body);
      return json(r, r.ok ? 200 : 400);
    }

    if (secret && secret === c.worker_secret) {
      if (body.action === "cron") return json(await cron());
      if (body.action === "message" || body.action === "task") return json({ ok: true, ignored: "chat is off" });
      if (body.action === "preview") {
        // what a briefing would say, for checking: { uid, day, slot }
        const W = WWCore as any;
        return json(W.briefing(body.day, body.slot || "pm", await contextFor(body.uid, body.day, await exists("public.calendars"))));
      }
      return json({ error: "unknown action" }, 400);
    }

    const uid = await signedInUser(req);
    if (!uid) return json({ error: "Not signed in" }, 401);
    if (body.action === "test_push") {
      const sent = await pushTo([uid], { title: "WhatsWork", body: "Notifications are working ✅", tag: "test", url: "./" });
      return json({ sent });
    }
    if (body.action === "quick_add") {
      try { return json({ entry: await quickAdd(uid, body.text, body.today, body.now) }); }
      catch (e: any) { return json({ error: String(e?.message ?? e) }); }
    }
    if (body.action === "review_now") return json(await writeReview(uid, "on_demand"));
    if (body.action === "briefing_now") {
      // the app's "show me tomorrow's briefing" button
      const W = WWCore as any;
      let tz = "Asia/Karachi";
      try { const [p] = await sql`select tz from public.profiles where id = ${uid}`; if (p?.tz) tz = p.tz; } catch { /* old database */ }
      const day = W.addDays(localParts(tz).date, 1);
      const b = W.briefing(day, "pm", await contextFor(uid, day, await exists("public.calendars")));
      if (!b) return json({ sent: 0, empty: true });
      return json({ sent: await pushTo([uid], { title: b.title, body: b.body, tag: "brief-pm", url: `./?d=${day}` }) });
    }
    return json({ error: "unknown action" }, 400);
  } catch (e: any) {
    console.error(e);
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
