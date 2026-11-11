# The agent staff: what to automate, and what must stay human

This is the operating manual for using agents on the pipeline. It sits next to
`docs/ai-marketing-engine.md`, which covers the funnel arithmetic and the legal walls, and
`docs/prospect-data-sources.md`, which covers where the names come from.

The rule that shapes everything below: **an agent may read, research, draft and prepare. A person
approves and sends.** That is not caution for its own sake. Benchmark evidence on browser agents
puts success at roughly 75%+ on read-and-report tasks and around 46.6% on tasks that write to a
third-party system (WebBench). Anything that touches a prospect's inbox, a social account or a
buyer's data room is in the second category.

## What is already built

- `/agents` - the agent switch and a daily cap, stored in `app_settings` under the `agents` key. Off
  by default. Every model call is checked against both.
- `/marketing` - agent-drafted social variants, per-channel scheduling, a brand linter, a publisher
  that claims work from a queue, and switches for publishing, drafting and approval.
- `/outbound` - suppression list, a lawful basis per contact, sequences, an approval gate, stop on
  reply, and a fail-closed sender. The rules are code (`lib/outbound.ts`), and the guard has been
  exercised against 12 cases covering US opt-out, Canadian consent, Australian consent and UK
  corporate subscribers.
- `/api/inbound/email` - a reply stops the sequence it belongs to.
- `/api/reminders` - dated next actions that would otherwise go quiet.

So the plumbing for "draft, approve, send, stop on reply" exists. What follows is what to put
through it.

## Task matrix

| Task | Agent | Mechanism | Human gate |
| --- | --- | --- | --- |
| Pull candidate firms from a source | Yes | Importer adapters, see `docs/prospect-data-sources.md` | Review queue for anything below the score bar |
| Enrich a company (site, phone, headcount, owner) | Yes | Fetch the company's own site, read the register, write fields | Spot-check a sample weekly |
| Score against the target profile | Yes | Deterministic rules, not a model | Threshold set by a person |
| Write the first line of a letter | Yes | Model, given the company's own words | Approval before it enters a sequence |
| Write a full sequence of 4 emails | Yes | Model, then `lintPost` and `sendGuard` | Approval gate in `/outbound` |
| Choose who to contact at a firm | Suggest | NPPES Authorized Official, SRA firm contact, Companies House director | Person confirms the name and address |
| Send cold email | No, not automatically | Cron sends only approved, sequenced contacts | Approval is the gate |
| Make a cold AI voice call | **Never** | FCC 24-17 (8 Feb 2024) treats AI voice as "artificial" under TCPA, so it needs prior express consent you do not have | - |
| Draft social posts from a topic | Yes | `generateDraft`, variants per channel | Schedule or approve by hand |
| Publish to social | Scheduled only | `SOCIAL_API_URL` adapter, 5-minute cron | The publishing and approval switches |
| Reply to a social comment or DM | Draft only | Agent writes, person posts | Person |
| Triage an inbound reply | Yes | Classify interested / not now / unsubscribe, then stop the sequence | Person reads anything classed as interested |
| Prepare a call brief | Yes | Company record, activities, dataset notes, public filings | - |
| Draft the dataset scoping questionnaire | Yes | Template plus company facts | Person sends |
| Chase an LOI that has gone quiet | Yes, as a reminder | `/api/reminders` and a task | Person makes the call |
| Weekly report on what moved | Yes | Query the CRM, write the summary | Read it |
| Update a buyer's data room | No | Write access to someone else's system | Person |

## The roles, and what each one is for

**Sourcing agent.** Runs the importers on a schedule, dedupes, scores, and writes candidates with a
source link and retrieval date. Success measure: qualified firms added per week, and the share of
imported rows a person accepts without editing.

**Research agent.** Takes one company and produces a one-page brief: what the firm does, how many
people, who owns it, what client systems it is likely to run, and the two or three sentences from
its own site that show it cares about client confidentiality or staff time. This is the highest-value
read task in the system, because it is what makes a letter read like it was written by someone who
looked.

**Copy agent.** Writes emails and social posts under constraints: no figure without a source link, no
naming the buyer, no promised outcome, no invented client. The linter already enforces the numeric
claim rule on social; the outbound path enforces the compliance footer and the opt-out.

**Triage agent.** Reads replies, classifies them, stops sequences, and drafts a response for a person
to send. It never sends.

**Reporting agent.** Every Monday: new candidates, letters sent, replies, calls booked, datasets
assessed, LOIs started and held, and anything stalled for more than 14 days. One page.

## How the agents are wired

- **Model calls stay server-side.** The cap in `app_settings` is checked before every call, so a
  runaway loop costs nothing after the cap.
- **Tools, not browsers, for structured work.** Where a service has an API or an MCP server
  (Supabase, Slack, Notion, Linear, HubSpot, Stripe), use it. A browser is the fallback for sites
  with no API, and only for reading.
- **Nothing is written to a third-party system by an agent.** Social and email both go out through
  this codebase, after a person's approval, so every send is in the audit trail.
- **Every agent action is attributable.** The row records which agent and which run produced it, so
  a bad letter can be traced to the prompt and the source it was given.

## Sequencing

1. Sourcing importer (Companies House first) and the review queue.
2. Research agent on top of imported rows, writing briefs into activities.
3. Copy agent producing the first letter, gated by the approval already in `/outbound`.
4. Triage agent on inbound replies.
5. Reporting agent, once there is a week of real numbers to report.

Steps 3 and 4 need a sending subdomain and a postal address in the footer, which are the two things
blocking a real send today.

## What to measure

Only these, weekly: qualified firms added, letters approved, replies, calls booked, datasets
assessed, LOIs started, LOIs held. Everything else is activity, and activity is not the target.
