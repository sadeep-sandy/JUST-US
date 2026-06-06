-- =============================================================
--  Private Couples Chat — database schema, privacy (RLS) & storage
--  Run this in the Supabase SQL Editor (or via the Supabase CLI).
-- =============================================================

-- ----------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------

-- One row per user, mirrors auth.users. Created automatically on sign-up.
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url  text,
  created_at  timestamptz not null default now()
);

-- The link between two partners. Exactly one couple per user in v1.
create table if not exists public.couples (
  id         uuid primary key default gen_random_uuid(),
  user_a     uuid not null references auth.users(id) on delete cascade,
  user_b     uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_a, user_b)
);

-- Invite codes: one partner generates, the other redeems to form a couple.
create table if not exists public.invites (
  code       text primary key,
  created_by uuid not null references auth.users(id) on delete cascade,
  used_by    uuid references auth.users(id) on delete set null,
  couple_id  uuid references public.couples(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

-- Chat messages. Media (images/voice/files) live in Storage; we keep the path.
create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  couple_id  uuid not null references public.couples(id) on delete cascade,
  sender_id  uuid not null references auth.users(id) on delete cascade,
  kind       text not null default 'text' check (kind in ('text','image','audio','file')),
  body       text,
  media_path text,
  created_at timestamptz not null default now(),
  read_at    timestamptz
);

create index if not exists messages_couple_created_idx
  on public.messages (couple_id, created_at);

-- ----------------------------------------------------------------
-- Helper functions (SECURITY DEFINER avoids RLS recursion)
-- ----------------------------------------------------------------

-- True if the current user is a member of the given couple.
create or replace function public.is_in_couple(p_couple uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.couples c
    where c.id = p_couple
      and (c.user_a = auth.uid() or c.user_b = auth.uid())
  );
$$;

-- True if the given user is the current user's partner.
create or replace function public.is_my_partner(p_user uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.couples c
    where (c.user_a = auth.uid() and c.user_b = p_user)
       or (c.user_b = auth.uid() and c.user_a = p_user)
  );
$$;

-- ----------------------------------------------------------------
-- Auto-create a profile when a user signs up
-- ----------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------
-- Redeem an invite -> create a couple (runs with elevated rights so the
-- redeemer can look up a code that isn't theirs, but all checks are enforced).
-- ----------------------------------------------------------------
create or replace function public.redeem_invite(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite   public.invites;
  v_couple_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_invite from public.invites where code = p_code for update;
  if not found then
    raise exception 'Invalid invite code';
  end if;
  if v_invite.used_by is not null then
    raise exception 'This invite has already been used';
  end if;
  if v_invite.expires_at < now() then
    raise exception 'This invite has expired';
  end if;
  if v_invite.created_by = auth.uid() then
    raise exception 'You cannot redeem your own invite';
  end if;

  if exists (select 1 from public.couples where user_a = auth.uid() or user_b = auth.uid()) then
    raise exception 'You are already paired with someone';
  end if;
  if exists (select 1 from public.couples where user_a = v_invite.created_by or user_b = v_invite.created_by) then
    raise exception 'This person is already paired with someone';
  end if;

  insert into public.couples (user_a, user_b)
  values (v_invite.created_by, auth.uid())
  returning id into v_couple_id;

  update public.invites
    set used_by = auth.uid(), couple_id = v_couple_id
    where code = p_code;

  return v_couple_id;
end;
$$;

-- ----------------------------------------------------------------
-- Row Level Security — the core privacy guarantee
-- ----------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.couples  enable row level security;
alter table public.invites  enable row level security;
alter table public.messages enable row level security;

-- profiles: you can see yourself and your partner; you can edit only yourself.
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select using (id = auth.uid() or public.is_my_partner(id));

drop policy if exists "profiles_insert" on public.profiles;
create policy "profiles_insert" on public.profiles
  for insert with check (id = auth.uid());

drop policy if exists "profiles_update" on public.profiles;
create policy "profiles_update" on public.profiles
  for update using (id = auth.uid());

-- couples: you can only see couples you belong to. Creation happens via redeem_invite().
drop policy if exists "couples_select" on public.couples;
create policy "couples_select" on public.couples
  for select using (user_a = auth.uid() or user_b = auth.uid());

-- invites: you can create and see your own invites.
drop policy if exists "invites_select" on public.invites;
create policy "invites_select" on public.invites
  for select using (created_by = auth.uid());

drop policy if exists "invites_insert" on public.invites;
create policy "invites_insert" on public.invites
  for insert with check (created_by = auth.uid());

-- messages: only members of the couple can read/write; read receipts via update.
drop policy if exists "messages_select" on public.messages;
create policy "messages_select" on public.messages
  for select using (public.is_in_couple(couple_id));

drop policy if exists "messages_insert" on public.messages;
create policy "messages_insert" on public.messages
  for insert with check (public.is_in_couple(couple_id) and sender_id = auth.uid());

drop policy if exists "messages_update" on public.messages;
create policy "messages_update" on public.messages
  for update using (public.is_in_couple(couple_id));

-- ----------------------------------------------------------------
-- Realtime: stream new messages to subscribed clients
-- ----------------------------------------------------------------
alter publication supabase_realtime add table public.messages;

-- ----------------------------------------------------------------
-- Storage: private 'media' bucket, scoped per couple by folder name.
-- Files are stored as  {couple_id}/{filename}
-- ----------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('media', 'media', false)
on conflict (id) do nothing;

drop policy if exists "media_read" on storage.objects;
create policy "media_read" on storage.objects
  for select using (
    bucket_id = 'media'
    and public.is_in_couple(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "media_write" on storage.objects;
create policy "media_write" on storage.objects
  for insert with check (
    bucket_id = 'media'
    and public.is_in_couple(((storage.foldername(name))[1])::uuid)
  );
