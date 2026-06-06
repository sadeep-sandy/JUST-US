-- =============================================================
--  Upgrade to multiple 1-on-1 conversations (Instagram-style DMs)
--  + call-log messages + realtime on the conversation list.
--  Run this in the Supabase SQL Editor after 0001_init.sql.
-- =============================================================

-- 1) Allow a user to have many conversations.
--    redeem_invite no longer blocks a second pairing; if the two people
--    are already connected it just returns the existing conversation.
create or replace function public.redeem_invite(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite    public.invites;
  v_couple_id uuid;
  v_existing  uuid;
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

  -- Already connected to this person? Reuse that conversation.
  select id into v_existing from public.couples
   where (user_a = v_invite.created_by and user_b = auth.uid())
      or (user_b = v_invite.created_by and user_a = auth.uid())
   limit 1;
  if v_existing is not null then
    update public.invites
      set used_by = auth.uid(), couple_id = v_existing
      where code = p_code;
    return v_existing;
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

-- 2) Allow a 'call' message kind for call-history entries.
alter table public.messages drop constraint if exists messages_kind_check;
alter table public.messages
  add constraint messages_kind_check
  check (kind in ('text', 'image', 'audio', 'file', 'call'));

-- 3) Stream new conversations to the inbox in real time.
alter publication supabase_realtime add table public.couples;
