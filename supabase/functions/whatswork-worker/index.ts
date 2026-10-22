// WhatsWork background worker
// - "message" / "task": push notifications when a message or work bubble is created
// - "cron" (every 5 min): due-time reminders + AI task detection for users who turned AI on
// - "scan_now" / "test_push": called from the app's Settings by a signed-in user
import postgres from "npm:postgres@3.4.5";
import webpush from "npm:web-push@3.6.7";

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
  const rows = await sql`select key, value from private.app_config`;
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

async function onMessage(id: string) {
  const [m] = await sql`
    select m.id, m.conversation_id, m.sender_id, m.body, m.file_name, m.file_type, p.name as sender
    from public.messages m join public.profiles p on p.id = m.sender_id where m.id = ${id}`;
  if (!m) return;
  const others = await sql`select user_id from public.conversation_members where conversation_id = ${m.conversation_id} and user_id <> ${m.sender_id}`;
  const body = m.body ? String(m.body).slice(0, 160) : (m.file_type?.startsWith("image/") ? "📷 Photo" : `📎 ${m.file_name ?? "File"}`);
  await pushTo(others.map((r: any) => r.user_id), {
    title: m.sender ?? "New message", body, tag: `chat-${m.conversation_id}`, url: `./?c=${m.conversation_id}`,
  });
}

async function onTask(id: string) {
  const [t] = await sql`
    select t.*, p.name as giver from public.tasks t left join public.profiles p on p.id = t.created_by where t.id = ${id}`;
  if (!t || !t.assignee_id || t.assignee_id === t.created_by) return;
  await pushTo([t.assignee_id], {
    title: `New work from ${t.giver ?? "your team"}`, body: t.title, tag: `task-${t.id}`, url: `./?c=${t.conversation_id}&t=${t.id}`,
  });
}

async function reminders() {
  const due = await sql`
    update public.tasks set reminded_at = now()
    where status = 'open' and reminded_at is null and due_at is not null
      and due_at <= now() + interval '60 minutes' and due_at > now() - interval '1 day'
    returning id, title, due_at, assignee_id, created_by, conversation_id`;
  for (const t of due as any[]) {
    const mins = Math.round((new Date(t.due_at).getTime() - Date.now()) / 60000);
    const when = mins <= 0 ? "is due now" : `is due in ${mins} min`;
    const who = [...new Set([t.assignee_id, t.created_by].filter(Boolean))];
    await pushTo(who, { title: "⏰ Reminder", body: `${t.title} ${when}`, tag: `due-${t.id}`, url: `./?c=${t.conversation_id}&t=${t.id}` });
  }
  return due.length;
}

// ---------- AI ----------
const SYSTEM = `You read a work chat between team members and pick out WORK ASSIGNMENTS: a clear request for someone to do, make, send, fix, design or deliver something.
Ignore greetings, chit-chat, questions without a request, thanks, and status updates ("done", "ok").
Return ONLY JSON: {"tasks":[{"message_id":"<id from the list>","title":"short imperative title, max 8 words","details":"one sentence with useful specifics or empty","assignee":"<exact member name who must do it>","due":"ISO 8601 datetime with offset, or null"}]}
Rules: one task per distinct request; use the message_id of the message that contains the request; the assignee is usually the person the sender is talking to; only set "due" when a time or day is stated or clearly implied ("today", "by Friday", "in 2 hours"), interpreting it in the user's time zone; if nothing qualifies return {"tasks":[]}.`;

async function callAI(provider: string, model: string, key: string, user: string): Promise<string> {
  if (provider === "gemini") {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.1 },
      }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error?.message ?? `Gemini error ${r.status}`);
    return (j.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("");
  }
  if (provider === "claude") {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: 1500, system: SYSTEM, messages: [{ role: "user", content: user }] }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error?.message ?? `Claude error ${r.status}`);
    return (j.content ?? []).map((c: any) => c.text ?? "").join("");
  }
  const base = provider === "openrouter" ? "https://openrouter.ai/api/v1" : "https://api.openai.com/v1";
  const body: any = { model, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }] };
  if (provider === "openai") body.response_format = { type: "json_object" };
  const r = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message ?? `${provider} error ${r.status}`);
  return j.choices?.[0]?.message?.content ?? "";
}

function parseTasks(text: string): any[] {
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s < 0 || e < 0) return [];
  try { const o = JSON.parse(text.slice(s, e + 1)); return Array.isArray(o.tasks) ? o.tasks : []; } catch { return []; }
}

async function scanUser(userId: string) {
  const [st] = await sql`select * from private.ai_settings where user_id = ${userId}`;
  if (!st?.enabled || !st.api_key) return { found: 0, skipped: true };
  const msgs = await sql`
    select m.id, m.conversation_id, m.sender_id, m.body, m.created_at, p.name as sender
    from public.messages m
    join public.conversation_members cm on cm.conversation_id = m.conversation_id and cm.user_id = ${userId}
    join public.profiles p on p.id = m.sender_id
    where not m.ai_scanned and m.body is not null and length(trim(m.body)) > 3
      and m.created_at > now() - interval '3 days'
      and not exists (select 1 from public.tasks t where t.message_id = m.id)
    order by m.created_at limit 60`;
  if (!msgs.length) {
    await sql`update private.ai_settings set last_run = now(), last_error = null, last_found = 0 where user_id = ${userId}`;
    return { found: 0 };
  }
  const tz = st.tz || "UTC";
  const nowLocal = new Date().toLocaleString("en-GB", { timeZone: tz, dateStyle: "full", timeStyle: "short" });
  const byConv: Record<string, any[]> = {};
  for (const m of msgs as any[]) (byConv[m.conversation_id] ??= []).push(m);

  let found = 0;
  try {
    for (const [conv, list] of Object.entries(byConv)) {
      const members = await sql`select p.id, p.name from public.conversation_members cm join public.profiles p on p.id = cm.user_id where cm.conversation_id = ${conv}`;
      // a little earlier context helps the model understand replies
      const ctx = await sql`
        select m.id, m.body, p.name as sender from public.messages m join public.profiles p on p.id = m.sender_id
        where m.conversation_id = ${conv} and m.created_at < ${list[0].created_at} and m.body is not null
        order by m.created_at desc limit 6`;
      const prompt = [
        `Time zone: ${tz}. Current local time: ${nowLocal}.`,
        `Chat members: ${members.map((p: any) => p.name).join(", ")}.`,
        ctx.length ? `Earlier context (already processed, do not extract):\n${[...ctx].reverse().map((m: any) => `${m.sender}: ${m.body}`).join("\n")}` : "",
        `New messages to check:\n${list.map((m: any) => `[${m.id}] ${m.sender}: ${m.body}`).join("\n")}`,
      ].filter(Boolean).join("\n\n");

      const tasks = parseTasks(await callAI(st.provider, st.model, st.api_key, prompt));
      const ids = new Set(list.map((m: any) => m.id));
      for (const t of tasks) {
        if (!ids.has(t.message_id) || !t.title) continue;
        const msg = list.find((m: any) => m.id === t.message_id);
        const named = members.find((p: any) => p.name && t.assignee && p.name.toLowerCase() === String(t.assignee).toLowerCase());
        const other = members.find((p: any) => p.id !== msg.sender_id);
        const assignee = named?.id ?? other?.id ?? msg.sender_id;
        let due: string | null = null;
        if (t.due) { const d = new Date(t.due); if (!isNaN(d.getTime())) due = d.toISOString(); }
        await sql`
          insert into public.tasks (conversation_id, message_id, created_by, assignee_id, title, details, due_at, source)
          select ${conv}::uuid, ${msg.id}::uuid, ${msg.sender_id}::uuid, ${assignee}::uuid, ${String(t.title).slice(0, 140)}::text,
                 ${t.details || null}::text, ${due}::timestamptz, 'ai'
          where not exists (select 1 from public.tasks where message_id = ${msg.id}::uuid)`;
        found++;
      }
      await sql`update public.messages set ai_scanned = true where id = any(${list.map((m: any) => m.id)}::uuid[])`;
    }
    await sql`update private.ai_settings set last_run = now(), last_error = null, last_found = ${found} where user_id = ${userId}`;
    return { found };
  } catch (e: any) {
    const msg = String(e?.message ?? e).slice(0, 300);
    await sql`update private.ai_settings set last_run = now(), last_error = ${msg} where user_id = ${userId}`;
    return { found, error: msg };
  }
}

// ---------- PLANNER DIGEST (9 am: today's posts, 8 pm: tomorrow's) ----------
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
function localParts(tz: string) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}
function addDay(date: string, n: number) {
  const d = new Date(date + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}
function line(it: any) {
  const st = it.sched ? "scheduled" : it.made ? "made" : it.sent ? "with designer" : "not started";
  return `• ${it.t} (${st})`;
}
async function plannerDigests() {
  if (!SERVICE_KEY) return 0;
  const users = await sql`select distinct user_id from public.planner_docs where name = 'main'`;
  let sent = 0;
  for (const u of users as any[]) {
    try {
      const r = await fetch(`${SUPABASE_URL}/storage/v1/object/planner/${u.user_id}/_meta/upcoming.json`, {
        headers: SERVICE_KEY.startsWith("sb_") ? { apikey: SERVICE_KEY } : { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY },
      });
      if (!r.ok) continue;
      const dg = await r.json();
      const tz = dg.tz || "UTC";
      const { date, hour } = localParts(tz);
      const slot = hour >= 9 && hour < 12 ? "am" : hour >= 20 && hour < 23 ? "pm" : null;
      if (!slot) continue;
      const key = `pdigest:${slot}:${u.user_id}`;
      const [prev] = await sql`select value from private.app_config where key = ${key}`;
      if (prev?.value === date) continue;
      await sql`insert into private.app_config (key, value) values (${key}, ${date}) on conflict (key) do update set value = excluded.value`;
      const day = slot === "am" ? date : addDay(date, 1);
      const items: any[] = (dg.days?.[day] ?? []);
      if (!items.length) continue;
      const todo = items.filter((it) => !it.sched && !it.made).length;
      const title = slot === "am"
        ? `📅 Today: ${items.length} post${items.length > 1 ? "s" : ""}${todo ? `, ${todo} not ready` : ", all ready"}`
        : `🌙 Tomorrow: ${items.length} post${items.length > 1 ? "s" : ""}${todo ? `, ${todo} not ready` : ", all ready"}`;
      const body = items.slice(0, 6).map(line).join("\n") + (items.length > 6 ? `\n+${items.length - 6} more` : "");
      sent += await pushTo([u.user_id], { title, body, tag: `planner-${slot}`, url: "./?planner=1" });
    } catch (e) { console.error("digest", e); }
  }
  return sent;
}

async function cron() {
  const r = await reminders();
  const digests = await plannerDigests();
  const users = await sql`select user_id from private.ai_settings where enabled and api_key is not null`;
  const results = [];
  for (const u of users as any[]) results.push(await scanUser(u.user_id));
  return { reminders: r, digests, ai: results };
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
      if (body.action === "message") { await onMessage(body.id); return json({ ok: true }); }
      if (body.action === "task") { await onTask(body.id); return json({ ok: true }); }
      if (body.action === "cron") return json(await cron());
      return json({ error: "unknown action" }, 400);
    }

    const uid = await signedInUser(req);
    if (!uid) return json({ error: "Not signed in" }, 401);
    if (body.action === "scan_now") return json(await scanUser(uid));
    if (body.action === "test_push") {
      const sent = await pushTo([uid], { title: "WhatsWork", body: "Notifications are working ✅", tag: "test", url: "./" });
      return json({ sent });
    }
    return json({ error: "unknown action" }, 400);
  } catch (e: any) {
    console.error(e);
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
