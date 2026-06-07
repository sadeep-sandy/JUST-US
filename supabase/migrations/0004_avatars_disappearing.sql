-- =============================================================
--  Batch 3: avatars (public bucket) + disappearing messages.
--  Run in the Supabase SQL Editor after 0003.
-- =============================================================

-- 1) Public 'avatars' bucket (profile photos are low-sensitivity and need to
--    be visible to the partner, so a public bucket keeps it simple).
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "avatars_read" on storage.objects;
create policy "avatars_read" on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists "avatars_write" on storage.objects;
create policy "avatars_write" on storage.objects
  for insert with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_update" on storage.objects;
create policy "avatars_update" on storage.objects
  for update using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 2) Disappearing messages: per-conversation timer (seconds; 0 = off).
alter table public.couples
  add column if not exists disappear_seconds integer not null default 0;

-- Allow members to update their conversation (e.g. the disappearing timer).
drop policy if exists "couples_update" on public.couples;
create policy "couples_update" on public.couples
  for update using (user_a = auth.uid() or user_b = auth.uid());

-- Hard-delete expired messages for a conversation (called by the app).
create or replace function public.purge_expired(p_couple uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_in_couple(p_couple) then
    raise exception 'Not allowed';
  end if;
  delete from public.messages
    where couple_id = p_couple
      and expires_at is not null
      and expires_at <= now();
end;
$$;
