# What comparable CRMs ship, what this one has, and what is worth building

Written 11 November 2026. The comparison is against the published feature lists of HubSpot Sales
Hub, Pipedrive, Close, Copper, Reply.io, Zoho CRM and Salesforce Sales Cloud — the systems a
business like this would otherwise be paying for.

The test used throughout is not "do they have it" but **"would it move 20 companies to a signed LOI
by the end of Q1 2027"**. A feature that no amount of software can deliver here is listed as not
applicable, with the reason, so it stops being a nagging gap.

## What this CRM already does

Verified against the code, not the intention:

| Area | Where |
| --- | --- |
| Pipeline with stage rules, companies, contacts, buyers, partners | `/pipeline`, `/companies`, `/buyers`, `/partners` |
| Tasks with due dates and a daily reminder email | `/tasks`, `/api/reminders` |
| Cold email: lawful basis per contact, per-country guard, global suppression, approval gate, 3-strike pause, domain holds | `/outbound`, `/api/outbound/send`, `/api/outbound/guard` |
| Follow-up cadence: steps with delays, automatic advance, stop on reply | `sequence_steps`, `sequence_enrolments` |
| Email templates with merge fields | `/templates`, `0016_email_templates.sql` |
| One-click unsubscribe (RFC 8058) and inbound reply capture | `/api/unsubscribe`, `/api/inbound/email` |
| Deliverability reporting and bounce/complaint webhook | `/deliverability`, `/api/webhooks/resend` |
| Prospect sourcing from Companies House with scoring and dedupe | `/import` |
| Marketing console: drafts, queue, channel mix, publishing switches | `/marketing` |
| Partner referrals, weekly report, chase and escalation tasks | `/partners`, cron routes |
| Roles, staff admin, audit log, privacy requests | `/admin/staff`, `/audit`, `/privacy-requests` |
| Agent drafting with a daily cap and a no-unsourced-number rule | `/agents` |

## The comparison

Status key: **have** · **partial** · **missing** · **no** (not applicable, with reason).

| Feature | Who ships it | Status here | Verdict |
| --- | --- | --- | --- |
| Email templates with merge fields | HubSpot (3 on free, 10k paid), Pipedrive, Copper | **have** (0016) | Was the biggest operational hole. Done. |
| Sequences/cadences with step delays | HubSpot Sequences, Close Workflows, Reply.io | **have** — sends advance `current_position` and set the next due date | Mechanics work. Authoring is the next gap. |
| Step types beyond email: call task, LinkedIn, SMS | HubSpot, Reply.io, Close | **missing** — every step is an email | Worth doing for LinkedIn tasks only: no API, just a task row. Calls are excluded on purpose (below). |
| Editing and reordering steps after creation | all | **missing** — steps are append-only | P0: a typo currently means a new step and a dead one. |
| A/B variant testing of subject and body | Reply.io, Close, Instantly | **missing** | P1: needs send volume this business will not have before Q2. |
| Workflow triggers ("deal moves to stage → create task") | HubSpot, Pipedrive, Zoho | **partial** — marketing switches and partner chase crons exist; nothing reacts to a stage change | P0: stage changes are how this pipeline actually moves. |
| Meeting scheduler / booking link | HubSpot, Pipedrive, Calendly | **partial** — `BOOKING_URL` renders a link, no availability logic | Fine as is. Owning a calendar service is not the job. |
| Email open and click tracking | HubSpot, Copper, Close | **missing** | P2, and only with consent: tracking pixels in cold mail cut both ways under GDPR/PECR. Reply capture already gives the signal that matters. |
| Shared inbox and two-way email sync | HubSpot, Pipedrive, Copper | **missing** | No. One operator, and replies already stop sequences and log activity. |
| Lead scoring | HubSpot (5 scores paid), Zoho | **partial** — import candidates are scored; inbound leads are not | P1: reuse the same scorer on `/leads`. |
| Multiple pipelines | HubSpot, Pipedrive | **no** — one pipeline, deliberately | No. One motion: company → buyer → LOI. |
| Custom fields and custom objects | Zoho, HubSpot | **no** — fixed schema | No. The schema is the product here (basis, suppression, holds). |
| Forecasting | HubSpot, Salesforce | **missing** | No, for now: forecasting 20 deals is arithmetic, not software. |
| Reporting dashboards | all | **partial** — marketing KPIs, deliverability, partner report | P1: add reply rate and step-level performance to `/outbound`. |
| Conversation intelligence, call recording | HubSpot, Close | **no** — and no cold calling at all | No. FCC 24-17 (Feb 2024) put AI-voiced cold calls behind prior express consent. |
| Telephony, power dialler, PBX | Zoho, Close | **no** | No, same reason. |
| CPQ, quotes, e-signature | HubSpot, Pipedrive | **no** — there is no price to quote; the fee is the buyer's | No. An LOI is a document, not a configured quote. |
| Territories, round-robin lead routing | HubSpot | **no** | No. One person, no queue to route. |
| Sandbox / staging account | HubSpot | **partial** — local build plus a preview deploy path | Nice to have; the deploy guard covers the rollback risk that mattered. |
| Webhooks out and an integration marketplace | all | **partial** — inbound Resend webhook only | P2: an outbound webhook ("stage changed", "replied") would let other tools react without polling. |
| Data enrichment (Apollo, Clay, ZoomInfo) | all | **partial** — Companies House only, UK only | P1 for UK volume; enrichment for US/CA/AU is paid and often stale. |
| Intent signals and website visitor tracking | HubSpot | **missing** | P2. With this volume, a reply is a stronger signal than a page view. |
| Compliance built into the sending path | usually a checkbox or a paid add-on | **have** — basis per contact, country guard, suppression, one-click unsubscribe, 3-strike pause | This is the advantage. Do not trade it for convenience. |
| Mobile app | all | **no** | No. The work happens at a desk, and a PWA is a later question. |

## Order of work

**P0 — before the first real send**
1. Edit and delete a step (append-only is a trap when a subject has a typo).
2. A LinkedIn task step: same table, a `kind` column, a task instead of an email.
3. Stage-change → task, so an LOI conversation cannot go quiet.
4. Reply rate per step on `/outbound`, from `outbound_sends` that already records every send.

**P1 — once there is volume**
5. Score inbound leads with the existing importer scorer.
6. A/B variants, only when each variant can gather enough sends to mean something.
7. Outbound webhook.

**P2 — only if a specific problem appears**
8. Open tracking, with a consent decision first.
9. Intent signals.

**Never (for this business)**: cold-call tooling, CPQ, territories, chat, multi-pipeline, custom
objects.

## Social posting: what "set up" actually requires

The console is built and the publisher is coded (`lib/social.ts`, `/api/social/publish`, a five
minute cron). What is missing is a provider account and a payload mapping.

Checked against what the console sends — JSON `{ platform, text, media, scheduled_at }` with
`Authorization: Bearer` — neither free option accepts that shape:

| Provider | Free tier | Auth | Body | Fit |
| --- | --- | --- | --- | --- |
| bundle.social | $0, 20 posts/month, 3 accounts, API included | API key | `postDate`, `status`, `platforms` blocks | Needs a mapping layer; best free starting point |
| upload-post | $0, 10 uploads/month, 2 profiles | `Authorization: Apikey …` | multipart file upload (`/api/upload_text`, `/api/upload_photos`) | Poor fit: it wants files, and the console stores URLs |

Steps, in order:

1. Create a bundle.social account (free, no card) and create a team.
2. Connect the channels: LinkedIn (the company page, which needs its own admin approval), X,
   Facebook page, Instagram business account. Approvals live with the provider, which is the reason
   for using one.
3. Create an API key, then set on the server:
   `SOCIAL_API_URL=https://api.bundle.social/api/v1/post` and `SOCIAL_API_KEY=…`.
4. I map `publishPost` onto their schema in one place (`lib/social-provider.ts`), keeping the
   console untouched, and test with a single draft scheduled two minutes out.
5. Only then switch `publishing_enabled` on in the Marketing console. Until a first post succeeds,
   leaving the switch off means a queue that cannot embarrass the domain.

The mapping has to be written against the provider's live reference rather than guessed: field
names differ between their docs versions, and a wrong key fails silently as a validation error on
their side. That is a one-function change once the account exists.

## Sources

- HubSpot: sequences and step types — knowledge.hubspot.com/sequences/create-and-edit-sequences;
  feature and template limits — hubspot.com/pricing/sales
- Pipedrive: email templates and merge fields, sending from automations — support.pipedrive.com
- Close: designing a cold outbound cadence — help.close.com/best-practices/designing-a-cold-outbound-cadence
- Reply.io: sequence steps, variants, delay defaults — how.reply.io/how-to/create-a-sequence
- Copper: email sequences, templates, tracking — copper.com/marketing-tools
- Benchmarks: two follow-ups roughly double replies (0.81% → 1.61%), ~79% of replies within 24h —
  emailchaser.com/cold-email-benchmarks; cadence spacing — warmerly.com/email-outreach/sequences
- Salesforce: cadence definition and stop-on-reply — salesforce.com/sales/cadence
- Companies House API authentication (basic auth, key as username) —
  developer.company-information.service.gov.uk/authentication
