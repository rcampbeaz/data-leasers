-- dataleasers CRM: media assets for the social console. Run after 0010_social_publish.sql.
--
-- The bucket is public because the platforms fetch the file themselves: Instagram and
-- TikTok are given a URL and retrieve the asset from it, so a private bucket would mean
-- short-lived signed URLs that expire before a scheduled post goes out. Public means the
-- URL is readable by anyone who has it, which is the same exposure as the published post.
-- Nothing confidential belongs in this bucket.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'social-media',
  'social-media',
  true,
  26214400, -- 25 MB, which is the ceiling the upload action also enforces
  array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- One row per uploaded asset. Alt text and the rights note live here rather than on the
-- post, because they describe the file: the same photograph reused in three posts has one
-- alt text and one licence, not three.
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

comment on column public.social_media.rights_note is
  'Where the asset came from and what it may be used for. Required: publishing an asset without a recorded right is the one mistake this console exists to avoid.';

alter table public.social_media enable row level security;

create policy "staff read social media" on public.social_media
  for select using (public.is_staff());
create policy "introducers write social media" on public.social_media
  for all using (public.is_staff(array['admin', 'introducer']))
  with check (public.is_staff(array['admin', 'introducer']));

-- Storage itself. The upload action uses the staff client, so these are what let a signed-in
-- introducer write a file without the service-role key.
drop policy if exists "staff read social media objects" on storage.objects;
create policy "staff read social media objects" on storage.objects
  for select using (bucket_id = 'social-media' and public.is_staff());

drop policy if exists "introducers write social media objects" on storage.objects;
create policy "introducers write social media objects" on storage.objects
  for insert with check (bucket_id = 'social-media' and public.is_staff(array['admin', 'introducer']));

drop policy if exists "introducers delete social media objects" on storage.objects;
create policy "introducers delete social media objects" on storage.objects
  for delete using (bucket_id = 'social-media' and public.is_staff(array['admin', 'introducer']));
