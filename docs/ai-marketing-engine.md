# The AI marketing engine: what the staff does, and what it must not

Researched November 2026. Prices and platform rules change; re-check before spending.

The constraint that shapes everything: **the offer is "license the records your firm already
made"** — sold to owners of accounting, law, medical and software firms with 30+ staff in the
US, Canada, the UK and Australia. That audience is small, professional, heavily regulated in
how it may be contacted, and allergic to hype. Volume automation aimed at them is a fast way
to get the domain, the LinkedIn account or the sending reputation burned.

## 1. The arithmetic, before choosing channels

Target: 20 companies started, completed or holding a letter of intent by 31 March 2027.

Working backwards with illustrative conversion rates (our own numbers replace these after four
weeks of real data):

| Stage | Assumption | Needed for 20 |
| --- | --- | --- |
| Introduction → LOI | 30% | ~67 introductions |
| Qualified company → introduction | 50% | ~134 qualified companies |
| First call → qualified | 35% | ~383 first calls |
| Reply → first call | 30% | ~1,277 replies |
| Email sent → reply | 5% | ~25,000 emails |

25,000 targeted emails in 19 weeks is not a plan; it is a spam campaign with a plan's
letterhead. The honest read: **cold outbound alone cannot reach 20 deals this quarter.** It can
reach a handful and it can feed the funnel, but the number comes from channels where somebody
else already has the relationship:

- **Referral partners** — accountants, M&A advisors and business brokers who sit in front of
  firm owners at exactly the moment records and succession matter. The site already publishes a
  6% / $50,000 floor referral programme; that is the cheapest distribution asset we own and it
  is barely used. Recruiting 10 active referrers beats 2,500 cold emails.
- **Association and trade editorial** — CPE/CPD channels and trade media carry the audience and
  the credibility in one move (see §4).
- **LinkedIn founder content** — the only social channel whose audience matches. 2–3 posts a
  week, written by a person, not a bot.

Cold email then does what it is good at: a few hundred well-researched conversations a month
with firms that match the profile, at a reply rate that stays respectable because the list is
small and the message is specific.

## 2. What the AI staff owns

| Task | Owner | Why |
| --- | --- | --- |
| Target list assembly from public registries | Agent | Deterministic, licence-cleared, auditable |
| Firmographic scoring (headcount, industry, systems) | Agent | Rules over data, no judgement needed |
| First-line research per company | Agent | Reading public pages and filings |
| Drafting email variants | Agent | Drafts only; a person approves |
| Follow-up drafting and sequencing | Agent | Existing agent layer already does this |
| Meeting notes → CRM activities | Agent | High value, low risk |
| Pipeline review: stale companies, missing next actions | Agent (scheduled) | The CRM knows this already |
| Content: one asset → channel variants | Agent | Built (Marketing page) |
| Association/podcast pitch drafts | Agent | Human sends |
| Sending the first cold email to a new domain | Human | Reputation and legal basis |
| Replying to a prospect | Human | The whole product is trust |
| Posting in Reddit/Quora/HN/communities | Human only | Rules forbid automated promotion |
| Cold AI voice calls | **Nobody** | See §3 |
| Pricing, offers, terms | Human | Never delegated |

## 3. The legal walls

**AI voice calls are out.** The FCC ruled on 8 February 2024 that AI-generated voices are
"artificial or prerecorded" under the TCPA, so covered calls need prior express consent; a
number published on a company website is not consent. Telemarketing to wireless numbers needs
prior express *written* consent. Federal do-not-call rules exempt calls to business numbers, but
not to a personal mobile or residential line, and a 30-person firm's "business" number is often
somebody's mobile. Add recording-consent differences (Arizona one-party, California two-party),
UK PECR's automated-call consent rule and Australia's Do Not Call regime, and the risk/reward
is upside-down for a company whose product is trust. Use AI voice only where consent exists:
inbound answering, booked-call reminders, opted-in follow-up.
Sources: FCC 24-17 (https://docs.fcc.gov/public/attachments/FCC-24-17A1.pdf),
47 CFR 64.1200 (https://www.ecfr.gov/current/title-47/chapter-I/subchapter-B/part-64/section-64.1200),
ICO telephone marketing (https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guide-to-pecr/electronic-and-telephone-marketing/telephone-marketing),
ACMA (https://www.acma.gov.au/do-not-call-register).

**Email is legal but country-specific.** US: CAN-SPAM — no consent needed, but accurate headers,
no deceptive subject, a postal address, and opt-outs honoured within 10 business days. Canada:
CASL is the strict one — express or implied consent; a conspicuously published business address
only counts when there is no "no unsolicited messages" notice and the message is relevant to the
role. UK: PECR allows email to *corporate subscribers* without consent, but sole traders and
ordinary partnerships are individuals and need consent or soft opt-in; UK GDPR still applies to
the person's data. Australia: the Spam Act requires consent, with narrow inferred consent;
unsubscribe must work for 30 days.
Sources: FTC CAN-SPAM guide (https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business),
CRTC CASL FAQ (https://crtc.gc.ca/eng/com500/faq500.htm),
ICO B2B marketing (https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/business-to-business-marketing/),
ACMA spam guidance (https://www.acma.gov.au/avoid-sending-spam).

**Deliverability is the other half.** SPF, DKIM and DMARC, a separate sending subdomain,
volume ramped slowly, bounces and complaints suppressed before the next send. Google's
bulk-sender rules (5,000+/day to Gmail) require authentication and one-click unsubscribe, and
spam-complaint rates should stay under 0.1%, never near 0.3%
(https://support.google.com/mail/answer/81126).

**Where automation gets banned, not just ignored.** r/Accounting rule 2 forbids self-promotion,
solicitation and even PMing users from comments. Hacker News bans generated submissions and
promotional accounts. LinkedIn's agreement bars scraping and automation. Google Maps/Places
terms forbid extracting, storing or resharing business names and addresses — `place_id` is the
only cacheable field — so Places cannot be used to build a mailing list. Canada's Business
Registries state plainly that automated collection is not allowed. Any plan that depends on
those four things is not a plan.

## 4. Channels, with real numbers

**Free or near-free, high trust**
- LinkedIn founder profile: 2–3 posts a week plus genuine comments. Official posting API
  (`w_member_social`, or the Posts API) exists; company Page posting needs Community Management
  access. Expect 20–150 qualified visits a month — the best social source by a distance.
- Datarade Marketplace: the on-thesis listing for a company that brokers datasets. Free tier is
  $0/yr with 30% commission, three listings (https://providers.datarade.ai/apply).
- ABA *Law Technology Today* blog: $2,050 per post. Illinois State Bar sponsored article: from
  $200. These are the cheapest legitimate entries into professional audiences found.
- Conference calls for speakers: mostly 2027 cycles now (HCCA closed 31 Aug 2026; MACPA 9 Oct
  2026). Diarise spring 2027.

**Paid, credible, and worth it once the funnel is proven**
- ACCA (via Odyssey): £2,500 per profile advert to 256,000 members.
- CPA Australia *INPRACTICE* (9,500 public-practice subscribers) or *Tax News* (81,000): from
  A$5,000+GST per EDM — the most targeted buy for firm owners.
- MGMA newsletter: $1,395–1,550/week, 47,000 subscribers; sponsored podcast $3,600–4,000.
- *The Accounting Podcast*: from $2,500 an episode; the hosts already discuss firm economics and AI.
- *Going Concern* sponsored package: $6,250/$8,000; 66,000 subscribers. Their writers publicly
  mock "turn your old Slacks into free money" pitches, so the framing has to be sober.
- Legal Talk Network: guest pitch form, $250–300 CPM sponsorship.

**Do not buy yet:** AICPA *Journal of Accountancy* full page ($25,000), CPA Canada *Pivot*,
Law Society Gazette Insight (£5,775+VAT). Real audiences, wrong stage.

**Editorial that will be rejected outright:** supplier bylines at the Law Society Gazette, ABA
Journal *Your Voice*, and any unpaid state-bar "article" that reads as a commercial. Don't waste
the relationship.

## 5. Data sources that are licence-clean

- **Companies House API (UK)** — the best value here. Free, commercial use allowed, advanced
  search filters by SIC code and incorporation date, 600 requests per 5 minutes. Gives entity
  name, number, status, registered office, officers, SIC codes, filing history.
  (https://developer.company-information.service.gov.uk/)
- **Corporations Canada API** and open datasets — free, keyed; the provincial "Business
  Registries" portal explicitly forbids automated collection.
- **ABN Lookup (Australia)** — free; no industry code, so pair it with another source.
- **SEC EDGAR** — free, 10 requests/second, but only public companies; use for benchmarks, not
  target lists.
- **PDL or Apollo for headcount and contacts** — internal use only, not resale. PDL's free tier
  obfuscates emails; Apollo's free tier is ~75 credits/seat/month. One, not both.
- **Public ATS boards (Greenhouse, Lever, Ashby)** — free, unauthenticated, and a strong size and
  growth signal: a firm hiring a controller or an IT manager is a firm with systems worth
  licensing.
- **Tech-stack detection** (BuiltWith paid credits, Wappalyzer Business) to score "records spread
  across systems": Clio, iManage, NetSuite, Xero, Salesforce, DocuSign, Zendesk.

Never: scrape LinkedIn, resell Apollo or Wappalyzer data, keep Google Places addresses, or
auto-collect from Canada's registries.

## 6. Build order

**P0 — already shipped**
Company profile fields (address, headcount, staff countries), marketing console (channels,
content, per-channel posts, publisher, agent drafting), deploy verification.

**P1 — the outbound spine (next)**
1. `packages`/`suppression` tables: every email address ever contacted, with the legal basis
   relied on, the source and the date. Unsubscribe sets a flag that every future send checks.
2. Sequence engine: steps, delays, stop-on-reply, and a hard "human approves the first send"
   rule. Resend for delivery (already configured), a separate subdomain for prospect mail.
3. One-click unsubscribe route and a public `/unsubscribe` page on the CRM origin, plus the
   postal address in the footer of every commercial email.
4. Per-country send guard: Canada and Australia require a recorded basis before the first send;
   the composer refuses without one.
5. Reply handling: Resend inbound webhook → activity on the company, agent drafts a reply, human
   sends.

**P2 — the referral engine and the assets**
6. Partner pipeline: a page that tracks referrers from first contact to first paid referral, with
   the six-month deadline the schema already stores.
7. The "what is your firm's data actually worth" estimator on the site, with immediate results
   and no registration wall.
8. A benchmarking report built from public filings — the asset trade press will actually cite.
9. Scheduled agent jobs: Monday pipeline review, stale-company alerts, meeting-note capture.

**P3 — prove, then spend**
10. Analytics snapshots for social posts; then test one paid association placement (ACCA or CPA
    Australia) against the organic baseline.

## 7. Design and discovery, 2026 reality

Google states AI Overviews and AI Mode require no special technical markup — only being indexed
and eligible for a snippet. `llms.txt` is not a visibility lever, whatever the SEO posts say.
What correlates with citation is boring: fresh, specific, well-structured pages that answer a
real question, with the entity and the source named on the page. So: comparison pages, a
glossary, one genuinely useful interactive tool, and structured data that matches visible copy.

Design: the site is already dark, editorial and type-led, which is current; motion should stay
purposeful and cheap. The evidence for "dark mode converts better" or "scrollytelling lifts
leads" does not exist as a general finding — test against qualified enquiries, not taste.
