-- WhatsWork v6: notification choices, and a portal for the graphic designer

-- 1. Which notifications you want, how early, sound on or off, alarms
alter table public.profiles add column if not exists notify jsonb not null default '{}'::jsonb;
create or replace function public.ww_set_notify(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if jsonb_typeof(p) <> 'object' or length(p::text) > 4000 then raise exception 'Bad settings'; end if;
  update public.profiles set notify = p where id = auth.uid();
end $$;
revoke execute on function public.ww_set_notify(jsonb) from public, anon;
grant execute on function public.ww_set_notify(jsonb) to authenticated;

-- 2. Files the designer (or you) upload for a post
create table if not exists public.post_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_key text not null check (length(item_key) <= 200),
  post_date date not null,
  title text check (length(title) <= 200),
  path text not null unique,
  name text not null check (length(name) <= 200),
  mime text,
  size bigint,
  uploaded_by text not null default 'designer' check (uploaded_by in ('designer', 'me')),
  note text check (length(note) <= 1000),
  created_at timestamptz not null default now()
);
create index if not exists post_files_user_idx on public.post_files(user_id, post_date);
alter table public.post_files enable row level security;
drop policy if exists "own post files" on public.post_files;
create policy "own post files" on public.post_files for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.post_files to authenticated;
do $$ begin alter publication supabase_realtime add table public.post_files; exception when duplicate_object then null; end $$;

-- 3. A private storage folder per person; only the owner can read it (the designer uploads through the worker)
insert into storage.buckets (id, name, public, file_size_limit)
values ('designs', 'designs', false, 52428800)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;
drop policy if exists "own designs read" on storage.objects;
create policy "own designs read" on storage.objects for select to authenticated using (bucket_id = 'designs' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "own designs write" on storage.objects;
create policy "own designs write" on storage.objects for insert to authenticated with check (bucket_id = 'designs' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "own designs delete" on storage.objects;
create policy "own designs delete" on storage.objects for delete to authenticated using (bucket_id = 'designs' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- 4. The designer's link: only a fingerprint of the key is stored
create table if not exists private.designer_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  designer_name text,
  created_at timestamptz not null default now(),
  last_used timestamptz
);
create or replace function public.ww_set_designer_token(p_hash text, p_name text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if p_hash is null then delete from private.designer_tokens where user_id = auth.uid(); return; end if;
  if p_hash !~ '^[0-9a-f]{64}$' then raise exception 'Bad key'; end if;
  insert into private.designer_tokens (user_id, token_hash, designer_name) values (auth.uid(), p_hash, left(p_name, 60))
  on conflict (user_id) do update set token_hash = excluded.token_hash, designer_name = excluded.designer_name, created_at = now(), last_used = null;
end $$;
create or replace function public.ww_designer_token_info()
returns table (designer_name text, created_at timestamptz, last_used timestamptz)
language sql security definer stable set search_path = '' as $$
  select t.designer_name, t.created_at, t.last_used from private.designer_tokens t where t.user_id = auth.uid();
$$;
revoke execute on function public.ww_set_designer_token(text, text) from public, anon;
revoke execute on function public.ww_designer_token_info() from public, anon;
grant execute on function public.ww_set_designer_token(text, text) to authenticated;
grant execute on function public.ww_designer_token_info() to authenticated;
