-- WhatsWork v3: College Planner inside WhatsWork (private to its owner)
create table if not exists public.planner_docs (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (name ~ '^(main|track-\d{4}-\d{2})$'),
  json text not null,
  v int not null default 1,
  updated_at timestamptz not null default now(),
  primary key (user_id, name)
);
alter table public.planner_docs enable row level security;
drop policy if exists "own planner" on public.planner_docs;
create policy "own planner" on public.planner_docs for select to authenticated using (user_id = (select auth.uid()));
grant select on public.planner_docs to authenticated;

create or replace function public.planner_save(p_name text, p_json text)
returns int language plpgsql security definer set search_path = '' as $$
declare nv int;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if p_name !~ '^(main|track-\d{4}-\d{2})$' then raise exception 'Unknown record name'; end if;
  if length(p_json) > 4000000 then raise exception 'The data is too large'; end if;
  perform p_json::jsonb;
  insert into public.planner_docs (user_id, name, json, v) values (auth.uid(), p_name, p_json, 1)
  on conflict (user_id, name) do update set json = excluded.json, v = public.planner_docs.v + 1, updated_at = now()
  returning v into nv;
  return nv;
end $$;

-- Planner data copied from Google Drive, handed to the owner's account on first open
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.planner_seed (name text primary key, owner_email text not null, json text not null);

create or replace function public.planner_claim_seed()
returns int language plpgsql security definer set search_path = '' as $$
declare n int := 0; em text;
begin
  if auth.uid() is null then return 0; end if;
  select lower(email) into em from auth.users where id = auth.uid();
  if exists (select 1 from public.planner_docs where user_id = auth.uid()) then return 0; end if;
  insert into public.planner_docs (user_id, name, json, v)
    select auth.uid(), s.name, s.json, 1 from private.planner_seed s where lower(s.owner_email) = em;
  get diagnostics n = row_count;
  delete from private.planner_seed where lower(owner_email) = em;
  return n;
end $$;

revoke execute on function public.planner_save(text,text) from public, anon;
revoke execute on function public.planner_claim_seed() from public, anon;
grant execute on function public.planner_save(text,text) to authenticated;
grant execute on function public.planner_claim_seed() to authenticated;

-- Uploaded posts (private, one folder per person)
insert into storage.buckets (id, name, public, file_size_limit) values ('planner','planner', false, 52428800)
  on conflict (id) do nothing;
drop policy if exists "planner own upload" on storage.objects;
create policy "planner own upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'planner' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "planner own read" on storage.objects;
create policy "planner own read" on storage.objects for select to authenticated
  using (bucket_id = 'planner' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "planner own delete" on storage.objects;
create policy "planner own delete" on storage.objects for delete to authenticated
  using (bucket_id = 'planner' and (storage.foldername(name))[1] = (select auth.uid())::text);

do $$ begin
  alter publication supabase_realtime add table public.planner_docs;
exception when duplicate_object then null; end $$;

-- __PLANNER_SEED__
