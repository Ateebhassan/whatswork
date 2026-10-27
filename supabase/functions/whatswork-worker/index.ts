// WhatsWork background worker
// - "cron" (every 5 min): the 9 am and 8 pm briefings across all calendars
// - "test_push": called from the app's Settings by a signed-in user
// - "message" / "task": kept for the old chat; nothing sends these any more
import postgres from "npm:postgres@3.4.5";
import webpush from "npm:web-push@3.6.7";
import { WWCore, normaliseState } from "https://ateebhassan.github.io/whatswork/core.mjs?v=2026-10-27a";

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
  return { briefings: sent };
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
