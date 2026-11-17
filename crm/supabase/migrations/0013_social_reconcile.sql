-- dataleasers CRM: bring a partially-applied social schema up to date. Run after 0012.
--
-- This exists because 0009 can stop partway: it creates three tables, then enables row-level
-- security and writes the policies. If it fails on a table, none of the security work runs,
-- and the tables it already created are left in the public schema without RLS — readable and
-- writable with the anon key. 0010 and 0012 then fail as well, because they alter the table
-- that was never created.
--
-- Every statement here is idempotent, so it is safe on a database that is already complete,
-- on one that is half complete, and on one where it has been run before. Run it whenever the
-- verification query reports anything missing.

begin;

-- 1. The bucket the composer uploads to. Public because Instagram and TikTok fetch the file
--    themselves; see 0011 for why that is the only workable option.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'social-media',
  'social-media',
  true,
  26214400,
  array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 2. The upload ledger, if 0011 did not get this far.
create table if not exists public.social_media (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null unique check (char_length(storage_path) <= 500),
  public_url text not null check (char_length(public_url) <= 2000),
  kind text not null check (kind in ('image', 'video')),
  mime_type text not null check (char_length(mime_type) <= 100),
  byte_size bigint not null check (byte_size > 0),
  alt_text text not null check (char_length(alt_text) between 1 and 1000),
  rights_note text not null check (char_length(rights_note) between 1 and 1000),
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists social_media_created_idx on public.social_media (created_at desc);

-- 3. The per-channel row, which is what 0009 was creating when it stopped.
create table if not exists public.social_post_channels (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.social_posts(id) on delete cascade,
  channel_id uuid not null references public.social_channels(id) on delete restrict,
  body text check (char_length(body) <= 10000),
  status text not null default 'pending'
    check (status in ('pending', 'scheduled', 'publishing', 'published', 'failed', 'skipped')),
  remote_id text check (char_length(remote_id) <= 400),
  permalink text check (char_length(permalink) <= 2000),
  error text check (char_length(error) <= 2000),
  attempts integer not null default 0 check (attempts >= 0),
  published_at timestamptz,
  unique (post_id, channel_id)
);
create index if not exists social_post_channels_post_idx on public.social_post_channels (post_id);
create index if not exists social_post_channels_channel_idx
  on public.social_post_channels (channel_id, status);

-- 4. The columns 0010 and 0012 add.
alter table public.social_post_channels
  add column if not exists next_attempt_at timestamptz,
  add column if not exists provider text check (char_length(provider) <= 40);

alter table public.social_posts
  add column if not exists failure_notified_at timestamptz,
  add column if not exists media_id uuid references public.social_media(id) on delete set null;

create index if not exists social_post_channels_retry_idx
  on public.social_post_channels (next_attempt_at) where status = 'scheduled';
create index if not exists social_posts_media_idx on public.social_posts (media_id);

-- 5. The security work. This is the part that silently does not run when a migration stops.
--    Dropping first is what makes the file re-runnable; without it a second run fails here.
alter table public.social_channels enable row level security;
alter table public.social_posts enable row level security;
alter table public.social_post_channels enable row level security;
alter table public.social_media enable row level security;

drop policy if exists "staff read social channels" on public.social_channels;
create policy "staff read social channels" on public.social_channels
  for select using (public.is_staff());
drop policy if exists "admins write social channels" on public.social_channels;
create policy "admins write social channels" on public.social_channels
  for all using (public.is_staff(array['admin']))
  with check (public.is_staff(array['admin']));

drop policy if exists "staff read social posts" on public.social_posts;
create policy "staff read social posts" on public.social_posts
  for select using (public.is_staff());
drop policy if exists "introducers write social posts" on public.social_posts;
create policy "introducers write social posts" on public.social_posts
  for all using (public.is_staff(array['admin', 'introducer']))
  with check (public.is_staff(array['admin', 'introducer']));

drop policy if exists "staff read social post channels" on public.social_post_channels;
create policy "staff read social post channels" on public.social_post_channels
  for select using (public.is_staff());
drop policy if exists "introducers write social post channels" on public.social_post_channels;
create policy "introducers write social post channels" on public.social_post_channels
  for all using (public.is_staff(array['admin', 'introducer']))
  with check (public.is_staff(array['admin', 'introducer']));

drop policy if exists "staff read social media" on public.social_media;
create policy "staff read social media" on public.social_media
  for select using (public.is_staff());
drop policy if exists "introducers write social media" on public.social_media;
create policy "introducers write social media" on public.social_media
  for all using (public.is_staff(array['admin', 'introducer']))
  with check (public.is_staff(array['admin', 'introducer']));

drop policy if exists "staff read social media objects" on storage.objects;
create policy "staff read social media objects" on storage.objects
  for select using (bucket_id = 'social-media' and public.is_staff());
drop policy if exists "introducers write social media objects" on storage.objects;
create policy "introducers write social media objects" on storage.objects
  for insert with check (bucket_id = 'social-media' and public.is_staff(array['admin', 'introducer']));
drop policy if exists "introducers delete social media objects" on storage.objects;
create policy "introducers delete social media objects" on storage.objects
  for delete using (bucket_id = 'social-media' and public.is_staff(array['admin', 'introducer']));

commit;
