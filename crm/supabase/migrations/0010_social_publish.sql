-- dataleasers CRM: what the publishing engine needs. Run after 0009_social.sql.

-- Per-channel delivery state. A channel row already carried a status and an error;
-- what it lacked was a way to say "wait until this time before trying again" and a
-- note of which provider sent it, so a stub run can never be mistaken for a real one.
alter table public.social_post_channels
  add column if not exists next_attempt_at timestamptz,
  add column if not exists provider text check (char_length(provider) <= 40);

comment on column public.social_post_channels.next_attempt_at is
  'When a retry becomes due. Null means no retry is pending.';

-- One failure email per post, not one per cron run. Without this every sweep of a
-- broken post would send another message.
alter table public.social_posts
  add column if not exists failure_notified_at timestamptz;

-- The due sweep looks for retries waiting on the clock.
create index if not exists social_post_channels_retry_idx
  on public.social_post_channels (next_attempt_at) where status = 'scheduled';
