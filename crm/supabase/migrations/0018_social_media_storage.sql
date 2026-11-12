-- dataleasers CRM: storage for social images. Run after 0017_step_kinds.sql.
--
-- The publishing provider fetches the image itself, so the object has to be readable without a
-- session: a signed URL would expire before a scheduled post went out. The bucket therefore holds
-- only images that are about to be public anyway, and never anything from the CRM.
--
-- Uploads come from a server action using the service role, which is why no insert policy is needed
-- here. Nothing in the app reads the bucket with a user session.

insert into storage.buckets (id, name, public)
values ('social-media', 'social-media', true)
on conflict (id) do update set public = true;

-- Images are content, not user data: no personal information belongs in one. Stated here rather than
-- with a `comment on` statement, because storage.buckets is owned by Supabase's storage role and a
-- comment there needs ownership this migration does not have.
-- rule: social-media holds post images only. No CRM attachments, no personal documents.
