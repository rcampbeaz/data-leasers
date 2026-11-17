-- dataleasers CRM: the social console's records. Run after 0008_partner_erasure.sql.
--
-- Three tables, not six. A channel is an account we can post to. A post is one
-- idea. A post channel is that idea as a specific platform will receive it.
--
-- The third table is the one that earns its keep. Once four networks are in play,
-- "published to three of four" is the normal outcome, not the exception: one
-- platform rejects the media, another expires a token. Recording each platform
-- separately is what makes that state representable instead of guessing from a
-- single status column.

-- 1. Channels: one row per account we can publish to.
create table if not exists public.social_channels (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('facebook', 'instagram', 'linkedin', 'tiktok')),
  handle text not null check (char_length(handle) between 1 and 200),
  display_name text check (char_length(display_name) <= 200),
  -- Whether the account posts as a Page, a company page or a person. It matters:
  -- a LinkedIn member post and a company post are different identities with
  -- different permissions, and the console has to say which one it is using.
  identity_kind text not null default 'page'
    check (identity_kind in ('page', 'company', 'profile', 'business')),
  -- The provider's identifier for the account, filled in when it is connected.
  external_id text check (char_length(external_id) <= 200),
  status text not null default 'pending'
    check (status in ('pending', 'connected', 'expired', 'error', 'disconnected')),
  token_expires_at timestamptz,
  last_checked_at timestamptz,
  last_error text check (char_length(last_error) <= 2000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (platform, handle)
);
create index if not exists social_channels_active_idx on public.social_channels (active, platform);

-- 2. Posts: the content of one idea, with the scheduling decision on it.
create table if not exists public.social_posts (
  id uuid primary key default gen_random_uuid(),
  body text not null check (char_length(body) between 1 and 10000),
  link_url text check (char_length(link_url) <= 2000),
  media_url text check (char_length(media_url) <= 2000),
  media_alt text check (char_length(media_alt) <= 1000),
  state text not null default 'draft'
    check (state in ('draft', 'scheduled', 'publishing', 'published', 'partial', 'failed', 'cancelled')),
  -- Stored in UTC. Every screen converts to America/Phoenix for reading and back
  -- again on the way in, which is why the conversion lives in one place.
  scheduled_for timestamptz,
  published_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A post cannot claim to be scheduled without a time to publish at.
  constraint social_posts_scheduled_needs_time
    check (state <> 'scheduled' or scheduled_for is not null)
);
create index if not exists social_posts_schedule_idx
  on public.social_posts (scheduled_for) where state = 'scheduled';
create index if not exists social_posts_state_idx on public.social_posts (state, created_at desc);

-- 3. Post channels: the same idea, per platform, with its own outcome.
create table if not exists public.social_post_channels (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.social_posts(id) on delete cascade,
  channel_id uuid not null references public.social_channels(id) on delete restrict,
  -- Null means "use the post body", so editing the master copy updates every
  -- channel that was not customised. An override is stored only when it differs.
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
create index if not exists social_post_channels_channel_idx on public.social_post_channels (channel_id, status);

-- 4. Row-level security. All staff can read the queue; admins and introducers
-- write it. Connecting a channel is admin-only, because it is the closest thing
-- to holding a credential.
alter table public.social_channels enable row level security;
alter table public.social_posts enable row level security;
alter table public.social_post_channels enable row level security;

create policy "staff read social channels" on public.social_channels
  for select using (public.is_staff());
create policy "admins write social channels" on public.social_channels
  for all using (public.is_staff(array['admin']))
  with check (public.is_staff(array['admin']));

create policy "staff read social posts" on public.social_posts
  for select using (public.is_staff());
create policy "introducers write social posts" on public.social_posts
  for all using (public.is_staff(array['admin', 'introducer']))
  with check (public.is_staff(array['admin', 'introducer']));

create policy "staff read social post channels" on public.social_post_channels
  for select using (public.is_staff());
create policy "introducers write social post channels" on public.social_post_channels
  for all using (public.is_staff(array['admin', 'introducer']))
  with check (public.is_staff(array['admin', 'introducer']));
