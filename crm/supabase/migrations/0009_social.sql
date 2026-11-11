-- dataleasers CRM: the marketing console. Run after 0008_partner_erasure.sql.
--
-- One brand, a handful of channels. A piece of content is written once, then one row
-- per channel carries the state, because "published to three of four channels" is the
-- normal case rather than an exception.

-- 1. A connected account on one network. `credentials` holds only the provider's
-- profile key, never a raw OAuth token, so a database read cannot become a takeover.
create table if not exists public.social_channels (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('linkedin', 'facebook', 'instagram', 'tiktok', 'bluesky', 'x')),
  external_id text not null check (char_length(external_id) between 1 and 200),
  display_name text not null check (char_length(display_name) between 1 and 200),
  username text check (char_length(username) <= 200),
  avatar_url text check (char_length(avatar_url) <= 1000),
  provider text not null default 'aggregator' check (provider in ('aggregator', 'direct')),
  credentials jsonb not null default '{}'::jsonb,
  token_expires_at timestamptz,
  status text not null default 'active' check (status in ('active', 'needs_reauth', 'revoked')),
  last_ok_at timestamptz,
  last_error text,
  -- privacy level, first-comment behaviour, hashtag set, UTM parameters
  defaults jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (platform, external_id)
);

-- 2. What was written, before it becomes one post per channel.
create table if not exists public.social_contents (
  id uuid primary key default gen_random_uuid(),
  title text check (char_length(title) <= 200),
  body text not null check (char_length(body) between 1 and 20000),
  -- { "linkedin": "…", "x": "…" } — stored, not recomputed, so what was scheduled is
  -- what gets published.
  variants jsonb not null default '{}'::jsonb,
  link text check (char_length(link) <= 1000),
  media jsonb not null default '[]'::jsonb,
  campaign text check (char_length(campaign) <= 100),
  status text not null default 'draft'
    check (status in ('draft', 'needs_review', 'approved', 'scheduled', 'published', 'cancelled')),
  created_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists social_contents_status_idx on public.social_contents (status, created_at desc);

-- 3. One row per channel per content item. Media is frozen here as well, so editing
-- the content library later cannot change what a channel was validated against.
create table if not exists public.social_posts (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.social_contents(id) on delete cascade,
  channel_id uuid not null references public.social_channels(id) on delete restrict,
  body text not null,
  first_comment text,
  media jsonb not null default '[]'::jsonb,
  scheduled_for timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'publishing', 'published', 'failed', 'cancelled', 'needs_manual')),
  provider_post_id text,
  permalink text,
  attempts integer not null default 0 check (attempts >= 0),
  last_error_code text,
  last_error text,
  next_retry_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  -- The anti-double-post guard, at the data layer rather than in the UI.
  unique (content_id, channel_id)
);
create index if not exists social_posts_due_idx on public.social_posts (scheduled_for)
  where status in ('scheduled', 'failed');
create index if not exists social_posts_channel_idx on public.social_posts (channel_id, scheduled_for desc);

-- 4. Media library. Alt text is a field, not an afterthought, and rights are recorded
-- because the product is literally about rights.
create table if not exists public.social_media (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null,
  mime text not null check (char_length(mime) <= 100),
  width integer,
  height integer,
  duration_seconds integer,
  size_bytes bigint,
  checksum text,
  alt_text text,
  rights_source text,
  rights_paid_ok boolean not null default false,
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- 5. Weekly slots per channel, so a queue can place posts without a calendar argument.
create table if not exists public.social_slots (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.social_channels(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  time_of_day time not null,
  enabled boolean not null default true,
  unique (channel_id, weekday, time_of_day)
);

-- 6. Engagement snapshots, captured by date so numbers can be compared over time.
create table if not exists public.social_metrics (
  id bigint generated always as identity primary key,
  post_id uuid not null references public.social_posts(id) on delete cascade,
  captured_on date not null,
  impressions integer,
  reach integer,
  likes integer,
  comments integer,
  shares integer,
  clicks integer,
  follows integer,
  raw jsonb,
  unique (post_id, captured_on)
);

-- 7. Claim work for the publisher without two runs taking the same row.
-- security definer + revoked grants: only the server (service role) may take work.
create or replace function public.claim_social_posts(batch_size integer default 10)
returns setof public.social_posts
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.social_posts p
     set status = 'publishing',
         attempts = p.attempts + 1,
         last_error = null
   where p.id in (
     select id
       from public.social_posts
      where status in ('scheduled', 'failed')
        and scheduled_for <= now()
        and (next_retry_at is null or next_retry_at <= now())
      order by scheduled_for
      limit greatest(batch_size, 1)
      for update skip locked
   )
  returning p.*;
end;
$$;

revoke all on function public.claim_social_posts(integer) from public;
revoke all on function public.claim_social_posts(integer) from anon;
revoke all on function public.claim_social_posts(integer) from authenticated;

-- 8. Row-level security. Staff read everything; admins connect channels; admins and
-- introducers write content and posts. The publisher runs as the service role.
alter table public.social_channels enable row level security;
alter table public.social_contents enable row level security;
alter table public.social_posts enable row level security;
alter table public.social_media enable row level security;
alter table public.social_slots enable row level security;
alter table public.social_metrics enable row level security;

create policy "staff read channels" on public.social_channels
  for select using (public.is_staff());
create policy "admins manage channels" on public.social_channels
  for all using (public.is_staff(array['admin']))
  with check (public.is_staff(array['admin']));

create policy "staff read contents" on public.social_contents
  for select using (public.is_staff());
create policy "introducers write contents" on public.social_contents
  for all using (public.is_staff(array['admin', 'introducer']))
  with check (public.is_staff(array['admin', 'introducer']));

create policy "staff read posts" on public.social_posts
  for select using (public.is_staff());
create policy "introducers write posts" on public.social_posts
  for all using (public.is_staff(array['admin', 'introducer']))
  with check (public.is_staff(array['admin', 'introducer']));

create policy "staff read media" on public.social_media
  for select using (public.is_staff());
create policy "introducers write media" on public.social_media
  for all using (public.is_staff(array['admin', 'introducer']))
  with check (public.is_staff(array['admin', 'introducer']));

create policy "staff read slots" on public.social_slots
  for select using (public.is_staff());
create policy "admins write slots" on public.social_slots
  for all using (public.is_staff(array['admin']))
  with check (public.is_staff(array['admin']));

create policy "staff read metrics" on public.social_metrics
  for select using (public.is_staff());
