// WhatsWork background worker
// - "cron" (every 5 min): the 9 am and 8 pm briefings, reminders before each entry, and the Sunday evening review
// - "test_push", "quick_add", "voice_add", "review_now": called from the app by a signed-in user
// - "health": posted by the iPhone Shortcut with an x-health-token header
// - "widget": the Scriptable Home Screen widget, with its own key
import postgres from "npm:postgres@3.4.5";
import webpush from "npm:web-push@3.6.7";
import { WWCore, normaliseState, itemsOn, COLLEGES } from "https://cdn.jsdelivr.net/gh/Ateebhassan/whatswork@49732ac/core.mjs";

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
  const rows = await sql`select key, value from private.app_config where key not like 'pdigest:%' and key not like 'remind:%' and key not like 'review:%' and key not like 'sleepstart:%'`;
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
      if (!(await notifyPrefs(u.id))[slot === "am" ? "briefing_am" : "briefing_pm"].on) continue;
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

/* A heads-up shortly before each timed entry: 30 min before a shift, 15 min before anything else. Sleep is skipped. */
function localMinute(tz: string) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return Number(p.hour) * 60 + Number(p.minute);
}
/* What you chose in Settings, Notifications. Anything missing uses these defaults. */
const NOTIFY_DEFAULTS: Record<string, any> = {
  shift: { on: true, lead: 30, sound: true }, university: { on: true, lead: 15, sound: true },
  meeting: { on: true, lead: 15, sound: true }, other: { on: true, lead: 15, sound: true },
  prayer: { on: false, lead: 5, sound: true }, bedtime: { on: false, lead: 30, sound: true }, briefing_am: { on: true }, briefing_pm: { on: true }, review: { on: true },
  alarms: { wake: false, shift: false, shift_lead: 60, meeting: false, meeting_lead: 30 },
};
async function notifyPrefs(uid: string) {
  let p: any = {};
  try { const [r] = await sql`select notify from public.profiles where id = ${uid}`; p = r?.notify || {}; } catch { /* old database */ }
  const out: Record<string, any> = {};
  for (const k of Object.keys(NOTIFY_DEFAULTS)) out[k] = { ...NOTIFY_DEFAULTS[k], ...(p[k] || {}) };
  return out;
}
function prefKey(kind: string) { return kind === "shift" ? "shift" : kind === "university" ? "university" : kind === "meeting" || kind === "call" ? "meeting" : kind === "sleep" ? "bedtime" : kind === "prayer" ? "prayer" : "other"; }
async function reminders() {
  if (!(await exists("public.events"))) return 0;
  const W = WWCore as any;
  const users = await sql`select distinct e.user_id as id from public.events e join public.push_subscriptions s on s.user_id = e.user_id`;
  let sent = 0;
  for (const u of users as any[]) {
    try {
      const tz = await tzOf(u.id), { date } = localParts(tz), np = await notifyPrefs(u.id);
      const now = W.dnum(date) * W.DAY + localMinute(tz);
      const ctx = await contextFor(u.id, date, true);
      const due = (ctx.occs as any[]).filter((o) => {
        if (o.allDay || o.cal.archived) return false;
        const pr = np[prefKey(o.kind)]; if (!pr?.on) return false;
        const lead = Math.max(0, Math.min(180, Number(pr.lead) || 15));
        return o.start > now && o.start - now <= lead;
      });
      for (const o of due) {
        const key = `remind:${u.id}:${o.key}`;
        const [prev] = await sql`select 1 from private.app_config where key = ${key}`;
        if (prev) continue;
        await sql`insert into private.app_config (key, value) values (${key}, ${o.date}) on conflict (key) do nothing`;
        const pr = np[prefKey(o.kind)], mins = o.start - now, at = W.fmtTime(o.start % W.DAY);
        const icon = o.kind === "shift" ? "💼" : o.kind === "meeting" ? "👥" : o.kind === "call" ? "📞" : o.kind === "university" ? "🎓" : o.kind === "sleep" ? "🌙" : o.kind === "prayer" ? "🕌" : "⏰";
        const title = o.kind === "sleep" ? `${icon} Bedtime in ${mins} min` : `${icon} ${o.ev.title} in ${mins} min`;
        const body = o.kind === "prayer" ? `Prayer break at ${at}. Take 15 minutes.` : o.kind === "sleep" ? `Sleep planned ${at} – ${W.fmtTime(o.end % W.DAY)}. Wind down now.` : `${at} · ${o.cal.short_name || o.cal.name}`;
        sent += await pushTo([u.id], { title, body, tag: `remind-${o.key}`, url: `./?d=${o.date}`, silent: pr.sound === false });
      }
    } catch (e) { console.error("reminders", u.id, e); }
  }
  await sql`delete from private.app_config where key like 'remind:%' and value < ${new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10)}`;
  return sent;
}

/* For the iPhone alarm Shortcut: the alarms to set for the next 24 hours, from your calendar and your choices. */
async function alarmsFor(uid: string) {
  const W = WWCore as any;
  const tz = await tzOf(uid), { date } = localParts(tz), np = await notifyPrefs(uid), a = np.alarms;
  const now = W.dnum(date) * W.DAY + localMinute(tz);
  const ctx = await contextFor(uid, W.addDays(date, 1), true);
  const out: any[] = [];
  const add = (m: number, label: string) => {
    if (m <= now || m > now + W.DAY) return;
    const d = W.dstr(Math.floor(m / W.DAY)), mm = ((m % W.DAY) + W.DAY) % W.DAY, hh = Math.floor(mm / 60), mi = mm % 60;
    const h12 = hh % 12 || 12, ap = hh < 12 ? "AM" : "PM";
    out.push({ date: d, time: `${String(hh).padStart(2, "0")}:${String(mi).padStart(2, "0")}`, at: `${d} ${h12}:${String(mi).padStart(2, "0")} ${ap}`, label: "WW: " + label });
  };
  for (const o of ctx.occs as any[]) {
    if (o.allDay) continue;
    if (a.wake && o.kind === "sleep") add(o.end, "Wake up");
    if (a.shift && o.kind === "shift") add(o.start - (Number(a.shift_lead) || 60), o.ev.title);
    if (a.meeting && (o.kind === "meeting" || o.kind === "call")) add(o.start - (Number(a.meeting_lead) || 30), o.ev.title);
  }
  out.sort((x, y) => (x.date + x.time).localeCompare(y.date + y.time));
  return { ok: true, alarms: out.slice(0, 12), count: Math.min(12, out.length) };
}

/* For the Scriptable Home Screen widget: now, next activities and today's posts. */
const WCOL: Record<string, string> = { shift: "#2563eb", university: "#0891b2", meeting: "#ea580c", call: "#ea580c", personal: "#7c3aed", work: "#7c3aed", sleep: "#94a3b8", prayer: "#d4a017", other: "#7c3aed" };
async function widgetFor(key: string) {
  const W = WWCore as any;
  if (typeof key !== "string" || !/^wg_[0-9a-f]{48}$/.test(key.trim())) return { error: "Widget key not recognised. Make a new one in WhatsWork Settings." };
  const [row] = await sql`select user_id from private.widget_tokens where token_hash = ${await sha256hex(key.trim())}`;
  if (!row) return { error: "Widget key not recognised. Make a new one in WhatsWork Settings." };
  const uid = row.user_id;
  await sql`update private.widget_tokens set last_used = now() where user_id = ${uid}`;
  const tz = await tzOf(uid), { date } = localParts(tz);
  const now = W.dnum(date) * W.DAY + localMinute(tz);
  const ctx = await contextFor(uid, W.addDays(date, 1), true);
  const occs = (ctx.occs as any[]).filter((o) => !o.allDay && o.kind !== "post" && o.cal.visible !== false && !o.cal.archived);
  const t = (m: number) => W.fmtTime(((m % W.DAY) + W.DAY) % W.DAY).replace(":00", "");
  const cur = occs.filter((o) => o.kind !== "sleep" && o.kind !== "prayer" && o.start <= now && o.end > now).sort((a, b) => b.start - a.start)[0];
  const next = occs.filter((o) => o.start > now && o.start < now + 2 * W.DAY).sort((a, b) => a.start - b.start).slice(0, 9).map((o) => ({
    when: (Math.floor(o.start / W.DAY) > W.dnum(date) ? "Tmw " : "") + t(o.start), title: (o.kind === "prayer" ? "🕌 " : "") + o.ev.title, color: WCOL[o.kind] || o.cal.color || "#7c3aed" }));
  let total = 0, done = 0;
  if (ctx.planner) {
    const tr = (ctx.tracks as any)[date.slice(0, 7)] || {};
    for (const it of itemsOn(date, ctx.planner, "both", null) as any[]) { total++; if ((tr[it.id + "@" + date] || {}).s) done++; }
  }
  return { ok: true, now: cur ? { title: cur.ev.title, end: t(cur.end) } : null, next, posts: { total, done } };
}

async function cron() {
  const sent = await briefings();
  const reminded = await reminders();
  const reviews = await weeklyReviews();
  return { briefings: sent, reminders: reminded, reviews };
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


// ---------- VOICE: audio from the app's mic, understood by your AI key ----------
const VOICE_RULES = `Answer ONLY with JSON: {"transcript": string (what was said, word for word), "add": [{"title": string, "calendar": string, "kind": string, "date": "YYYY-MM-DD", "start": "HH:MM" or null, "end": "HH:MM" or null, "repeat": "none"|"daily"|"weekly", "repeat_days": [numbers 0-6, 0 = Sunday]}], "remove": [{"what": string, "date": "YYYY-MM-DD"}], "day_off": ["YYYY-MM-DD"]}
The person may say several things in one go, fast, in English or Urdu mixed with English. Use empty lists for whatever wasn't asked.
- "add": one entry for each new thing to put in the calendar.
- "remove": for each thing to cancel, remove or skip on a day. "what" is a short name for it in the person's own words ("university", "classes", "meeting with Sam"). "Remove my classes Monday and Tuesday" = two items.
- "day_off": when a whole day should be cleared ("give me tomorrow off"), give that date here and don't list the things separately.
Rules for each "add" entry:
${QUICK_SYSTEM.split("Rules:")[1]}`;
async function calendarContext(uid: string, today: string, now: string) {
  const cals = await sql`select name, short_name, billing, kind from public.calendars where user_id = ${uid} and not archived order by sort`;
  const wd = new Date(today + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
  return `Today is ${wd} ${today}. The time now is ${now}.
Calendars: ${(cals as any[]).map((c) => `${c.name}${c.short_name ? ` (also called ${c.short_name})` : ""}${c.billing === "personal" ? " [personal]" : ""}${c.kind === "planner" ? " [college social media]" : ""}`).join("; ")}.`;
}
async function voiceAdd(uid: string, audio: string, mime: string, today: string, now: string) {
  if (typeof audio !== "string" || audio.length < 1000) throw new Error("No audio received");
  if (audio.length > 8_000_000) throw new Error("That recording is too long. Keep it under a minute.");
  const st = await aiSettings(uid);
  const ctx = await calendarContext(uid, today, now);
  const base = String(mime || "audio/mp4").split(";")[0];
  if (st.provider === "gemini") {
    const gm = base === "audio/mp4" || base === "audio/x-m4a" ? "audio/m4a" : base;
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(st.model)}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": st.api_key },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: "You turn a short voice note into calendar entries for a planner app.\n" + VOICE_RULES }] },
        contents: [{ role: "user", parts: [{ inline_data: { mime_type: gm, data: audio } }, { text: ctx + "\nListen to the voice note and answer with the JSON." }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.2 } }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error?.message ?? `Gemini error ${r.status}`);
    return firstJson((j.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join(""));
  }
  if (st.provider === "openai") {
    const bytes = Uint8Array.from(atob(audio), (c) => c.charCodeAt(0));
    const ext = base.includes("webm") ? "webm" : base.includes("ogg") ? "ogg" : base.includes("wav") ? "wav" : "m4a";
    let text = "";
    for (const model of ["gpt-4o-mini-transcribe", "whisper-1"]) {
      const fd = new FormData();
      fd.append("file", new Blob([bytes], { type: base }), `note.${ext}`);
      fd.append("model", model);
      const r = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${st.api_key}` }, body: fd });
      const j = await r.json().catch(() => ({}));
      if (r.ok) { text = j.text ?? ""; break; }
      if (model === "whisper-1") throw new Error(j?.error?.message ?? `OpenAI error ${r.status}`);
    }
    if (!text.trim()) return { transcript: "", add: [], remove: [], day_off: [] };
    const out = firstJson(await callAI("openai", st.model, st.api_key, "You turn a short voice note into calendar actions for a planner app.\n" + VOICE_RULES, `${ctx}\nVoice note: ${text.slice(0, 1500)}`, 900));
    return { transcript: text, add: out.add ?? out.entries ?? [], remove: out.remove ?? [], day_off: out.day_off ?? [] };
  }
  throw new Error("Voice needs a Gemini or ChatGPT key. Change it in Settings, AI, or use the keyboard microphone.");
}

/* The same understanding for typed or dictated text (any AI provider). */
async function textActions(uid: string, text: string, today?: string, now?: string) {
  const st = await aiSettings(uid);
  const tz = await tzOf(uid), lp = localParts(tz);
  const t = today && /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : lp.date;
  const n = now && /^\d{2}:\d{2}$/.test(now) ? now : `${String(lp.hour).padStart(2, "0")}:00`;
  const ctx = await calendarContext(uid, t, n);
  const out = firstJson(await callAI(st.provider, st.model, st.api_key, "You turn one short request into calendar actions for a planner app.\n" + VOICE_RULES, `${ctx}\nRequest: ${String(text).slice(0, 400)}`, 900));
  return { transcript: String(text).slice(0, 400), add: out.add ?? out.entries ?? [], remove: out.remove ?? [], day_off: out.day_off ?? [] };
}
/* The Home Screen voice button: understand the dictated text and change the calendar straight away. */
function hmPlus(hm: string, mins: number) { const [h, m] = hm.split(":").map(Number); const x = (h * 60 + m + mins) % 1440; return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`; }
async function applyActions(uid: string, out: any) {
  const cals = (await sql`select id, name, short_name, billing, kind from public.calendars where user_id = ${uid} and not archived`) as any[];
  const msgs: string[] = [], asks: string[] = [];
  for (const e of (Array.isArray(out.add) ? out.add : []).slice(0, 10)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e?.date || "") || !e.title) continue;
    const kind = ["sleep", "shift", "university", "work", "meeting", "call", "personal", "post", "other"].includes(e.kind) ? e.kind : "other";
    const nm = String(e.calendar || "").toLowerCase();
    const cal = cals.find((c) => c.name.toLowerCase() === nm || (c.short_name || "").toLowerCase() === nm)
      || cals.find((c) => nm && (c.name.toLowerCase().includes(nm) || nm.includes(c.name.toLowerCase()) || (c.short_name && nm.includes(c.short_name.toLowerCase()))))
      || cals.find((c) => c.billing === "personal") || cals[0];
    if (!cal) continue;
    const st = /^\d{2}:\d{2}$/.test(e.start || "") ? e.start : null;
    const en = /^\d{2}:\d{2}$/.test(e.end || "") ? e.end : (st ? hmPlus(st, kind === "call" ? 30 : 60) : null);
    const rep = ["daily", "weekly"].includes(e.repeat) ? e.repeat : "none";
    const days = rep === "weekly" ? (Array.isArray(e.repeat_days) && e.repeat_days.length ? e.repeat_days.filter((x: any) => Number.isInteger(x) && x >= 0 && x <= 6) : [new Date(e.date + "T12:00:00Z").getUTCDay()]) : [];
    await sql`insert into public.events (user_id, calendar_id, title, kind, date, start_time, end_time, repeat, repeat_days, source)
      values (${uid}, ${cal.id}, ${String(e.title).slice(0, 140)}, ${kind}, ${e.date}, ${kind === "post" ? null : st}, ${kind === "post" ? null : en}, ${rep}, ${days}, 'voice')`;
    msgs.push(`Added ${e.title} on ${e.date}${st ? " at " + st : ""}`);
  }
  const wants = [...(Array.isArray(out.remove) ? out.remove : []).map((r: any) => ({ what: String(r?.what || ""), date: r?.date })),
    ...(Array.isArray(out.day_off) ? out.day_off : []).map((d: any) => ({ what: "", date: d }))].slice(0, 10);
  for (const r of wants) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date || "")) continue;
    const ctx = await contextFor(uid, r.date, true);
    const w = r.what.toLowerCase().trim();
    const hits = (ctx.occs as any[]).filter((o) => o.date === r.date && !o.allDay && o.kind !== "sleep" && o.kind !== "prayer" && !o.cal.archived)
      .filter((o) => { if (!w) return true; const t = o.ev.title.toLowerCase();
        return t.includes(w) || w.includes(t) || (/class|uni|lecture/.test(w) && o.kind === "university") || (/meeting|call/.test(w) && (o.kind === "meeting" || o.kind === "call")) || (/shift/.test(w) && o.kind === "shift") || w.split(/\s+/).some((x: string) => x.length > 3 && t.includes(x)); });
    if (!hits.length && w) msgs.push(`Found nothing called "${r.what}" on ${r.date}`);
    for (const o of hits) {
      if (o.kind === "meeting" || o.kind === "call" || o.kind === "shift") { asks.push(`${o.ev.title} (${r.date})`); continue; }
      if (o.ev.repeat && o.ev.repeat !== "none") await sql`update public.events set skip_dates = array_append(skip_dates, ${r.date}::date), updated_at = now() where id = ${o.ev.id} and user_id = ${uid} and not (skip_dates @> array[${r.date}::date])`;
      else await sql`delete from public.events where id = ${o.ev.id} and user_id = ${uid}`;
      msgs.push(`Removed ${o.ev.title} on ${r.date}`);
    }
  }
  let message = msgs.length ? msgs.join(". ") : "I heard you, but found nothing to change.";
  if (asks.length) message += `. Left alone (important): ${asks.join(", ")}. Open WhatsWork to remove these.`;
  return { ok: true, message, heard: out.transcript || "" };
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
/* Shortcuts can send dates in many shapes: ISO 8601, "31 Oct 2026 at 6:00 AM", or a list of them (one per sleep sample).
   A time with no offset is read as the owner's local time. */
function tzOffsetMin(tz: string, at: Date) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - Math.floor(at.getTime() / 60000) * 60000) / 60000;
}
function parseOne(v: string, tz: string): number | null {
  let t = v.trim().replace(/\u202f|\u00a0/g, " ").replace(/ at /i, " ");
  if (!t) return null;
  t = t.replace(/^(\d{4}-\d{2}-\d{2}) (\d{1,2}:\d{2})/, "$1T$2");
  const hasZone = /(Z|[+-]\d{2}:?\d{2}|GMT|UTC)$/i.test(t);
  let ms = Date.parse(hasZone ? t : t + (/T/.test(t) ? "Z" : " UTC"));
  if (isNaN(ms)) return null;
  if (!hasZone) ms -= tzOffsetMin(tz, new Date(ms)) * 60000;
  return ms;
}
function parseAll(v: unknown, tz: string): number[] {
  const list = Array.isArray(v) ? v : typeof v === "string" ? v.split(/\n|;/) : [];
  return list.map((x) => (typeof x === "string" ? parseOne(x, tz) : null)).filter((x): x is number => x != null);
}
function parseWhen(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const ms = parseOne(v, "UTC");
  return ms == null ? null : new Date(ms).toISOString();
}
async function healthFromShortcut(token: string, body: any) {
  const hash = await sha256hex(token.trim());
  const [row] = await sql`select user_id from private.health_tokens where token_hash = ${hash}`;
  if (!row) return { ok: false, error: "This Shortcut's key isn't recognised. Make a new key in WhatsWork (My week, Sleep buttons)." };
  const uid = row.user_id, tz = await tzOf(uid);
  /* button mode: "Going to sleep" then "Woke up" (no Apple Watch needed) */
  if (body.event === "sleep") {
    await sql`insert into private.app_config (key, value) values (${"sleepstart:" + uid}, ${new Date().toISOString()}) on conflict (key) do update set value = excluded.value`;
    await sql`update private.health_tokens set last_used = now() where user_id = ${uid}`;
    return { ok: true, message: "Good night. Tap Woke up when you get up." };
  }
  if (body.event === "wake") {
    const [st] = await sql`select value from private.app_config where key = ${"sleepstart:" + uid}`;
    if (!st) return { ok: false, error: "I don't have a sleep start. Tap Going to sleep before you sleep next time." };
    const mins = Math.round((Date.now() - Date.parse(st.value)) / 60000);
    await sql`delete from private.app_config where key = ${"sleepstart:" + uid}`;
    if (mins < 30 || mins > 18 * 60) return { ok: false, error: `That was ${Math.round(mins / 6) / 10} hours, which doesn't look like one sleep, so I didn't save it.` };
    body = { sleep_start: st.value, sleep_end: new Date().toISOString() };
  }
  const starts = parseAll(body.sleep_start, tz), ends = parseAll(body.sleep_end, tz);
  const start = starts.length ? new Date(Math.min(...starts)).toISOString() : null, end = ends.length ? new Date(Math.max(...ends)).toISOString() : null;
  const asleep = Number.isFinite(+body.asleep_minutes) && body.asleep_minutes !== "" && body.asleep_minutes != null ? Math.round(+body.asleep_minutes) : null;
  const screen = Number.isFinite(+body.screen_minutes) && body.screen_minutes !== "" && body.screen_minutes != null ? Math.round(+body.screen_minutes) : null;
  if (!end && asleep == null && screen == null) return { ok: false, error: "No sleep found. Use the Going to sleep and Woke up buttons." };
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
  return { ok: true, date, slept: mins != null ? W.fmtDur(mins) : null, message: mins != null ? `Saved: you slept ${W.fmtDur(mins)}` : "Saved" };
}

// ---------- REVIEWS ----------
const REVIEW_SYSTEM = `You write a short weekly review for one person's planner app. Use ONLY the facts given; never invent events, people or numbers.
Prayers are short 15-minute breaks inside the day. They never clash with anything and are never a problem: never mention prayers, prayer times or prayer overlaps at all.
If upcoming_special_days lists a major day that suits his colleges or clients, you may add ONE tip about preparing a post for it.
Write in plain, friendly English with short sentences. Be concrete: name the day, time, calendar and what to do.
Answer ONLY with JSON: {"title": string (at most 8 words), "summary": string (one sentence), "items": [{"type": "warning" | "tip" | "win", "text": string (one or two sentences)}]}
Give 3 to 6 items, most urgent first: clashes and short sleep first, then posts that aren't scheduled, then unpaid hours (name them and how many hours), then sleep and screen time, then one thing that went well if there is one.`;

async function reviewInput(uid: string, today: string) {
  const W = WWCore as any;
  const ctx = await contextFor(uid, today, await exists("public.calendars"));
  const events = (await exists("public.events")) ? await sql`select id, calendar_id, title, kind, to_char(date,'YYYY-MM-DD') as date,
      to_char(start_time,'HH24:MI') as start_time, to_char(end_time,'HH24:MI') as end_time, repeat, repeat_days,
      to_char(repeat_until,'YYYY-MM-DD') as repeat_until, (select array_agg(to_char(x,'YYYY-MM-DD')) from unnest(skip_dates) x) as skip_dates
      from public.events where user_id = ${uid} and kind <> 'prayer'` : [];
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
    const Wc = WWCore as any; const specials: any[] = [];
    for (let i = 0; i < 14; i++) { const d = Wc.addDays(today, i); for (const it of (Wc.worldDaysOn ? Wc.worldDaysOn(d) : [])) specials.push({ date: d, title: it.title, major: it.size === "major" }); }
    const out = firstJson(await callAI(st.provider, st.model, st.api_key, REVIEW_SYSTEM,
      `Facts:\n${JSON.stringify({ ...base.facts, upcoming_special_days: specials.slice(0, 20) })}\n\nPoints found by simple rules (use them, improve the wording, add anything they missed):\n${base.items.map((i: any) => "- " + i.text).join("\n")}`, 1200));
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
      if (!(await notifyPrefs(u.id)).review.on) { n++; continue; }
      const first = (review.items || [])[0]?.text || review.summary || "";
      await pushTo([u.id], { title: "📝 Your weekly review is ready", body: first.slice(0, 180), tag: "review", url: "./?review=1" });
      n++;
    } catch (e) { console.error("weekly review", u.id, e); }
  }
  return n;
}


// ---------- DESIGNER PORTAL (designer.html, with the link's key) ----------
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
async function designerUser(key: string) {
  if (typeof key !== "string" || !/^wd_[0-9a-f]{48}$/.test(key)) return null;
  const [row] = await sql`select user_id, designer_name from private.designer_tokens where token_hash = ${await sha256hex(key)}`;
  if (!row) return null;
  await sql`update private.designer_tokens set last_used = now() where user_id = ${row.user_id}`;
  return row;
}
async function storageFetch(path: string, body: unknown) {
  const r = await fetch(`${SUPABASE_URL}/storage/v1${path}`, { method: "POST", headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.message ?? j?.error ?? `Storage error ${r.status}`);
  return j;
}
async function signedUrls(paths: string[]) {
  if (!paths.length) return {};
  const j = await storageFetch(`/object/sign/designs`, { expiresIn: 3600, paths });
  const out: Record<string, string> = {};
  for (const x of j as any[]) if (x.signedURL) out[x.path] = `${SUPABASE_URL}/storage/v1${x.signedURL}`;
  return out;
}
async function designerList(uid: string, days: number) {
  const W = WWCore as any;
  const tz = await tzOf(uid), today = localParts(tz).date;
  const docs = await sql`select name, json from public.planner_docs where user_id = ${uid}`;
  let planner: any = null; const tracks: Record<string, any> = {};
  for (const d of docs as any[]) { try { const j = JSON.parse(d.json); if (d.name === "main") planner = normaliseState(j); else tracks[d.name.slice(6)] = j; } catch { /* skip */ } }
  if (!planner) return { today, posts: [] };
  const from = W.addDays(today, -3), to = W.addDays(today, Math.max(7, Math.min(60, days || 30)));
  const files = await sql`select id, item_key, name, mime, size, path, note, uploaded_by, created_at from public.post_files where user_id = ${uid} and post_date between ${from}::date and ${to}::date order by created_at`;
  const urls = await signedUrls((files as any[]).map((f) => f.path));
  const byKey: Record<string, any[]> = {};
  for (const f of files as any[]) (byKey[f.item_key] ??= []).push({ id: f.id, name: f.name, mime: f.mime, size: Number(f.size), note: f.note, by: f.uploaded_by, url: urls[f.path] || null });
  const posts: any[] = [];
  for (let d = from; d <= to; d = W.addDays(d, 1)) {
    for (const it of itemsOn(d, planner, "both", null) as any[]) {
      const key = it.id + "@" + d, tr = (tracks[d.slice(0, 7)] || {})[key] || {};
      posts.push({ key, date: d, title: it.title, college: it.college, collegeName: (COLLEGES as any)[it.college]?.name ?? "", cat: it.cat, size: it.size, weekly: !!it.weekly, birthday: it.kind === "birthday",
        status: { sent: !!tr.q, made: !!tr.m, scheduled: !!tr.s }, files: byKey[key] || [] });
    }
  }
  return { today, posts };
}
async function setTrack(uid: string, key: string, date: string, patch: Record<string, boolean>) {
  const name = "track-" + date.slice(0, 7);
  const [doc] = await sql`select json from public.planner_docs where user_id = ${uid} and name = ${name}`;
  let map: any = {}; try { map = doc ? JSON.parse(doc.json) : {}; } catch { map = {}; }
  const cur = map[key] || {};
  for (const [f, v] of Object.entries(patch)) { if (v) cur[f] = 1; else delete cur[f]; }
  if (Object.keys(cur).length) map[key] = cur; else delete map[key];
  const json = JSON.stringify(map);
  const [ex] = await sql`select 1 from public.planner_docs where user_id = ${uid} and name = ${name}`;
  if (ex) await sql`update public.planner_docs set json = ${json}, v = coalesce(v, 0) + 1 where user_id = ${uid} and name = ${name}`;
  else await sql`insert into public.planner_docs (user_id, name, json) values (${uid}, ${name}, ${json})`;
}
async function designer(body: any) {
  const who = await designerUser(body.key);
  if (!who) return { error: "This link doesn't work any more. Ask for a new one." };
  const uid = who.user_id;
  if (body.action === "designer_list") return { designer: who.designer_name || "", ...(await designerList(uid, body.days)) };
  const key = String(body.item_key || ""), date = String(body.date || "");
  if (!/^.{1,180}@\d{4}-\d{2}-\d{2}$/.test(key) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !key.endsWith("@" + date)) return { error: "Bad post" };
  if (body.action === "designer_upload") {
    const name = String(body.name || "file").replace(/[^\w.\- ()]+/g, "_").slice(-120);
    const size = Number(body.size) || 0;
    if (size > 50 * 1024 * 1024) return { error: "Files can be up to 50 MB." };
    const path = `${uid}/${date}/${crypto.randomUUID().slice(0, 8)}-${name}`;
    const j = await storageFetch(`/object/upload/sign/designs/${path.split("/").map(encodeURIComponent).join("/")}`, {});
    return { path, uploadUrl: `${SUPABASE_URL}/storage/v1${j.url}` };
  }
  if (body.action === "designer_saved") {
    const path = String(body.path || "");
    if (!path.startsWith(uid + "/" + date + "/")) return { error: "Bad file" };
    await sql`insert into public.post_files (user_id, item_key, post_date, title, path, name, mime, size, uploaded_by, note)
      values (${uid}, ${key}, ${date}, ${String(body.title || "").slice(0, 200)}, ${path}, ${String(body.name || "file").slice(0, 200)}, ${String(body.mime || "").slice(0, 100)}, ${Number(body.size) || 0}, 'designer', ${body.note ? String(body.note).slice(0, 1000) : null})
      on conflict (path) do nothing`;
    await setTrack(uid, key, date, { q: true, m: true });
    await pushTo([uid], { title: "🎨 New design uploaded", body: `${String(body.title || "A post").slice(0, 80)} · for ${date}`, tag: "design-" + key, url: `./?d=${date}` });
    return { ok: true };
  }
  if (body.action === "designer_note") {
    await setTrack(uid, key, date, { q: true });
    return { ok: true };
  }
  if (body.action === "designer_delete") {
    const [f] = await sql`delete from public.post_files where id = ${String(body.id)} and user_id = ${uid} and uploaded_by = 'designer' returning path`;
    if (f) await fetch(`${SUPABASE_URL}/storage/v1/object/designs`, { method: "DELETE", headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: [f.path] }) });
    return { ok: true };
  }
  return { error: "unknown action" };
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
      if (body.action === "voice_text") {
        const [row] = await sql`select user_id from private.health_tokens where token_hash = ${await sha256hex(healthToken.trim())}`;
        if (!row) return json({ ok: false, message: "This key isn't recognised. Make a new key in WhatsWork (My week, Sleep buttons)." }, 400);
        if (typeof body.text !== "string" || body.text.trim().length < 2) return json({ ok: false, message: "I didn't get any words. Try again." }, 400);
        try { return json(await applyActions(row.user_id, await textActions(row.user_id, body.text))); }
        catch (e: any) { return json({ ok: false, message: String(e?.message ?? e) }, 400); }
      }
      if (body.action === "alarms") {
        const [row] = await sql`select user_id from private.health_tokens where token_hash = ${await sha256hex(healthToken.trim())}`;
        if (!row) return json({ ok: false, error: "This Shortcut's key isn't recognised. Make a new key in WhatsWork." }, 400);
        return json(await alarmsFor(row.user_id));
      }
      const r = await healthFromShortcut(healthToken, body);
      return json(r, r.ok ? 200 : 400);
    }

    if (body.action === "widget") return json(await widgetFor(body.key));
    if (typeof body.action === "string" && body.action.startsWith("designer_")) return json(await designer(body));

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
    if (body.action === "parse_text") {
      try { const out = await textActions(uid, body.text, body.today, body.now); return json(out); }
      catch (e: any) { return json({ error: String(e?.message ?? e) }); }
    }
    if (body.action === "voice_add") {
      try { const out = await voiceAdd(uid, body.audio, body.mime, body.today, body.now); const arr = (x: any) => Array.isArray(x) ? x.slice(0, 10) : [];
        return json({ transcript: String(out.transcript ?? "").slice(0, 2000), add: arr(out.add ?? out.entries), remove: arr(out.remove), day_off: arr(out.day_off) }); }
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
