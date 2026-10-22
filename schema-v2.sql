-- WhatsWork v2: AI bubbles, push notifications, reminders
create extension if not exists pg_net;
create extension if not exists pg_cron;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.app_config (key text primary key, value text not null);
insert into private.app_config (key, value) values
  ('worker_url',   'https://boajcspgqhuhchnvbkxl.supabase.co/functions/v1/whatswork-worker'),
  ('worker_secret','__WORKER_SECRET__'),
  ('vapid_public', '__VAPID_PUBLIC__'),
  ('vapid_private','__VAPID_PRIVATE__'),
  ('vapid_subject','https://ateebhassan.github.io/whatswork/')
on conflict (key) do update set value = excluded.value;

create table if not exists private.ai_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  provider text not null default 'gemini',
  model text,
  api_key text,
  tz text,
  last_run timestamptz,
  last_error text,
  last_found int default 0
);

alter table public.messages add column if not exists ai_scanned boolean not null default false;
alter table public.tasks add column if not exists reminded_at timestamptz;

-- Save AI settings (the key is write-only: the app can never read it back)
create or replace function public.save_ai_settings(p_enabled boolean, p_provider text, p_model text, p_key text, p_tz text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if p_provider not in ('gemini','claude','openai','openrouter') then raise exception 'Unknown AI provider'; end if;
  insert into private.ai_settings (user_id, enabled, provider, model, api_key, tz)
  values (auth.uid(), p_enabled, p_provider, nullif(trim(p_model),''),
          case when p_key = '__clear__' then null else nullif(trim(p_key),'') end, p_tz)
  on conflict (user_id) do update set
    enabled = excluded.enabled, provider = excluded.provider, model = excluded.model, tz = excluded.tz,
    api_key = case when p_key = '__clear__' then null
                   else coalesce(nullif(trim(p_key),''), private.ai_settings.api_key) end,
    last_error = null;
end $$;

create or replace function public.get_ai_settings()
returns table (enabled boolean, provider text, model text, has_key boolean, key_hint text,
               last_run timestamptz, last_error text, last_found int)
language sql security definer stable set search_path = '' as $$
  select s.enabled, s.provider, s.model, s.api_key is not null,
         case when s.api_key is null then null else '••••' || right(s.api_key, 4) end,
         s.last_run, s.last_error, s.last_found
  from private.ai_settings s where s.user_id = auth.uid();
$$;

-- Push subscriptions (one row per device)
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz default now()
);
create index if not exists push_subs_user_idx on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists "own push subs" on public.push_subscriptions;
create policy "own push subs" on public.push_subscriptions for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.save_push_sub(p_endpoint text, p_p256dh text, p_auth text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  delete from public.push_subscriptions where endpoint = p_endpoint;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values (auth.uid(), p_endpoint, p_p256dh, p_auth);
end $$;

create or replace function public.delete_push_sub(p_endpoint text)
returns void language sql security definer set search_path = '' as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;

-- Let people rename themselves
create or replace function public.set_my_name(p_name text)
returns void language sql security definer set search_path = '' as $$
  update public.profiles set name = left(trim(p_name), 60) where id = auth.uid() and length(trim(p_name)) > 0;
$$;

revoke execute on function public.save_ai_settings(boolean,text,text,text,text) from public, anon;
revoke execute on function public.get_ai_settings() from public, anon;
revoke execute on function public.save_push_sub(text,text,text) from public, anon;
revoke execute on function public.delete_push_sub(text) from public, anon;
revoke execute on function public.set_my_name(text) from public, anon;
grant execute on function public.save_ai_settings(boolean,text,text,text,text) to authenticated;
grant execute on function public.get_ai_settings() to authenticated;
grant execute on function public.save_push_sub(text,text,text) to authenticated;
grant execute on function public.delete_push_sub(text) to authenticated;
grant execute on function public.set_my_name(text) to authenticated;

-- Wake the worker when a message or a work bubble is created
create or replace function private.call_worker(payload jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare u text; s text;
begin
  select value into u from private.app_config where key = 'worker_url';
  select value into s from private.app_config where key = 'worker_secret';
  perform net.http_post(url := u, body := payload,
    headers := jsonb_build_object('Content-Type','application/json','x-worker-secret', s));
end $$;
revoke execute on function private.call_worker(jsonb) from public, anon, authenticated;

create or replace function private.on_message_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin perform private.call_worker(jsonb_build_object('action','message','id', new.id)); return new; end $$;

create or replace function private.on_task_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin perform private.call_worker(jsonb_build_object('action','task','id', new.id)); return new; end $$;

drop trigger if exists messages_notify on public.messages;
create trigger messages_notify after insert on public.messages for each row execute function private.on_message_insert();
drop trigger if exists tasks_notify on public.tasks;
create trigger tasks_notify after insert on public.tasks for each row execute function private.on_task_insert();

-- Every 5 minutes: reminders + AI scan
select cron.unschedule(jobid) from cron.job where jobname = 'whatswork-worker';
select cron.schedule('whatswork-worker', '*/5 * * * *', $$select private.call_worker('{"action":"cron"}'::jsonb)$$);
