# Social media console: specification

Status: design for review. No code yet.

Scope: an internal console in the CRM (`app.dataleasers.com/social`) that writes, schedules and
publishes posts to the DataLeasers accounts on Facebook, Instagram, LinkedIn and TikTok, and
records what happened. One brand, four channels, a handful of posts a day. Not a product for
other customers, so multi-tenant concerns are out of scope.

---

## 1. The decision that shapes everything

There are two ways to publish: call each platform's API directly, or pay a unified posting API
to do it. The choice is not about code volume. It is about **who holds the platform approvals**,
because three of the four networks gate publishing behind a review.

### What each platform actually requires

| Channel | Requirement | Gate |
| --- | --- | --- |
| Facebook Page | Page access token with `pages_manage_posts` | Meta app; **Standard Access is enough for a Page you own**, so no App Review for DataLeasers' own Page |
| Instagram | Professional account, media at a public URL, 100 API-published posts per 24h (carousels count once) | Same Meta app. Publishing through Instagram Login avoids needing a linked Facebook Page; the Facebook Login route requires one |
| LinkedIn Page | `w_organization_social`, authorising member must be Page `ADMINISTRATOR` or `CONTENT_ADMIN` | **Community Management API, a partner application**: verified company Page of your own, a working demo, and an explanation of who uses it |
| TikTok | `video.publish`, Direct Post | **Audit required for public posts.** Until approved, every post is `SELF_ONLY` (private), capped at 5 posting users per 24h; a creator can take ~15 API posts a day and 5 pending shares |

Two consequences worth stating plainly:

- **TikTok cannot post publicly on day one.** Until the audit passes, the console can only
  publish private drafts that someone opens in the TikTok app and switches to public. That is
  still useful — it turns scheduling into "review and publish on your phone" — but it is not
  unattended posting, and the console must say so rather than appear broken.
- **LinkedIn is the slow approval.** The Community Management application wants a demo of the
  integration, which is a chicken-and-egg: build first, apply with the build. Posting to your
  *personal* profile (`w_member_social`) is a lighter product, but the brand should post as the
  Page.

### Recommendation: build the console, rent the publishing for now

Build the durable part ourselves — content, calendar, approvals, media, the record of what went
out and what it earned — and put publishing behind a **provider adapter** with one small
interface:

```ts
type PublishInput = {
  channel: Channel;
  body: string;
  media: MediaRef[];
  firstComment?: string;
  scheduledFor: string; // UTC
};
type PublishResult =
  | { ok: true; providerPostId: string; permalink?: string }
  | { ok: false; code: string; message: string; retryable: boolean };
```

Two implementations: `DirectProvider` (Meta Graph for Facebook and Instagram, LinkedIn REST
posting, TikTok Direct Post) and `AggregatorProvider` (one HTTP API for all four). Start on the
aggregator so all four channels work while LinkedIn and TikTok approvals are pending; move
Facebook and Instagram to direct when the aggregator's fee or limits start to bite, because that
pair is genuinely easy and free to do directly. The adapter means that switch never touches the
console screens.

Why not self-host an open-source tool (Postiz and similar)? They still require you to register
your own OAuth app on each network, so they do not remove the approvals — you inherit the same
gates plus a second codebase to run.

**Aggregator options, checked November 2026:** Post Bridge $39/mo (15 accounts, API included),
upload-post from $24/mo, bundle.social free for 20 posts/mo then $100/mo, Ayrshare from $149/mo
per profile (free basic tier caps at 20 posts/mo with branding). All four cover Facebook,
Instagram, LinkedIn and TikTok and hold the TikTok audit themselves.

**My pick:** start on **bundle.social's free tier** to prove the console end to end at no cost,
then either stay on its Pro tier or move to Post Bridge. Both are within a rounding error of
each other at this volume; the free tier is what makes the first month free.

### Costs, honestly

| Route | Money | Time | Risk |
| --- | --- | --- | --- |
| All direct | $0 | 2–4 weeks of work plus two approvals | LinkedIn/TikTok may take weeks or refuse; no posting until then |
| All aggregator | $0–$100/mo | ~3 days to a working console | Vendor dependency, per-post caps, their outage is your outage |
| Hybrid (recommended) | $0–$100/mo falling to $0 once Meta is direct | ~3 days, then 2 days for direct Meta | Two code paths to keep working |

---

## 2. What the console contains

### 2.1 Composer

The single screen that matters. It should make cross-posting feel like one post, without hiding
where the channels differ.

- **One body, then per-channel variants.** Write once; override per channel where the format
  differs (Instagram caption with hashtags, LinkedIn without them, TikTok a one-line hook).
  Variants are stored, not recomputed, so what was scheduled is what was published.
- **Live previews, one per selected channel**, rendered to that platform's proportions and
  character budget. Previews are the main defence against posting something that reads badly
  anywhere.
- **Per-channel validation before scheduling**, not at publish time:
  - character over the platform limit;
  - Instagram: no media, wrong aspect ratio, more than 10 carousel items;
  - TikTok: video required, duration outside the allowed range;
  - LinkedIn: more than the allowed mentions;
  - missing alt text on any image (see brand rules below).
- **Media**: pick from the library or upload; crop per channel once and store the crops, so the
  1:1, 4:5 and 9:16 versions do not have to be re-made each time.
- **Link handling**: in the body or as the first comment, per channel. Instagram gets the
  first-comment treatment by default because links are not clickable in captions.
- **Schedule**: date and time in **America/Phoenix** (Arizona does not observe daylight saving,
  which is one fewer class of bug), stored in UTC. "Next free slot" and "tomorrow 09:00" as
  one-click options.
- **Save as draft**, **schedule**, or **add to queue**.

### 2.2 Calendar and queue

- Month and week views, drag a post to another day to reschedule, click to edit.
- Colour by channel; a multi-channel post is one entry showing its channels, not four entries.
- **Evergreen queue**: per channel, a set of weekly slots (e.g. LinkedIn Tue/Thu 08:00). Posts
  added to the queue take the next free slot. This is what makes a small operation sustainable —
  you write when you have something to say and let the queue place it.
- Failed posts stay on the calendar in red until resolved; they are never silently dropped.

### 2.3 Post list and audit

Every post is a row with its own state, because "published to three of four channels" is the
normal case, not an exception.

- Filters: status, channel, campaign, author, date range.
- Per-channel result: provider post id, permalink, error code, attempt count, last attempt time.
- **Append-only log** in the existing `audit_log` table: created, edited, approved, scheduled,
  published, failed, cancelled, deleted. Same convention as the rest of the CRM, so the social
  history sits beside the deal history rather than in a parallel universe.

### 2.4 Channels

- Connect and disconnect per platform, with the account name and avatar shown so it is obvious
  *which* Page or profile is connected.
- **Token health**: expiry date, last successful call, and a loud `Needs reconnecting` state.
  Long-lived Page tokens last about 60 days; a silent expiry that only shows up as a failed post
  is the most common way these consoles rot.
- Per-channel defaults: timezone, privacy level (TikTok must be chosen explicitly, and the
  console must pass one of the options the account actually offers), first-comment behaviour,
  hashtag set, UTM parameters.

### 2.5 Media library

- Upload once, reuse; store mime, dimensions, duration, size and a checksum.
- **Alt text is a field, not an afterthought**, defaulting to required for images.
- **Rights metadata**: source, licence, and whether it may be used in paid promotion. For a
  company whose entire argument is data rights, publishing an image it cannot licence would be
  an own goal, and the field is cheap.
- Generated variants cached per aspect ratio, so the daily job does not re-encode.

### 2.6 Analytics

Two layers, and only the second needs a decision:

- **What the console knows for free**: post published, on time, to which channels, with what
  copy, and the permalink. That alone answers "did it go out".
- **Engagement**: impressions, reach, likes, comments, shares, clicks, follows. Either the
  aggregator's analytics endpoint or each platform's own insights API — both need extra scopes
  and, for Instagram and LinkedIn, extra approvals. Store snapshots with a capture date so the
  numbers can be compared over time rather than overwritten.

Start with the free layer and add snapshots in phase 2. Do not design the schema around metrics
before knowing which ones the chosen provider will actually return.

### 2.7 Settings

Workspace-level, all editable in the console:

- **Brand rules** (see 2.8) and the default hashtag/UTM sets.
- **Approval required** toggle: when on, nothing publishes without a second person approving.
  Ships **off** — there is one writer. The `needs_review` state stays in the schema so a second
  writer can be added by flipping the setting, with no migration.
- **Quiet hours** and blackout dates (a post should not go out on a day the site is being
  deployed, for instance).
- **Per-channel posting caps** per day, so a queue cannot flood a channel.
- **Failure alerts**: email on the first failure and on any token that needs reconnecting, via
  the Resend setup the CRM already has.

### 2.8 Brand rules: the feature that makes this DataLeasers' console

The site's own constraints are hard rules, and the console should enforce them rather than trust
whoever is writing at 6pm:

- **No unsourced numbers.** Any post containing a currency figure, percentage or "N×" claim must
  carry a source link in the same post, or it cannot be scheduled. This is the machine version of
  the rule the site already follows.
- **Wording**: "DataLeasers" capitalised; "the data buyer", never a named buyer; the retired
  "Mode" stage vocabulary must not leak into copy.
- **Banned phrasing**: the claims the site deliberately avoids ("free money", guaranteed
  earnings, "your data is worth X" as a promise rather than a question).
- Each rule is a linter producing a **warning** with a line number, and the schedule button is
  disabled only for the unsourced-number rule. Warnings that block everything get switched off;
  one that blocks the thing you actually must not do survives.

### 2.9 Roles

Reuse `crm_staff`: **admin** connects channels and edits settings; **introducer** writes and
schedules; **reviewer** approves drafts; **viewer** reads. RLS: channel tokens readable only by
admin, everything else readable by all staff, writes by admin and introducer, approval by
reviewer or admin. The console must never expose a token to the browser, so every provider call
is server-side.

---

## 3. Data model

Six tables, one migration. Sketch, not final SQL:

```sql
-- A connected account on one network.
create table public.social_channels (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('facebook','instagram','linkedin','tiktok')),
  external_id text not null,           -- Page id, IG user id, org URN, open id
  display_name text not null,
  username text,
  avatar_url text,
  provider text not null default 'aggregator',
  credentials jsonb,                    -- encrypted at rest by the app, never selected by pages
  token_expires_at timestamptz,
  status text not null default 'active'
    check (status in ('active','needs_reauth','revoked')),
  last_ok_at timestamptz,
  last_error text,
  defaults jsonb not null default '{}', -- privacy, first comment, hashtags, utm
  created_at timestamptz not null default now(),
  unique (platform, external_id)
);

-- The thing you wrote, before it becomes N posts.
create table public.social_contents (
  id uuid primary key default gen_random_uuid(),
  title text,                           -- internal label
  body text not null,
  variants jsonb not null default '{}', -- { instagram: { body, first_comment }, ... }
  link text,
  media jsonb not null default '[]',    -- ordered media ids with per-channel crops
  campaign text,
  status text not null default 'draft'
    check (status in ('draft','needs_review','approved','scheduled','published','cancelled')),
  created_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per channel a content item goes to. This is where state lives.
create table public.social_posts (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.social_contents(id) on delete cascade,
  channel_id uuid not null references public.social_channels(id) on delete restrict,
  body text not null,                   -- the resolved variant, frozen at schedule time
  first_comment text,
  scheduled_for timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled','publishing','published','failed','cancelled','needs_manual')),
  provider_post_id text,
  permalink text,
  attempts integer not null default 0,
  last_error_code text,
  last_error text,
  next_retry_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (content_id, channel_id)
);

create index social_posts_due_idx on public.social_posts (scheduled_for)
  where status in ('scheduled','failed');
create index social_posts_channel_idx on public.social_posts (channel_id, scheduled_for desc);

create table public.social_media (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null,
  mime text not null,
  width integer, height integer, duration_seconds integer, size_bytes bigint,
  checksum text,
  alt_text text,
  rights_source text,
  rights_paid_ok boolean not null default false,
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.social_slots (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.social_channels(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  time_of_day time not null,
  enabled boolean not null default true
);

create table public.social_metrics (
  id bigint generated always as identity primary key,
  post_id uuid not null references public.social_posts(id) on delete cascade,
  captured_on date not null,
  impressions integer, reach integer, likes integer, comments integer,
  shares integer, clicks integer, follows integer,
  raw jsonb,
  unique (post_id, captured_on)
);
```

Notes on the model:

- **`social_posts` freezes `body`.** Editing a content item after scheduling must not silently
  change what goes out on a channel that was already validated against the old text.
- **`unique (content_id, channel_id)`** is the anti-double-post guard at the data layer.
- **`status = 'needs_manual'`** exists for the TikTok-before-audit case and for any platform that
  hands back a draft instead of publishing.
- **Tokens live in `credentials`** and are encrypted by the app with a key in `.env`. They are
  never selected by a page query, only by the publishing route. If that is too much machinery
  for a first version, store the aggregator's profile key instead of raw OAuth tokens — it is
  far less sensitive, and it is one more reason to start on the aggregator.

---

## 4. Publishing engine

- **Cron every minute** on the VPS, hitting `POST /api/social/publish` with `CRON_SECRET` (the
  same pattern as `/api/reminders`).
- **Claim work safely**: `select ... where status = 'scheduled' and scheduled_for <= now() for
  update skip locked limit 10`, then set `status = 'publishing'`. Two overlapping runs must not
  both take the same row.
- **Publish, then record**: on success store `provider_post_id`, `permalink` and
  `published_at`; on failure store the code and message, and set `next_retry_at` with
  exponential backoff (1m, 5m, 30m, then hourly, giving up after a day into `failed`).
- **Classify errors.** Expired token → `needs_reauth` on the channel and email the admin; do not
  retry. Rate limit → retry later. Content rejected → `failed`, no retry, show the platform's
  reason verbatim.
- **Idempotency**: pass an idempotency key per post where the provider offers one, so a retry
  after a timeout does not double-post.
- **Time**: all comparisons in UTC, all display in Phoenix. A post scheduled at 09:00 must go at
  09:00 in Arizona whatever the server clock thinks.

---

## 5. Account setup for DataLeasers

Ordered so that nothing waits on something later. Items marked **(you)** need your identity,
documents or login; the rest I can walk you through or do from here.

### 5.1 Foundations (do first)

1. **(you)** A work email on `dataleasers.com` for each console login. Do not use a personal
   address as the owner of the business assets.
2. **(you)** A password manager entry per account, and two-factor on all four. Add a second
   admin on Facebook Business Manager and LinkedIn so a lost phone does not lock the brand out.
3. **(you)** Business documents for verification: legal entity name, registration number and a
   document showing the business address. Meta and LinkedIn both verify the business, and TikTok
   asks for it during the audit.

### 5.2 Facebook and Instagram (one Meta app covers both)

1. **(you)** Create the Facebook Page for DataLeasers from a personal profile that will act as
   admin, then add a second admin. The Page is what the API posts to; the personal profile is
   never used for content.
2. **(you)** Complete Page Publishing Authorization if Meta asks for it — publishing to
   Instagram fails silently-ish until it is done.
3. **(you)** Convert the Instagram account to **Professional** (Business or Creator) and link it
   to the Facebook Page. Without this, there is no publishing endpoint at all.
4. **(you)** Create the Meta developer app, type Business, and add the products: Facebook Login
   for Business, Instagram. Request `pages_manage_posts`, `pages_read_engagement`,
   `instagram_content_publish`, `instagram_basic`.
5. Standard Access is sufficient for accounts you own, so **no App Review is needed** — but
   Business Verification is, and it takes days. Start it immediately.
6. **(you)** Run the OAuth flow once from `/social/channels` (to be built) and confirm the Page
   and Instagram account both appear.

### 5.3 LinkedIn

1. **(you)** Create or claim the DataLeasers company Page, then **verify** it (domain email or a
   DNS TXT record on `dataleasers.com`). Verification is a prerequisite for the developer
   application.
2. **(you)** Create the developer app at developer.linkedin.com, associate it with the Page, and
   request the **Community Management API**.
3. The application wants a demo of the integration and a description of who uses it. Plan to
   apply *after* the console can show a working compose screen — this is why LinkedIn comes
   last rather than first.
4. Interim option: post to your personal profile with `w_member_social` via the lighter "Share
   on LinkedIn" product, which needs no partner programme. Useful for keeping the channel alive
   while the Page application is in review, at the cost of posting as a person.

### 5.4 TikTok

1. **(you)** Create the TikTok business account for DataLeasers.
2. **(you)** Register the app at developers.tiktok.com, add the **Content Posting API**, and
   request `video.publish`.
3. **(you)** Submit the **audit**: demo video, description of the integration, and the compliance
   points TikTok reviews (creator info shown before posting, explicit consent, privacy options
   honoured, content preview). The console must actually do these things, so this is another
   build-then-apply.
4. Verify the domain for `PULL_FROM_URL` uploads if we push video by URL rather than by file.
5. Until the audit passes, expect `SELF_ONLY`. The console will label those posts
   **private draft — needs publishing in the app** rather than pretending they went live.

### 5.5 Domain and infrastructure

- A storage bucket for media (Supabase Storage or the R2 bucket already in use), **private**,
  with signed URLs for the composer and a short-lived public URL only where a platform requires
  fetching media by URL (Instagram and TikTok both do).
- `.env` additions on the VPS: `SOCIAL_PROVIDER`, the provider's key, `SOCIAL_TOKEN_KEY` if we
  store raw tokens, and reuse `CRON_SECRET` for the publish cron.
- One cron entry, matching the reminder job's pattern.

---

## 6. Build order

**Phase 1 — a working console (the useful milestone)**
Schema (`0009_social.sql`), channel connection screen, composer with per-channel previews and
validation, calendar, post list, publish cron, audit entries, failure email. One aggregator
behind the adapter, all four channels.

**Phase 2 — makes it pleasant and safe**
Approval flow, evergreen queue, media library with alt text and rights, UTM builder, brand-rule
linter, token-health alerts.

**Phase 3 — only once phase 1 has run for a month**
Analytics snapshots, comments/inbox, direct Meta publishing (dropping the aggregator for FB/IG),
campaign reporting, A/B of the same post with two hooks.

Deliberately **not** in scope: multi-tenant, ads management, DM automation, competitor listening,
AI copywriting. Each is a product of its own, and the last one is exactly the kind of thing that
would put an unsourced claim into a post.

---

## 7. Decisions taken (11 November 2026)

1. **Aggregator first.** One provider behind the adapter for all four channels. Direct Meta
   publishing is deferred to phase 3, once the volume justifies wiring it.
2. **Personal LinkedIn is in scope**, to be reviewed when the accounts are reviewed. It keeps
   the channel alive while the Page application is pending, under `w_member_social`.
3. **Approval flow ships off.** There is one writer, so admin and introducer publish directly.
   The state and the toggle remain in the schema, so a second writer needs a settings change
   rather than a migration.
4. **Display timezone is America/Phoenix.** Storage is UTC; every screen reads and writes in
   Phoenix, which has no daylight saving to get wrong.
