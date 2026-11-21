-- WhatsWork v7: your team (designer, video editors) and the work each one has, with a private link per person

create table if not exists public.team_people (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null default '' check (length(name) <= 60),
  role text not null default 'editor' check (role in ('designer', 'editor', 'other')),
  role_label text check (length(role_label) <= 60),
  color text check (length(color) <= 20),
  sort int not null default 0,
  token_hash text unique check (token_hash ~ '^[0-9a-f]{64}$'),
  link_made timestamptz,
  last_seen timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists team_people_user_idx on public.team_people(user_id);

create table if not exists public.team_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  person_id uuid references public.team_people(id) on delete set null,
  title text not null check (length(trim(title)) between 1 and 140),
  client text check (length(client) <= 40),
  brief text check (length(brief) <= 4000),
  refs text check (length(refs) <= 2000),
  due date,
  priority text not null default 'normal' check (priority in ('urgent', 'normal')),
  status text not null default 'todo' check (status in ('todo', 'doing', 'done')),
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists team_jobs_user_idx on public.team_jobs(user_id, status);
create index if not exists team_jobs_person_idx on public.team_jobs(person_id);

alter table public.team_people enable row level security;
alter table public.team_jobs enable row level security;
drop policy if exists "own team" on public.team_people;
create policy "own team" on public.team_people for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "own jobs" on public.team_jobs;
create policy "own jobs" on public.team_jobs for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.team_people, public.team_jobs to authenticated;
do $$ begin alter publication supabase_realtime add table public.team_jobs; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.team_people; exception when duplicate_object then null; end $$;
