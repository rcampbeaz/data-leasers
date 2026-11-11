# CRM data model review

A field-by-field pass over the CRM schema as it stands after `0007_deals.sql`, done before
adding features. Nothing here is a claim about what the site publishes; it is a record of
what the database can and cannot hold today.

Run order: `0001` → `0008`. `0008_partner_erasure.sql` adds `partners.erased_at`.

---

## What is already sound

Worth keeping as-is, so later work does not undo it:

- **The company owns the stage.** Leads are intake only, and `stage_history` is written by a
  trigger rather than by the app, so a stage change cannot be skipped or faked.
- **Closing requires a reason**, enforced by a check constraint, and closed records are kept.
- **Money is stored as `numeric(14,2)` with an explicit currency**, never as a float and
  never formatted on the way in.
- **The referral deadline is stored, not derived.** `deadline_on` is written as
  `registered_on + 6 months`, so changing the rule later cannot rewrite what was promised.
- **Personal contact details are separated from the staff list.** `crm_staff` is readable by
  everyone; phone and address live in `crm_staff_profiles`, admin-only.
- **Append-only history.** `audit_log` and `stage_history` accept no updates or deletes
  through the API.

---

## Two things that are wrong, not just missing

### 1. `leads.stage` is a dead column with retired vocabulary

`0001` gave leads a `stage` column constrained to the old list, which still includes
`Introduced to Mode` and `Mode in discussion`. `0007` renamed the stage values on
`companies` and `stage_history` but not on `leads`, and nothing in the app reads
`leads.stage` — the pipeline reads `companies.stage`.

So the column is unused, and its constraint still permits stage names that no longer exist
anywhere else. It is the only place in the schema where the old vocabulary survives.

**Fix:** `alter table public.leads drop column if exists stage;`

### 2. `audit_log.entity_id` is `uuid not null`, but not every event is a UUID

The column assumes every logged thing is a row. Some log entries are not:

- `erasure` and `settings` events, which currently borrow the actor's user id as
  `entity_id` — technically valid, semantically wrong.
- `lead import`, a bulk event with a count and no single row.

**Fix:** change `entity_id` to `text`. Existing rows convert cleanly. Then an import can log
`entity = 'lead_import'` with `entity_id = '2026-11-11'` or similar, and erasure can log
against the email's hash rather than the actor.

---

## Field by field

### `companies`

Holds: `name`, `stage`, `lead_id`, `notes`, `owner_id`, `introduced_by`, `source`,
`next_action`, `next_action_due`, `close_reason`, `closed_at`, `updated_at`.

This is the record a licensing agreement is written against, and it currently cannot hold
the things an agreement needs.

| Missing | Why it matters |
| --- | --- |
| `legal_name` | The signing party is often not the trading name ("Acme Labs, Inc." versus "Acme"). Today `name` has to serve both. |
| `company_number`, `jurisdiction` | Needed on the agreement, and determines governing law. |
| `address_line1`, `address_line2`, `city`, `region`, `postcode`, `country` | The address goes on the contract. It also tells you which privacy regime applies to the company. |
| `website` | Matching, deduplication, and the first thing checked when a lead arrives. |
| `subject_geography` | Whether the records are about US, EU, UK or mixed data subjects. This is the single biggest qualification question and there is nowhere structured to put it. |
| `sensitivity` | Whether the data touches health, financial, children's, biometric or precise-location records. Free-text notes is the current answer, which cannot be filtered or counted. |
| `record_count`, `subject_count` | The qualification threshold is volume-based; the number is currently typed into notes. |
| `industry` | Matching a company to buyers. |
| `primary_contact_id` | `contacts` exists but nothing marks which person is the one to call. |
| `duplicate_of` | Two leads for one company is common; merging loses history unless recorded. |
| `priority` | Nothing distinguishes the company worth calling today from the one worth calling next month. |
| `stage_entered_at` | Days-in-stage is computed from `stage_history` on every page load. The trigger could maintain this column instead. |

Logic nit: reopening a closed company clears `stage` but leaves `close_reason` and
`closed_at` populated. Either clear them on reopen or keep them deliberately as "last
outcome", and say which in a comment.

### `leads`

Holds: `id`, `name`, `email`, `company`, `role_title`, `data_note`, `source_page`,
`assigned_to`, `created_at`, plus the dead `stage`.

| Missing | Why it matters |
| --- | --- |
| a unique index on `lower(email)` | Duplicate detection is currently an app-level `ilike` check in one action. The website form and the inbound path have no such check, so duplicates can still arrive. A partial unique index would be the real guard. |
| `phone`, `country` | Callbacks need a number and a timezone. |
| `consent_at`, `consent_version` | When the person agreed to be contacted, and which notice they saw. This is the record you produce if someone asks. |
| `referrer`, `landing_page`, `utm_*` | Which page produced the enquiry, without reading server logs. |
| `updated_at`, `deleted_at` | No record of last contact; erasure is a hard delete, so there is no audit trail of the row beyond the log entry. |
| `spam` | A junk submission is deleted or kept as a real lead; there is no third option. |

### `datasets`

Holds: `name`, `status`, `status_reason`, `created_at`.

The reviewer approves or blocks on this record, but it describes the data only by name.

| Missing | Why it matters |
| --- | --- |
| `record_count`, `attribute_count`, `subject_count` | The first three questions any buyer asks. |
| `period_start`, `period_end` | How far back the records go; buyers price on recency. |
| `update_frequency` | One-off delivery versus a recurring feed is a different deal entirely. |
| `subject_geography`, `sensitivity` | Same qualification axes as the company, at the level where they actually vary. |
| `rights_basis`, `rights_evidence` | How the company obtained the data (first party, licensed, public record) and a pointer to the document proving it. `documents.dataset_id` exists but nothing records the basis itself. |
| `sample_location` | Where the sample lives, so a buyer can be sent one without asking. |
| `status_updated_by`, `status_updated_at` | Who approved this dataset and when. The audit log has it, but not on the row the reviewer is looking at. |

Logic nit: `status` has no terminal state. A delivered dataset stays `Approved` forever, so
"approved" cannot be distinguished from "approved and already sold".

### `contacts`

Holds: `name`, `email`, `role_title`, `created_at`.

| Missing | Why it matters |
| --- | --- |
| `phone`, `linkedin` | Email-only means no way to reach someone who does not answer email. |
| `is_primary` | Which contact the agreement correspondence goes to. |
| `decision_maker` | Who can actually sign. |
| `opted_out` | A person who asked not to be contacted is currently only remembered in notes. |
| `last_contacted_at` | Whether this person has been spoken to at all. |
| `notes` | No free text on the person. |
| unique `(company_id, lower(email))` | The same person is currently addable twice. |

### `activities`

Holds: `kind` (`note`, `call`, `email`, `decision`), `body`, `call_at`, `created_by`,
`created_at`.

The inbound email endpoint writes here, which makes the gaps sharper.

| Missing | Why it matters |
| --- | --- |
| `subject` | An email activity stores only a body. |
| `direction` | Inbound and outbound are indistinguishable. |
| `external_id` | Nothing deduplicates a replayed webhook, so the same email can be recorded twice. |
| `duration_minutes` | Calls have a time but no length. |
| `outcome` | What came of the call; currently prose in the body. |
| `kind` values `meeting`, `sms` | The enum is narrower than reality, so a meeting is logged as a note. |

### `tasks`

Holds: `title`, `due_on`, `assigned_to`, `done`, `reminded_at`, `created_at`.

| Missing | Why it matters |
| --- | --- |
| `detail` | Only a title can be stored. |
| `completed_at`, `completed_by` | `done` is a boolean with no timestamp, so "done last week" is unrecoverable, and the reminder cron cannot tell what was just completed. |
| `priority` | Every task looks equally urgent. |
| `created_by` | No record of who asked for the task. |
| `offer_id` / `referral_id` | A task cannot be attached to the deal it belongs to. |

### `buyers`

Holds: `name`, `kind` (`program`, `lab`, `broker`), `notes`, `active`, `created_at`.

There is nowhere to record what a buyer actually buys, which is what "introduce this company
to this buyer" depends on.

| Missing | Why it matters |
| --- | --- |
| `contact_name`, `contact_email` | The person to send the introduction to. |
| `data_types`, `verticals`, `geographies` | The matching criteria. Without them the introduction is a guess. |
| `offer_min`, `offer_max` | The band this buyer works in. Internal only — this is not site copy and must not be published. |
| `nda_required`, `response_days` | Whether a signature is needed before detail is shared, and how long they take to answer. |
| `website` | Identification. |
| `kind` value `aggregator` | Resellers do not fit program, lab or broker. |

### `introductions`

Holds: `company_id`, `buyer_id`, `introduced_on`, `introduced_by`, `notes`.

"Introduced" is currently one irreversible fact. A real introduction has a response.

| Missing | Why it matters |
| --- | --- |
| `status` (`sent`, `acknowledged`, `declined`) | Whether the buyer engaged, which is what the pipeline stage is trying to express. |
| `buyer_contact_id` | Who received it. |
| `sent_at`, `responded_at` | The clock on the buyer's response. |
| `channel` | Email, call or platform. |

### `offers`

Holds: `company_id`, `buyer_id`, `introduction_id`, `amount`, `currency`, `term_months`,
`exclusivity_months`, `status`, `offered_on`, `decided_on`, `notes`.

| Missing | Why it matters |
| --- | --- |
| `structure` (`one_off`, `per_record`, `revenue_share`) | A $250,000 one-off and $250,000 of revenue share are not comparable, and the ledger treats them identically. |
| `payment_terms_days` | Net 30 or net 60 changes when the referral fee can be paid. |
| `volume_covered` | Which dataset slice the price is for. |
| `expires_on` | Offers lapse informally today; nothing records the date the buyer gave. |
| `parent_offer_id` | Counter-offers cannot be linked to the offer they answer. |
| `exclusivity_fee` | Exclusivity is tracked as months only, not as the premium it carries. |

Logic nits: `amount` allows `0`, though the action rejects it — the constraint should say
`> 0`. And `decided_on` is overwritten on every status change, so re-deciding loses the
first decision date (the audit log now keeps it).

### `agreements`

Holds: `company_id`, `offer_id`, `buyer_id`, `licence_start`, `licence_end`,
`exclusivity_end`, `delivered_on`, `deletion_due`, `audit_right`, `status`, `signed_on`,
`notes`.

The obligations are dated well. What is missing is proof they were met.

| Missing | Why it matters |
| --- | --- |
| `deletion_confirmed_on`, `deletion_evidence_id` | `deletion_due` records the promise to delete raw data after 120 days. Nothing records that the deletion happened, which is the thing the promise is worth. |
| `contract_reference` | The counterparty's own reference for the paper. |
| `signing_entity` | The buyer record may be a broker while the contract is with the program behind it. |
| `governing_law` | Follows from jurisdiction, but belongs on the agreement. |
| `payment_amount`, `payment_schedule` | The signed figure, which can differ from the offer. |
| `notice_days`, `renews_on` | Renewal and termination terms. |
| `terminated_on`, `termination_reason` | `status = 'ended'` says it ended, not when or why. |
| `signed_by_name`, `countersigned_on` | Who signed for the company, and when it came back. |

Logic nit: `status` includes `draft`, but `addAgreement` always inserts `signed`. Either the
draft state is unreachable or the action needs a status field.

### `documents`

Holds: `company_id`, `dataset_id`, `kind`, `title`, `location`, `signed_on`, `notes`,
`created_by`, `created_at`.

Deliberately metadata plus a link. Once a bucket exists, this becomes the file register.

| Missing | Why it matters |
| --- | --- |
| `storage_path`, `mime_type`, `size_bytes`, `checksum` | The fields a signed-URL flow needs, and the checksum that proves the file has not changed. |
| `version`, `supersedes_id` | A second NDA replaces the first; today both look current. |
| `expires_on` | NDAs and licences expire, and nothing here can alert on it. |
| `verified_at`, `verified_by` | Whether anyone has actually opened the file. |

### `partners`

Holds: `name`, `email`, `organisation`, `fee_rate`, `fee_floor`, `notes`, `created_by`,
`created_at`, and now `erased_at`.

Sound as a ledger anchor. Note that `fee_rate` and `fee_floor` are partner-confidential
figures — they must not reach the public site, and (see below) probably not reviewers either.

| Missing | Why it matters |
| --- | --- |
| `agreement_signed_on` | The site registers a partner and promises a fee; nothing records that they accepted the terms. |
| `status` (`active`, `paused`) | `active` exists on buyers but not here. |

### `referrals`

Holds: `partner_id`, `company_id`, `company_name`, `registered_on`, `deadline_on`,
`status`, `fee_amount`, `paid_on`, `notes`.

Logic nit: `company_name` duplicates `companies.name` when `company_id` is set. The two will
drift. Either derive the display name from the join, or state that `company_name` is the
name as registered and the join is only a link.

### `audit_log`, `stage_history`, `crm_staff`

- `audit_log.entity_id` — the type problem above. Also no index on `(entity, entity_id)` or
  on `created_at`, so reading one company's history is a scan.
- `stage_history` — no index on `(company_id, changed_at)`, which is exactly the query the
  pipeline runs for every company.
- `crm_staff` — no `active` flag, so removing someone means deleting the row and losing the
  link from their old tasks and history; and no `last_seen_at`.

---

## What I would add first

Ordered by what blocks a feature you would plausibly ask for next, not by table order.

**P1 — before the next screen is built**

1. `companies`: legal name, address block, `website`, `jurisdiction`, `subject_geography`,
   `sensitivity`, `record_count`.
2. `datasets`: `record_count`, `period_start`, `period_end`, `update_frequency`,
   `subject_geography`, `rights_basis`.
3. `agreements`: `deletion_confirmed_on` and evidence, so the 120-day promise is provable.
4. Drop `leads.stage`; widen `audit_log.entity_id` to `text`.

**P2 — makes the deal screens honest**

5. Buyer profile: contacts, what they buy, offer band, response time.
6. Offer `structure` and `expires_on`; introduction `status`.
7. `tasks.completed_at`, `contacts.is_primary`/`phone`, `activities.subject`/`external_id`.
8. Indexes: `audit_log(entity, entity_id)`, `stage_history(company_id, changed_at)`,
   `leads(lower(email))`, `companies(stage)`, `companies(next_action_due)`, `tasks(due_on)`.

**P3 — nice to have once volume grows**

9. Document versioning, expiry and checksums.
10. `crm_staff.active`, `last_seen_at`.
11. `stage_entered_at` maintained by the existing trigger, replacing the per-page rescan.

---

## Reviewer access — recommendation

**Give reviewers the company, not the money.**

A reviewer's job is to decide whether a dataset can be sold: whether the rights are there,
whether the data is what it claims, and whether anything in it makes it unsellable. That
needs the company record, its datasets, its notes and activities, and the documents that
evidence the rights.

It does not need partner fee rates, referral fee amounts, offer values or agreement
commercial terms. Today `0007` grants every staff role `select` on `partners`, `referrals`,
`offers` and `agreements`, so a reviewer can read the confidential figures by typing the
URL, even though the sidebar hides them. Hiding the link while leaving the data readable is
the worst of both: it looks controlled and is not.

Recommended setup:

1. **Tighten read access** on `partners`, `referrals`, `offers` and `agreements` to
   `admin` and `introducer`. Keep `buyers`, `introductions` and `documents` readable by all
   staff — a buyer's name and the fact of an introduction are useful context, not a
   confidential figure.
2. **Add `Companies` to the reviewer's navigation** (read-only; reviewers can already write
   dataset status and their own completed tasks, nothing else). The review queue alone does
   not show the company behind the dataset.
3. Leave `viewer` as it is: read-only across deals, no partner rates, no writes.

Two statements, one migration and one nav line. I would ship the RLS change as `0009` and
the nav change with it, so the sidebar never offers a page the role cannot read.
