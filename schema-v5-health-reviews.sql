-- WhatsWork v5: sleep and screen time, and reviews

-- 1. Sleep per night (filled by the iPhone Shortcut or by hand). "date" is the morning you woke up.
create table if not exists public.health_days (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  sleep_start timestamptz,
  sleep_end timestamptz,
  asleep_minutes int check (asleep_minutes between 0 and 1440),
  screen_minutes int check (screen_minutes between 0 and 1440),
  source text not null default 'manual' check (source in ('manual', 'shortcut', 'claude')),
  notes text,
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

-- 2. Screen time, as the daily average for a week (Settings > Screen Time shows this on iPhone)
create table if not exists public.health_weeks (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  week_start date not null,                     -- the Monday
  screen_avg_minutes int check (screen_avg_minutes between 0 and 1440),
  notes text,
  updated_at timestamptz not null default now(),
  primary key (user_id, week_start)
);

-- 3. Reviews: written by your AI key, by the built-in rules, or by Claude in a chat
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  period_start date,
  period_end date,
  kind text not null default 'on_demand' check (kind in ('weekly', 'on_demand')),
  source text not null default 'rules' check (source in ('ai', 'rules', 'claude')),
  model text,
  title text not null check (length(title) <= 120),
  summary text check (length(summary) <= 600),
  items jsonb not null default '[]'::jsonb,     -- [{ "type": "warning" | "tip" | "win", "text": "..." }]
  read boolean not null default false
);
create index if not exists reviews_user_idx on public.reviews(user_id, created_at desc);

alter table public.health_days enable row level security;
alter table public.health_weeks enable row level security;
alter table public.reviews enable row level security;
drop policy if exists "own health days" on public.health_days;
create policy "own health days" on public.health_days for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "own health weeks" on public.health_weeks;
create policy "own health weeks" on public.health_weeks for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "own reviews" on public.reviews;
create policy "own reviews" on public.reviews for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.health_days, public.health_weeks, public.reviews to authenticated;

-- 4. The iPhone Shortcut's key. Only a fingerprint (hash) is stored; the key itself stays on your phone.
create schema if not exists private;
create table if not exists private.health_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  last_used timestamptz
);

create or replace function public.ww_set_health_token(p_hash text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if p_hash !~ '^[0-9a-f]{64}$' then raise exception 'Bad key'; end if;
  insert into private.health_tokens (user_id, token_hash) values (auth.uid(), p_hash)
  on conflict (user_id) do update set token_hash = excluded.token_hash, created_at = now(), last_used = null;
end $$;

create or replace function public.ww_health_token_info()
returns table (created_at timestamptz, last_used timestamptz)
language sql security definer stable set search_path = '' as $$
  select t.created_at, t.last_used from private.health_tokens t where t.user_id = auth.uid();
$$;

revoke execute on function public.ww_set_health_token(text) from public, anon;
revoke execute on function public.ww_health_token_info() from public, anon;
grant execute on function public.ww_set_health_token(text) to authenticated;
grant execute on function public.ww_health_token_info() to authenticated;

do $$ begin alter publication supabase_realtime add table public.reviews; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.health_days; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.health_weeks; exception when duplicate_object then null; end $$;
