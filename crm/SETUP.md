G# dataleasers CRM: set-up

Region: **US**. Personal data is stored in the US.
Sign-in: magic link by email, then a required authenticator-app code (TOTP). Self-signup is off.

## 1. Create the Supabase project
1. Create a project, region **US East** (or closest US region).
2. Save the database password in your password manager.

## 2. Configure authentication
1. **Authentication > Providers > Email**: enabled. Keep the magic link option on.
2. **Authentication > Sign In / Up**: turn off "Allow new users to sign up".
3. **Authentication > Multi-Factor**: enable TOTP (authenticator app).
4. **Authentication > URL Configuration**:
   - Site URL: `https://app.dataleasers.com`
   - Redirect URLs: `https://app.dataleasers.com/auth/callback`

Menu labels change between Supabase releases. Match the settings by name if they have moved.

## 3. Create the database tables
1. Open **SQL Editor**, paste the contents of `supabase/migrations/0001_init.sql`, and run it.

## 4. Create your admin account
Sign-up is off, so the account must exist before you can sign in.
1. **Authentication > Users > Add user**, enter your work email. A password is optional: leave it blank and sign in with the emailed link, or give the account one with
   `npm run set-password -- you@example.com 'a password of 12+ characters'` (see Recovery).
2. In **SQL Editor**, run this with your own email and name:

```sql
insert into public.crm_staff (user_id, full_name, role)
select id, 'Your Name', 'admin'
from auth.users
where email = 'you@example.com';
```

## 5. Environment file (on the VPS only)
1. Copy `.env.example` to `.env`.
2. Fill in the project URL, the anon key, and the service role key from **Project Settings > API**.
3. Do not paste keys into chat, email, or Git.

## 6. First sign-in
1. Open `https://app.dataleasers.com/login` and enter your email.
2. Open the sign-in link from your email. You are taken to the two-factor set-up.
3. Scan the QR code with your authenticator app and enter the code.

## Reminder emails (Resend)
1. In Resend, add the domain `dataleasers.com` and add the DNS records it gives you. Wait until it shows verified.
2. Create an API key in Resend and put it in `.env` as `RESEND_API_KEY`.
3. Set `REMINDER_FROM_EMAIL` to an address on that domain, and `CRON_SECRET` to a long random value.
4. On the VPS, schedule a daily run (8:00 server time), for example in cron:

```
0 8 * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://app.dataleasers.com/api/reminders
```

Use the same secret in the cron entry as in `.env`. Each task is emailed once. Tasks with no assignee go to admins.
Reminders cover tasks only. Next-action dates on a company are shown in the CRM but are not emailed yet.

## Recovery
- **Lost phone or authenticator app:** in **Authentication > Users**, open your user and remove the MFA factor. Sign in again to re-enrol. Keep a second device enrolled if you can.
- **"Email or password is incorrect" on first sign-in:** an account added without a password has no
  credential to match, so every password fails with `invalid_credentials`. The reference on the page
  confirms this, and it is not a wrong password, so retrying will never work. Fix it in a browser:

  1. On the sign-in page, use **Send sign-in link** with the same address and open the link from the
     email. That works because the account exists and is confirmed; only the password is missing.
  2. Open **Account** in the sidebar and set a password (12 characters or more). The page changes
     only the signed-in account and stores a hash, never the password.
  3. Sign in with the new password to confirm. Both routes keep working afterwards.

  If the email link does not arrive, the problem is email delivery rather than the account: on the
  free plan Supabase's own mailer is limited to a couple of messages an hour and is often filtered.
  Add a custom SMTP provider under **Authentication > Emails**, or use the script below on the server.

  On the VPS, in the directory holding `.env`, the script does the same job without a browser:

  ```
  npm run set-password -- you@example.com 'a password of 12+ characters'
  ```

  It reads `.env` itself, sets the password, confirms the address, then verifies by making the same
  call the sign-in form makes, so a verified result means the next attempt works. Add `--recreate`
  if the password cannot be set and the account may be deleted and rebuilt. If it reports that the
  address does not exist, the app is pointed at a different Supabase project from the one holding
  the user: check the `Project:` line it prints first.
- **Signed in but sent to `/no-access`:** the account exists but has no `crm_staff` row, which is the
  SQL in step 4. Signing in again will not fix it.
- **Locked out of the staff list:** run the SQL in step 4 again with the correct email, using the SQL Editor (this bypasses the app).

## Schema updates
Run every file in `supabase/migrations/` in order, in the SQL Editor, when a new one is added: `0001_init.sql` through `0022_phoenix_date_defaults.sql`. Each file is written to be safe to run again: a policy, or a constraint that could collide, is dropped first, so re-pasting an old file changes nothing instead of stopping with "already exists". You only need to run the files your database has not had yet.

`0019` adds `social_posts.claimed_at` and `sweep_stale_social_posts()`, which stops a post whose publishing run died mid-send. The publisher calls it before taking new work, moves any such post to `needs_manual` and emails the admins one message listing them, because a post may already be live on its channel and nobody can tell from here. The sweep is capped at 25 rows a tick, so a large backlog arrives in bounded batches rather than as a burst of mail. Check the account, then Retry or cancel it.

`0020` replaces `sweep_stale_social_posts()` so a sweep that completes deletes the `marketing_sweep` record that the publisher leaves in `app_settings` when a sweep fails, which the Marketing page shows as a warning. Clearing it inside the sweep means a healthy tick writes nothing and a failing one cannot erase its own warning.

`0021` replaces `claim_outbound_sends()` so an outbound step falls due on the Phoenix day rather than the database's UTC day. The two differ from 5pm Phoenix, when UTC is already tomorrow, and a step saved for the next day was claimable that evening — an email going out hours early. Nothing changes about what is stored: the code already writes `next_due_on` as a Phoenix date, and only the day the claim compares it to moves.

`0022` moves the three date-column defaults — `introductions.introduced_on`, `offers.offered_on` and `referrals.registered_on` — from the database's day to the Phoenix day. Leaving the date field blank in the introduction or offer form omits that column, so this default is what dates the row; from 5pm Phoenix it was writing tomorrow. Defaults only: existing rows and the columns' nullability are untouched.

Order does not matter between a migration and the code that uses it. Run the migration first when you can; if a deploy lands before it, the publisher falls back to the previous signature, the sweep keeps running, and the Marketing page says the database is behind until the migration is applied.

`0018` creates the public `social-media` Storage bucket that post images are written to. If your
project refuses bucket creation from SQL, create it by hand: **Storage > New bucket**, name it
exactly `social-media`, and mark it public. A private bucket would store the file and then fail at the
provider, because the provider fetches the image itself.

### Checking the series still applies

`npm run check:migrations` applies every file in `supabase/migrations/` in order to a throwaway
in-memory Postgres (PGlite), after creating the objects Supabase provides that the files assume:
`auth.users`, `auth.uid()`, `storage.buckets` and the three roles — and then applies the whole series a
second time. It prints each file as it applies, stops at the first one that errors, and exits non-zero,
so a reordered, renamed or edited file, or one that is no longer safe to re-run, is caught here rather
than in the SQL Editor. Run `npm install` once first; it needs no project, no network and no
credentials.

After both passes it also fails, printing what it found, if a date default sits on any clock other than
Phoenix or any function body mentions `current_date` — the two things 0021 and 0022 fixed, so a new
table added with `default current_date` cannot quietly put the UTC day back.

`npm run check:migrations` also compares the files with `supabase/migrations.lock.json`, which holds a
sha256 of each file as it was when it went in. The series is applied by hand, once each, so a file
production has already run is finished: editing it changes what a fresh database would get without
changing the live one, and the two drift apart with nothing to show for it. The check fails if a recorded
file's contents move, if a file is not recorded yet, or if a recorded file has been deleted — and
`npm run migrations:record` only adds files, refusing to update a fingerprint that is already there, so
recording cannot be used to bless an edit made after the fact.

Then it exercises `claim_outbound_sends` itself, with the session moved to UTC+14 — a database whose own
day has already rolled over, which is the state a UTC Supabase is in after 5pm Phoenix. The claim has to
take the step due today and leave tomorrow's queued, which is 0021's bug asserted rather than described.
The scan above also refuses a function that turns `now()` into a day without naming the zone, so a
comparison against UTC cannot creep back in the seven hours of the day when it looks correct.

It proves the series builds on an empty database, not that it behaves: policies are created but never
evaluated, `auth.uid()` is a stub, nothing calls storage, and the claim is the only function whose
behaviour is exercised. Apply each new file to the real project in the SQL Editor as before.

### Checking the console's clock

`npm run check:dates` reads `lib/` and `app/` and refuses three things: a day built from UTC — a
`toISOString().slice(0, 10)`, a `split('T')[0]`, a `getUTCDate()`; a month or a year built from UTC
with `getUTCMonth` or `getUTCFullYear`; and a stored date rendered without `calendarDate`. The column
names come from `supabase/migrations/`, so a date column added there is covered without touching the
script. No credentials, no network, no build.

It exits non-zero and prints the file, line and rule for each place, so a route that formats its own
date cannot quietly undo 0021 and 0022. A month or a year taken from UTC fails too, because the
boundary is one level up as well: a month key built from UTC names next month during
the last seven hours of a month, which is enough to put a row in the wrong chart bucket, date an object
in the wrong folder or age a company by a year. `phoenixMonth` and `phoenixMonths` give a bucket on the
console's clock, `phoenixYear` the year an instant falls in, and `calendarYear` the year a stored date
already belongs to. An `<input type="date">` is exempt, because that control's value is `YYYY-MM-DD` by
definition.

`npm run check:clock` then pins what those helpers answer, because a scan cannot see a return value. It
transpiles `lib/time.ts` (with the TypeScript already in `devDependencies`, so there is no build step)
and checks the instants where the clock is easiest to get wrong: 5pm Phoenix, when the UTC day has
already rolled over; the last seven hours of a month and of a year; a stored date that must not move;
the `daysLeft` nulls; and the datetime-local round trip through the schedule form, including 31
February, which has to be refused. It prints one line when they all hold, and otherwise the value it
expected beside the one it got, so a day or an hour that moves fails here rather than in a page nobody
opened. Because the copy it loads lives in a temp directory, it also refuses a `lib/time.ts` that has
picked up an import, saying which line and why — the clock is meant to be the leaf everything else
builds on, so nothing would resolve from there.

### Checking the code against the schema

`npm run check:schema` reads the tables and columns the migrations create and compares them with every
`.from('table').select('a, b')` in `lib/` and `app/`, plus every `.rpc('name')` against the functions the
migrations define. A page that asks for a column no migration creates fails at runtime with a PostgREST
error, which after the schema fallback can look like a degraded database rather than a missing column;
this catches it before a deploy and needs no project. Nested relations like `buyers(name)` are skipped
because they name another table's columns, and aliases, wildcards and JSON paths are skipped because they
are not plain column names; writes (`insert`/`update` objects) are not judged at all, so this covers the
commonest drift rather than being a schema type system.

### Checking the policies

`npm run check:policies` applies the series to PGlite, gives `anon`, `authenticated` and `service_role`
the table privileges Supabase grants them by default — RLS is the perimeter, not `GRANT` — and then reads
and writes as each of them. Anonymous and a signed-in non-staff user must see nothing in any table; a
viewer reads companies but cannot create one; an introducer can; only an admin or reviewer reads the
activity log, while any staff member may write their own audit row; and the service role, which the
intake form and the publisher use, must not be stopped by a policy written for a person. Every table must
also have row-level security enabled, so a new table cannot arrive unguarded.

`auth.uid()` in this harness reads `request.jwt.claim.sub`, the setting Supabase fills from the JWT — the
only part of Supabase's own definition the policies use. Storage policies and the REST layer's treatment
of the key are outside it.

### Checking the seed

`npm run check:seed` applies the migrations to PGlite and then calls the same `seed()` the command line
calls, with a client that turns its Supabase calls into SQL: insert, upsert with a conflict target, delete
and select with a filter, and the three `auth.admin` calls. It runs the seed twice, so the
delete-then-insert path is exercised rather than described — the second run has to replace the first
run's rows rather than collide with them. A company with no seed marker is put in the way before that
second run and has to survive both it and the clear step, so the deletes are shown to stay inside the
seed's own ids and markers. Every column, type, not-null rule, check constraint and conflict target the
payloads touch is therefore proved before a project sees them.

It also runs the seed a third time with a client that refuses one write, and asserts what comes back: a
`StepFailure` naming the step it happened in, with the database's message — the contract that lets the
check report a failure and shut down instead of dying mid-run.

It is not PostgREST: grants and policies are never evaluated, so something PostgREST alone would refuse
can still pass here, and the password is discarded because the harness's `auth.users` has no password
column. What it does catch is what would fail first on staging — a column that has been renamed, a value a
constraint refuses, an `onConflict` that names nothing unique.

### Staging walk-through

`npm run seed` fills a staging project with the states this branch changed, so the console can be walked
through without customer data: a walk-through admin (password from `SEED_STAFF_PASSWORD`, never printed),
two companies with a buyer, an offer, an agreement and a partner with two referrals, two channels, a
queued post, one stopped for a person, one on a channel that needs reconnecting, a sweep warning, and a
send with a suppression. It needs `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and
`SEED_STAFF_PASSWORD`, reads `.env.local` (or `SEED_ENV_FILE`), prints only the host it would write to,
and refuses to write anything without `SEED_CONFIRM=yes`. Rows have fixed ids and seed markers, so a
second run replaces its own rather than piling up. It sends nothing: every post and send is a row. The
script ends by printing the walk-through order — the screens, and what to look at on each.
`npm run check:seed` runs that same write path against a local database, so a payload that no longer fits
the schema fails on a laptop instead of on the first staging run.

### Before a deploy

`npm run check` runs all seven — the migration record, the series itself, the seed's payloads against a
local database, the date scan, the schema check, the clock's values, then the money table — and stops at
whichever fails. None of them needs credentials or a network, so it is the same command on a
laptop and in CI. The deploy workflow runs `npm ci`, `npx tsc --noEmit` and `npm run check` on every push
to `main` that touches `crm/`, before it copies anything to the server, so these fail a deploy rather
than a laptop. Which part matters depends on what you are shipping:

- **Pasting SQL into the Supabase SQL Editor:** `check:migrations` is the one that has to be green; it
  is the only thing that proves the files still apply in order and still apply twice.
- **Shipping code under `lib/` or `app/`:** `check:dates` is the one that has to be green; a route that
  builds a day from UTC or prints a stored date raw would pass a type check and a build.
- **Editing `lib/time.ts`:** `check:clock` is the one that has to be green; it is the only place the
  console's expected days, months and instants are written down. A deliberate change to one of them
  means changing the expectation here as well as the helper.
- **Adding or renaming a column, or changing a query:** `check:schema` is the one that has to be green;
  it is the only thing that compares the pages with the migrations.
- **Touching a fee or a money format:** `check:money` is the one that has to be green; `referralFee`
  works in whole cents and rounds once, and that check is where the cases live.
- **Editing a policy, or adding a table:** `check:policies` is the one that has to be green; it is the
  only thing that ever runs a query against the policies, and the only thing that notices a table
  created without row-level security.

`npm run preflight` is a different check, and the only one that needs the project and the environment:
run it on the server after a deploy.

## Deals, buyers and referrals (0007)
- **Buyers** are added on the Buyers page. A company cannot move to "Introduced to buyer" until an introduction to one is recorded.
- **Offers and agreements** are recorded on the company page. An agreement stores the licence end, the exclusivity end, and a deletion date 120 days after delivery.
- **Partners** are external referrers with a fee rate and floor. Registering a referral sets a six-month deadline, and the fee estimate is the greater of the percentage and the floor. The fee is computed in whole cents and rounded once, so 3% of $250,000 is $7,500.00 exactly; `npm run check:money` pins those cases.
- **Documents** hold metadata and a link. To store the files themselves, create a private Storage bucket and add a signed-URL upload; the table is ready for it.

## Marketing console (0009)
- Open **Marketing** in the sidebar. Drafts and scheduling work with no provider configured; sending does not.
- An admin connects a channel once. The form stores only the provider's profile id, never an OAuth token.
- An agent writes channel variants, and every run counts against the daily cap on the Agents page. A person always schedules the post.
- A post that makes a numeric claim without a source link cannot be scheduled. That is the one rule that blocks.

A post moves through these states, and the last two are the ones a person leaves:

```
scheduled ──cron──▶ publishing ──▶ published
    │                    ├─ transient error ──▶ scheduled (retry, with backoff)
    │                    └─ attempts used up ──▶ failed
    ├─ sweep finds the run died ──▶ needs_manual (announced by email, never re-sent)
    ├─ retry (channel healthy) ──▶ scheduled, attempts 0
    └─ cancel ──▶ cancelled, content back on the schedule list
```

`failed` and `needs_manual` are where a post waits for a person: Retry puts it back in the queue when the
channel allows it, Cancel withdraws it and returns the content. Retry, cancel and marking a channel
active each write an `audit_log` row, so `/audit` answers who acted and when.

**Scheduler health** (`/health`, under Automation) is where those states are visible without reading
the server: the last sweep warning or the absence of one, posts waiting for a person, a post held in
`publishing` past the sweep threshold, and any outbound enrolment left at `sending` because a run never
recorded its outcome. Each figure has the sentence explaining what a non-zero one means.

### Posting to Facebook without a provider

A Page you own does not need an aggregator. Meta's own API is free, has no per-post cap, and a
long-lived Page token never expires. App review is only required when an app posts to pages it does
not manage; as the app's own admin posting to your own Page, Standard Access is enough.

1. Create the Page at https://www.facebook.com/pages/create with the Data Leasers name, the brand
   logo as the profile picture, and the same About text as the site.
2. Create an app at https://developers.facebook.com/apps (type **Business**). You are its admin.
3. Open the Graph API Explorer, choose that app, and add the permissions `pages_show_list`,
   `pages_read_engagement` and `pages_manage_posts`. Generate a **User** token and accept the prompt.
4. Find the Page id and a Page token: `GET /me/accounts` in the Explorer. Copy `id` and
   `access_token` from the entry for the new Page.
5. Make the token permanent. A Page token taken from a short-lived User token expires with it, but a
   Page token taken from a **long-lived** User token does not expire. Exchange first:

```
GET https://graph.facebook.com/v26.0/oauth/access_token
  ?grant_type=fb_exchange_token&client_id=APP_ID&client_secret=APP_SECRET
  &fb_exchange_token=SHORT_LIVED_USER_TOKEN
```

   then call `GET /me/accounts` again with the long-lived User token and keep the Page
   `access_token`. The Explorer also shows an expiry next to the token; a Page token with no expiry
   date is the one you want.
6. Add `FACEBOOK_PAGE_ID` and `FACEBOOK_PAGE_TOKEN` as **repository secrets** (Settings → Secrets and
   variables → Actions). The deploy writes them into the server's `.env`; you never need a shell.
   Optionally set the variable `FACEBOOK_API_VERSION` to pin a Graph version.
7. In **Marketing → Channels**, add the Facebook Page (its name, and the Page id as the external id).
   Posts whose channel is `facebook` now go straight to `POST /{page-id}/feed`, or to `/photos` when
   the post has an image.

A post with images uploads the first public image URL as a photo with the text as its caption; text
posts go to the feed, where Meta attaches a link preview for any URL in the message.

### Other networks

Environment for sending:
1. Create an account with a publishing provider that covers LinkedIn, Instagram and TikTok and holds their approvals. Facebook does not need it: see the section above. The free tiers that exist at the time of writing are bundle.social (20 posts/month) and upload-post (10 uploads/month).
2. Put its endpoint in `SOCIAL_API_URL` and its key in `SOCIAL_API_KEY`. Any provider that accepts `{ platform, text, media, scheduled_at }` and returns an id works, because the console calls one endpoint.
3. Add a second cron entry, every five minutes, next to the reminder job:

```
*/5 * * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://app.dataleasers.com/api/social/publish
```

Until `SOCIAL_API_URL` is set, the Marketing page says so rather than appearing broken. LinkedIn company-page publishing needs the provider's own approval, and TikTok needs its audit: before that audit a TikTok post can only go out as a private draft.

## AI drafting (optional)

Nothing here needs a provider: posts can be written by hand, and cadence steps are text. A provider
only makes the agent buttons work.

Groq's free plan is enough for drafting, and needs no payment method. As of November 2026 its free
chat models are `openai/gpt-oss-120b`, `openai/gpt-oss-20b` and `qwen/qwen3.8-27b`, each limited to
30 requests a minute and 1,000 a day, shared by every key in the organisation. Groq's own examples
still show `llama-3.3-70b-versatile`, which was retired for free tiers on 16 August 2026; copying it
produces a model-not-found error.

1. Create an account at `console.groq.com`. The free plan needs no card.
2. **API Keys > Create API Key**, name it `dataleasers-crm`, and copy the value once: it starts
   `gsk` + underscore and is not shown again.
3. In `crm/.env`, set exactly these three:

```
OPENAI_API_KEY=<your key, starting gsk>
OPENAI_BASE_URL=https://api.groq.com/openai/v1
OPENAI_MODEL=openai/gpt-oss-120b
```

4. Check it from the app, not a terminal: open **Marketing** and press **Test the AI connection**.
   It reports whether the key is accepted, whether that model id is visible to it (listing the ids
   that are, if not), then makes one real call of a few tokens. That button works while agents are
   switched off and does not count against the daily cap.

   With shell access on the server, `npm run check-ai` does the same check and exits non-zero on
   failure, which is the form to use in a deploy script. Neither one is required in order to draft by
   hand.
5. Put the same three values in the server `.env` and redeploy with **Deploy CRM**.
6. On **Agents**, set a daily cap *before* switching agents on, and leave the drafting switch on in
   Marketing. One draft is one run, counted per day.

A wrong key fails with the provider's own message in the agent panel; the panel also says when no key
is configured and when agents are switched off, so a disabled button is never unexplained.

## Email templates (0016)
- **Templates** holds the copy the cadence draws from, grouped by the job each message does:
  opener, follow-up, value add, break-up, after a reply, and partner ask. Migration 0016 seeds one
  of each, written without figures.
- Merge fields are `{{first_name}}`, `{{full_name}}`, `{{role_title}}`, `{{email}}` and
  `{{company}}`. They are filled at send time rather than stored expanded, so correcting a template
  fixes every future message. An unknown token such as `{{firstname}}` is refused when saving, not
  sent literally.
- On **Outbound**, *Add step from template* copies the text into the sequence at the delay you set.
  Steps keep their own copy, so editing or deleting a template never rewrites a message that has
  already been approved or sent.
- A cadence that matches the current evidence: opener at day 0, follow-up at +3, value add at +8,
  break-up at +16. Two follow-ups roughly double the replies a single email earns, most replies
  arrive within a day of the message, and the break-up is usually the highest-replying email in the
  sequence. Stop on reply, unsubscribe or bounce; the sender already does all three.

## Steps and their kinds (0017)
- A sequence step is either an **email** or a **LinkedIn task**. A task step creates a task on the
  linked company's page, assigned to whoever approved the enrolment, and sends nothing. It is
  recorded in the send history with status `task`, so the two are never confused.
- A task step needs the outreach contact linked to a company, because a task belongs to a company.
  Without that link the sender pauses the enrolment with the reason instead of advancing, which
  would claim a touch that never happened.
- Steps can be edited in place, and deleting one renumbers the rest. That matters: the sender looks
  for `position + 1`, so a gap would end a sequence early rather than skip a step.

## Outbound email (0011)
- Open **Outbound**. A contact cannot be added without a country and a lawful basis, and the guard refuses a basis that is not lawful for that country: the US allows an opt-out basis, Canada and Australia need consent, and the UK allows corporate subscribers.
- Nothing sends until a person clicks **Approve first send** on the enrolment. A reply, an unsubscribe or a suppression stops the sequence permanently.
- `/unsubscribe?token=…` is public and needs no sign-in. It suppresses the address globally and stops every live enrolment.
- Every message carries `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, pointing at `/api/unsubscribe?token=…`. A mail client's own unsubscribe button therefore works without the recipient opening a page, and the same URL hands a person who clicks it to the confirmation page. Both paths run the same code, so an opt-out cannot take a different route depending on which button was used.
- `/api/inbound/email` also stops a sequence when the sender matches a contact, so forwarding a reply is enough to halt outreach.

Environment for sending:
1. Add a sending subdomain, for example `mail.dataleasers.com`, verify it in Resend, and publish SPF, DKIM and DMARC for it. Do not send cold mail from the domain that sends client email.
2. Set `OUTBOUND_FROM_EMAIL` to an address on that subdomain, and `POSTAL_ADDRESS` to the sender's real physical address. The route returns 503 rather than mailing without them.
3. Add a cron entry, every ten minutes:

```
*/10 * * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://app.dataleasers.com/api/outbound/send
```

4. Add the hourly sweep. It reads the last 30 days of sends and complaints per recipient domain and holds any domain at or above 0.1% complaints with at least 50 sends in the window. The sender checks the holds before every message:

```
17 * * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://app.dataleasers.com/api/outbound/guard
```

5. Add the weekly partner deadline report, Monday morning. It emails admins and introducers the open referrals bucketed by how long is left on the six-month window, with the overdue ones first, and a link to the ledger:

```
0 7 * * 1 curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://app.dataleasers.com/api/partners/report
```

The same report is on the Partners page, so a person and the inbox cannot disagree. With no open referrals the run sends nothing and says so in its response.

6. Add the daily referral chase. Run after `0014_referral_chase.sql`, it creates one task when an open referral enters its final 30 days, assigned to the company owner when there is one and left unassigned (which means every admin) when there is not:

```
8 * * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://app.dataleasers.com/api/partners/chase
```

Two chases per referral, not one per day. `referrals.chase_task_id` records the routine task at 30 days and `escalation_task_id` records the second one inside seven days; each column is its own idempotency key, so neither is created twice. Delete a task and that chase becomes eligible again; complete one and the other is untouched. Inside seven days the sweep raises only the escalation, because two tasks for one referral in the same hour is how a task list stops being read. A referral that is not linked to a company record cannot carry a task, because `tasks.company_id` is required; the sweep lists those in `skipped` so they can be linked by hand.

A hold stops new mail to that domain; the contacts stay in the sequence and the step is not consumed. Release a domain from the Deliverability page, with a note. The sweep will not re-hold a released domain for a week, so a release cannot be undone within the hour; after that, if the rolling rate is still over the line, it holds again. The sweep also reports domains that are over the threshold on too little volume rather than acting on them, because one complaint in a dozen sends is noise rather than evidence.

Ramp slowly: a handful of sends a day for the first week, then watch bounces and complaints before adding volume. Keep the complaint rate under 0.1%.

The **Deliverability** page reports this per month and per recipient domain: sent, bounced, complaints, unsubscribes and suppressions added, with a verdict per domain (complaint watch at 0.05%, stop at 0.1%; bounce watch at 2%, stop at 5%).

### Bounce and complaint webhook
1. In Resend, open **Webhooks**, add an endpoint at `https://app.dataleasers.com/api/webhooks/resend`, and subscribe it to `email.bounced` and `email.complained`.
2. Copy the signing secret (it starts with `whsec_`) into `.env` as `RESEND_WEBHOOK_SECRET`. Without it the route answers 503 rather than trusting an unsigned event.
3. A permanent bounce and a spam complaint both become a global suppression, mark the contact `bounced` or `paused`, and stop every live enrolment. A temporary bounce is ignored: it means the far end was busy, and suppressing on it would delete good addresses.
4. The signature is checked before the body is parsed, with a five-minute replay window. Retries from Resend repeat the same `svix-id`, and recording a suppression twice is harmless because the address is the primary key.

## Prospect import (0012)
- **Import** now has a Companies House search and a queue. A search writes candidates, not companies; a person accepts a candidate before it enters the pipeline at New lead.
- A candidate whose company number or normalised name already exists in the CRM is stored as a duplicate and cannot be accepted, so the same firm is never worked twice.
- Re-running a search never overwrites a decision: the queue is unique on the source and the register's company number.
- The score is a ranking, not a gate on legality: sector 40, age 25, legal form 10, active 10, address 5, minus 15 for a name that reads as a holding company. 70+ is strong, 45-69 worth a look, below 45 weak. The reasons are stored with the row and copied into the company as a note on acceptance.
- The register publishes no headcount, so size is confirmed on the call. The sector floors shown in the form are the published eligibility rules, not something the score can verify.

Environment:
1. Register a free application at the Companies House developer hub and take the API key. No OAuth is needed for search.
2. Set `COMPANIES_HOUSE_API_KEY` in `.env`. It is sent as the basic-auth username with an empty password, as Companies House documents.
3. The limit is 600 requests in five minutes, and one search is one request. The importer asks for a single page of up to 100 results and reports the true total, so a large search is read in slices rather than page by page.
4. The register is published under the Open Government Licence, so the results may be stored. Keep the company number and register link on the row, which the importer does.

## Two-factor, booking and inbound email- `MFA_REQUIRED=true` makes the middleware require an authenticator code. Enrol at `/mfa` first, then set the flag, or the account locks itself out.
- `BOOKING_URL` adds a booking link to a company header.
- `INBOUND_EMAIL_SECRET` enables `POST /api/inbound/email`, which logs a forwarded email as an activity: send the header `x-inbound-secret` with `{"company_id": "...", "from": "...", "subject": "...", "text": "..."}`.
