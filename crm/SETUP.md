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
  credential to match, so every password fails with `invalid_credentials`. On the VPS, in the
  directory holding `.env`:

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
Run every file in `supabase/migrations/` in order, in the SQL Editor, when a new one is added: `0001_init.sql` through `0012_prospect_import.sql`. Each file is written to be safe on a database that already has it.

## Deals, buyers and referrals (0007)
- **Buyers** are added on the Buyers page. A company cannot move to "Introduced to buyer" until an introduction to one is recorded.
- **Offers and agreements** are recorded on the company page. An agreement stores the licence end, the exclusivity end, and a deletion date 120 days after delivery.
- **Partners** are external referrers with a fee rate and floor. Registering a referral sets a six-month deadline, and the fee estimate is the greater of the percentage and the floor.
- **Documents** hold metadata and a link. To store the files themselves, create a private Storage bucket and add a signed-URL upload; the table is ready for it.

## Marketing console (0009)
- Open **Marketing** in the sidebar. Drafts and scheduling work with no provider configured; sending does not.
- An admin connects a channel once. The form stores only the provider's profile id, never an OAuth token.
- An agent writes channel variants, and every run counts against the daily cap on the Agents page. A person always schedules the post.
- A post that makes a numeric claim without a source link cannot be scheduled. That is the one rule that blocks.

Environment for sending:
1. Create an account with a publishing provider that covers LinkedIn, Facebook, Instagram and TikTok and holds their approvals. The free tiers that exist at the time of writing are bundle.social (20 posts/month) and upload-post (10 uploads/month).
2. Put its endpoint in `SOCIAL_API_URL` and its key in `SOCIAL_API_KEY`. Any provider that accepts `{ platform, text, media, scheduled_at }` and returns an id works, because the console calls one endpoint.
3. Add a second cron entry, every five minutes, next to the reminder job:

```
*/5 * * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://app.dataleasers.com/api/social/publish
```

Until `SOCIAL_API_URL` is set, the Marketing page says so rather than appearing broken. LinkedIn company-page publishing needs the provider's own approval, and TikTok needs its audit: before that audit a TikTok post can only go out as a private draft.

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
