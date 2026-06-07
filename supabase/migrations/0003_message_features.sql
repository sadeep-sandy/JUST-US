-- =============================================================
--  Message features: reactions, reply, edit, delete (+ columns for
--  disappearing messages and last-seen, used by later batches).
--  Run in the Supabase SQL Editor after 0002.
-- =============================================================

-- New columns on messages.
alter table public.messages add column if not exists reply_to uuid
  references public.messages(id) on delete set null;
alter table public.messages add column if not exists edited_at timestamptz;
alter table public.messages add column if not exists deleted_at timestamptz;
alter table public.messages add column if not exists expires_at timestamptz;

-- Last-seen timestamp on profiles (for "last seen" status later).
alter table public.profiles add column if not exists last_seen timestamptz;

-- Reactions: one emoji per user per message (changing it is an upsert).
create table if not exists public.reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  emoji      text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

-- Helper: can the current user access a given message (i.e. it's in their couple)?
create or replace function public.can_access_message(p_message uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.messages m
    where m.id = p_message and public.is_in_couple(m.couple_id)
  );
$$;

alter table public.reactions enable row level security;

drop policy if exists "reactions_select" on public.reactions;
create policy "reactions_select" on public.reactions
  for select using (public.can_access_message(message_id));

drop policy if exists "reactions_insert" on public.reactions;
create policy "reactions_insert" on public.reactions
  for insert with check (
    user_id = auth.uid() and public.can_access_message(message_id)
  );

drop policy if exists "reactions_update" on public.reactions;
create policy "reactions_update" on public.reactions
  for update using (user_id = auth.uid());

drop policy if exists "reactions_delete" on public.reactions;
create policy "reactions_delete" on public.reactions
  for delete using (user_id = auth.uid());

alter publication supabase_realtime add table public.reactions;

-- Edit/delete must be limited to the message's sender. But read-receipts need
-- the *recipient* to update messages too — so we move read-receipts to an RPC
-- and tighten the UPDATE policy to the sender only.
drop policy if exists "messages_update" on public.messages;
create policy "messages_update" on public.messages
  for update using (sender_id = auth.uid());

create or replace function public.mark_read(p_couple uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_in_couple(p_couple) then
    raise exception 'Not allowed';
  end if;
  update public.messages
    set read_at = now()
    where couple_id = p_couple
      and sender_id <> auth.uid()
      and read_at is null;
end;
$$;
