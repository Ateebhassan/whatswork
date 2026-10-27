-- WhatsWork v4: life planner. Calendars, events and post status. Chat is hidden, not deleted.

-- 1. Hide the chat (the data stays, nothing can read or write it through the app)
revoke all on public.conversations, public.conversation_members, public.messages, public.tasks from authenticated, anon;
revoke execute on function public.start_dm(text) from authenticated;
do $$ begin alter publication supabase_realtime drop table public.messages; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime drop table public.tasks; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime drop table public.conversation_members; exception when others then null; end $$;

-- 2. Your time zone
alter table public.profiles add column if not exists tz text not null default 'Asia/Karachi';

-- 3. Calendars
create table if not exists public.calendars (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  short_name text check (short_name is null or length(short_name) <= 20),
  color text not null default '#3157e8' check (color ~ '^#[0-9a-fA-F]{6}$'),
  kind text not null default 'manual' check (kind in ('manual', 'planner')),
  planner_college text check (planner_college in ('superior', 'law')),
  billing text not null default 'paid' check (billing in ('paid', 'unpaid', 'personal')),
  visible boolean not null default true,
  follows_world_days boolean not null default false,
  world_cats text[] not null default '{}',
  sort int not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists calendars_user_idx on public.calendars(user_id);

-- 4. Events: one-off or repeating, in your local time
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  calendar_id uuid not null references public.calendars(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 140),
  kind text not null default 'work' check (kind in ('sleep', 'shift', 'university', 'work', 'meeting', 'call', 'personal', 'post', 'other')),
  date date not null,
  start_time time,                 -- empty = all day
  end_time time,                   -- earlier than start = ends the next morning
  repeat text not null default 'none' check (repeat in ('none', 'daily', 'weekly')),
  repeat_days smallint[] not null default '{}',   -- 0 = Sunday
  repeat_until date,
  skip_dates date[] not null default '{}',
  notes text,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists events_user_idx on public.events(user_id);
create index if not exists events_calendar_idx on public.events(calendar_id);

-- 5. Made / scheduled ticks for posts on your own calendars (college posts keep using the planner's tracking)
create table if not exists public.post_status (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  calendar_id uuid not null references public.calendars(id) on delete cascade,
  item_key text not null check (length(item_key) <= 200),
  made boolean not null default false,
  scheduled boolean not null default false,
  skip boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (calendar_id, item_key)
);
create index if not exists post_status_user_idx on public.post_status(user_id);

-- 6. Privacy: each person only ever sees their own
alter table public.calendars enable row level security;
alter table public.events enable row level security;
alter table public.post_status enable row level security;

drop policy if exists "own calendars" on public.calendars;
create policy "own calendars" on public.calendars for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "own events" on public.events;
create policy "own events" on public.events for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and exists (select 1 from public.calendars c where c.id = calendar_id and c.user_id = (select auth.uid())));

drop policy if exists "own post status" on public.post_status;
create policy "own post status" on public.post_status for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and exists (select 1 from public.calendars c where c.id = calendar_id and c.user_id = (select auth.uid())));

grant select, insert, update, delete on public.calendars, public.events, public.post_status to authenticated;

-- 7. Starter calendars and routines (only for someone who has none yet)
create or replace function private.seed_planner(p_user uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare personal uuid; casa uuid; d date := (now() at time zone 'Asia/Karachi')::date;
begin
  if exists (select 1 from public.calendars where user_id = p_user) then return 0; end if;
  insert into public.calendars (user_id, name, short_name, color, kind, planner_college, billing, sort) values
    (p_user, 'Superior College', 'Superior', '#0b8a84', 'planner', 'superior', 'paid', 1),
    (p_user, 'Allama Iqbal Law College', 'AILC', '#8c1d2f', 'planner', 'law', 'paid', 2);
  insert into public.calendars (user_id, name, color, billing, sort) values (p_user, 'Personal', '#7c5cff', 'personal', 3) returning id into personal;
  insert into public.calendars (user_id, name, short_name, color, billing, sort) values (p_user, 'Casa Apps', 'Casa', '#3157e8', 'paid', 4) returning id into casa;
  insert into public.calendars (user_id, name, short_name, color, billing, sort) values (p_user, 'Tariq Studio', 'Tariq', '#e0812a', 'unpaid', 5);
  insert into public.calendars (user_id, name, short_name, color, billing, follows_world_days, world_cats, sort)
    values (p_user, 'Lawyer''s chamber', 'Chamber', '#5b8c2a', 'unpaid', true, '{law,world,national}', 6);
  -- night shift 9:30 pm to 5 am, Monday to Friday nights, until the day shift starts in January
  insert into public.events (user_id, calendar_id, title, kind, date, start_time, end_time, repeat, repeat_days, repeat_until, notes, source)
    values (p_user, casa, 'Night shift', 'shift', d, '21:30', '05:00', 'weekly', '{1,2,3,4,5}', '2026-12-31',
            'Check which nights you work and change the days if needed.', 'seed');
  -- a starting sleep block; change it to your real times
  insert into public.events (user_id, calendar_id, title, kind, date, start_time, end_time, repeat, notes, source)
    values (p_user, personal, 'Sleep', 'sleep', d, '06:00', '13:00', 'daily',
            'A starting guess. Change it to when you really sleep.', 'seed');
  return 6;
end $$;
revoke execute on function private.seed_planner(uuid) from public, anon, authenticated;

create or replace function public.ww_init()
returns int language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  return private.seed_planner(auth.uid());
end $$;
revoke execute on function public.ww_init() from public, anon;
grant execute on function public.ww_init() to authenticated;

-- (the app calls ww_init() the first time you open it, which adds the starter calendars)

-- 8. Live updates in the app
do $$ begin alter publication supabase_realtime add table public.calendars; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.events; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.post_status; exception when duplicate_object then null; end $$;
