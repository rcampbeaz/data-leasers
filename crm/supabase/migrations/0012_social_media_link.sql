-- dataleasers CRM: which uploaded asset a post publishes. Run after 0011_social_media.sql.
--
-- The post already stored media_url, which is enough to publish and not enough to account
-- for: a URL cannot say where the asset came from or what it may be used for. Keeping the
-- asset id means the rights note recorded at upload is still there when the post is
-- reopened, months later, by someone who did not upload it.

alter table public.social_posts
  add column if not exists media_id uuid references public.social_media(id) on delete set null;

create index if not exists social_posts_media_idx on public.social_posts (media_id);

comment on column public.social_posts.media_id is
  'The uploaded asset this post uses. Null for a post that references an external URL, which is why the composer says the rights note was not recorded for those.';
