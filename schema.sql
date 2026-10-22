-- WhatsWork database schema (Supabase / Postgres)

-- PROFILES -----------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  name text,
  created_at timestamptz default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, lower(new.email), coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- CONVERSATIONS ------------------------------------------------------
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  title text,
  created_at timestamptz default now()
);

create table if not exists public.conversation_members (
  conversation_id uuid references public.conversations(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  primary key (conversation_id, user_id)
);

create or replace function public.is_member(conv uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from conversation_members where conversation_id = conv and user_id = auth.uid());
$$;

-- MESSAGES -----------------------------------------------------------
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) default auth.uid(),
  body text,
  file_path text,
  file_name text,
  file_type text,
  created_at timestamptz default now()
);
create index if not exists messages_conv_idx on public.messages(conversation_id, created_at);

-- TASKS (the bubbles) ------------------------------------------------
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid references public.messages(id) on delete set null,
  created_by uuid references public.profiles(id) default auth.uid(),
  assignee_id uuid references public.profiles(id),
  title text not null,
  details text,
  due_at timestamptz,
  status text not null default 'open' check (status in ('open','done')),
  source text not null default 'manual' check (source in ('manual','ai')),
  created_at timestamptz default now(),
  done_at timestamptz
);
create index if not exists tasks_conv_idx on public.tasks(conversation_id, status);

-- PRIVACY RULES (RLS) ------------------------------------------------
alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.tasks enable row level security;

drop policy if exists "profiles readable by signed-in" on public.profiles;
create policy "profiles readable by signed-in" on public.profiles for select to authenticated using (true);
drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles for update to authenticated using (id = auth.uid());

drop policy if exists "members see conversation" on public.conversations;
create policy "members see conversation" on public.conversations for select to authenticated using (public.is_member(id));

drop policy if exists "members see membership" on public.conversation_members;
create policy "members see membership" on public.conversation_members for select to authenticated using (public.is_member(conversation_id));

drop policy if exists "members read messages" on public.messages;
create policy "members read messages" on public.messages for select to authenticated using (public.is_member(conversation_id));
drop policy if exists "members send messages" on public.messages;
create policy "members send messages" on public.messages for insert to authenticated
  with check (public.is_member(conversation_id) and sender_id = auth.uid());

drop policy if exists "members read tasks" on public.tasks;
create policy "members read tasks" on public.tasks for select to authenticated using (public.is_member(conversation_id));
drop policy if exists "members create tasks" on public.tasks;
create policy "members create tasks" on public.tasks for insert to authenticated with check (public.is_member(conversation_id));
drop policy if exists "members update tasks" on public.tasks;
create policy "members update tasks" on public.tasks for update to authenticated
  using (public.is_member(conversation_id)) with check (public.is_member(conversation_id));
drop policy if exists "members delete tasks" on public.tasks;
create policy "members delete tasks" on public.tasks for delete to authenticated using (public.is_member(conversation_id));

-- START A CHAT WITH SOMEONE BY EMAIL ---------------------------------
create or replace function public.start_dm(other_email text)
returns uuid language plpgsql security definer set search_path = public as $$
declare other uuid; conv uuid;
begin
  select id into other from profiles where email = lower(trim(other_email));
  if other is null then raise exception 'No WhatsWork user with that email yet — ask them to sign up first.'; end if;
  if other = auth.uid() then raise exception 'That is your own email.'; end if;
  select a.conversation_id into conv from conversation_members a
    join conversation_members b on a.conversation_id = b.conversation_id
    where a.user_id = auth.uid() and b.user_id = other
      and (select count(*) from conversation_members c where c.conversation_id = a.conversation_id) = 2
    limit 1;
  if conv is not null then return conv; end if;
  insert into conversations default values returning id into conv;
  insert into conversation_members values (conv, auth.uid()), (conv, other);
  return conv;
end $$;
revoke execute on function public.start_dm(text) from public, anon;
grant execute on function public.start_dm(text) to authenticated;
revoke execute on function public.is_member(uuid) from public, anon;
grant execute on function public.is_member(uuid) to authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Make sure signed-in users can reach the tables (RLS above still limits rows)
grant select, insert, update, delete on public.messages, public.tasks to authenticated;
grant select on public.conversations, public.conversation_members to authenticated;
grant select, update on public.profiles to authenticated;

-- FILE STORAGE (pictures, logos, files) ------------------------------
insert into storage.buckets (id, name, public) values ('attachments','attachments', false)
  on conflict (id) do nothing;

drop policy if exists "members upload files" on storage.objects;
create policy "members upload files" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and public.is_member(((storage.foldername(name))[1])::uuid));
drop policy if exists "members read files" on storage.objects;
create policy "members read files" on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and public.is_member(((storage.foldername(name))[1])::uuid));

-- LIVE UPDATES -------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.tasks;
exception when duplicate_object then null; end $$;
