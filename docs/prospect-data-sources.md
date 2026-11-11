# Where to get prospects for free

The target is 20 companies that have started, completed or are holding an LOI by the end of Q1
2027. Companies that qualify are small professional firms in the US, Canada, the UK and Australia:
10+ staff in accounting, finance or medical groups, 6+ in legal, with revenue between $100K and $5M.
The `companies` table already stores what a firm needs to be judged against that: legal name,
website, industry, employee count, founded year, registration number, phone, a structured address
and `staff_countries`.

This page is the sourcing side of that. It lists only sources that are free and whose terms allow
you to read and store the data, says what each one actually gives you, and sets the order to build
the importer in. Anything marked **do not scrape** is there because the terms forbid it, not because
it is hard.

## The sources, in build order

### 1. Companies House (UK) - build this first

- **What it gives.** Registered company name, company number, incorporation date, registered
  office, SIC codes, status, and filing history. Advanced search filters on SIC code, incorporation
  date range, location and status before you download anything.
- **Access.** Free. Public register, Open Government Licence v3, so storing and reusing it is
  permitted with attribution. There is a free REST API key, and the advanced search offers CSV
  export for bulk work. The brief for this research put the rate limit at roughly 600 requests per
  five minutes; confirm the current figure in the developer docs before hard-coding a rate.
- **Limits.** No employee counts and no revenue. Directors are listed, which is the useful part:
  an owner-managed firm with the same person as director for 15+ years is the profile that sells.
- **Filter.** SIC 69201/69202/69203 (accounting, bookkeeping, tax), 69102 (solicitors), 86210
  (general medical practice), 86900 (other human health). Incorporated before 2015. Status active.
  Exclude anything with a parent group named in the accounts.
- **Map to.** `legal_name` from the registered name, `registration_number` from the company number,
  `founded_year` from incorporation date, address fields from the registered office, `website` from
  the filings' previous names or a domain guess that is then verified.

### 2. SRA Data Share (UK legal)

- **What it gives.** The whole solicitor-firm dataset in one place, including firm email addresses
  and phone numbers - contact detail that the company register does not carry.
- **Access.** Free. Read the terms of use and the attribution requirement before the first import;
  the dataset is published for reuse but the exact licence wording should be quoted in
  `docs/` rather than assumed.
- **Filter.** Firms with 6+ fee earners, which the dataset's headcount fields support, and offices in
  England and Wales.
- **Map to.** `legal_name`, `phone`, structured address, `industry = 'Legal'`, plus a `contacts` row
  for the practice manager where one is named.

### 3. NPPES NPI Registry (US medical)

- **What it gives.** Every US healthcare organisation and individual with an NPI: organisation
  name, practice address, phone, taxonomy (specialty), and the **Authorized Official** - usually the
  owner or administrator, with a name you can address a letter to.
- **Access.** Free, no API key, documented REST API and a downloadable full replacement file. This
  is the single best free list for the medical segment.
- **Limits.** No employee counts. Pair with CMS group-affiliation or claim-volume files to judge
  size, and use the site count as a proxy.
- **Filter.** Organisation NPIs (type 2), taxonomy in family practice, internal medicine, dental,
  chiropractic, physical therapy, ophthalmology; state in the target set; exclude hospital-owned
  entities by name.

### 4. StatCan Open Database of Businesses (Canada)

- **What it gives.** Canadian business locations **with employee counts** - the only free source in
  this list that carries headcount directly.
- **Access.** Free, published by Statistics Canada under the Open Government Licence - Canada.
- **Filter.** NAICS 5412 (accounting, tax, bookkeeping), 5411 (legal), 6211/6212 (physician and
  dental offices), employee count 10+ (6+ for legal), province in the target set.
- **Map to.** `employee_count` straight from the file, which makes it the best source for the size
  filter the other lists lack.

### 5. Corporations Canada

- **What it gives.** Federal corporation records: status, registered office, directors.
- **Access.** Free API, reported at 60 requests per minute.
- **Limits.** Lookup by corporation number or business number - it is not a discovery engine. Use it
  to enrich and verify names you already have from StatCan or from brokerage listings.
- **Map to.** `registration_number`, `founded_year`, director names as a signal of owner-management.

### 6. ABN Lookup (Australia)

- **What it gives.** Australian business names, ABN status, entity type, GST registration, business
  locations for many entries.
- **Access.** Free API with a GUID obtained by registering; web services are documented and rate
  limited per GUID.
- **Limits.** No employee counts, and the name/address fields are messier than the UK register.
  Filter on ANZSIC equivalents of the accounting, legal and medical codes and verify size by hand.
- **Map to.** `legal_name`, `registration_number` (the ABN), address, `industry`.

### 7. CPAverify and state licence lookups (US accounting)

- **What it gives.** Confirmation that a firm or individual holds a live CPA licence, and often the
  firm's registered address and licence number.
- **Access.** Free lookups through CPAverify, which aggregates participating state boards. Use it to
  verify a firm found elsewhere, not as a discovery list.

### 8. Practice brokerages and consolidators

The most under-used free source in this category, because the listing *is* a firm that has already
decided to sell something - a client book, a practice, or the whole entity.

- **Accounting:** Accounting Practice Sales, Poe Group Advisors.
- **Legal:** Legal Brokers Ltd.
- **Medical and mixed:** The Practice Market (its public listings, at the time of the research,
  covered 55 law and 94 medical practices), Practice Orbit.
- **Consolidators buying these firms:** Heartland (1,900+ agencies), PDS Health, Azets, Xeinadin.
  They are not prospects for data licensing - they are the buyer side, and a route to many firms at
  once.

What to take from a listing: firm name, location, headcount if stated, revenue multiple and asking
price (which gives you a revenue estimate), and the broker as a contact. Read each site's terms;
store the listing link and the date you read it, because listings disappear.

**Map to.** `companies` (industry, employee count, address), and `partners` for the broker, who is a
referral channel in their own right: they speak to every owner who is thinking about an exit.

## Do not scrape

These were checked and are off-limits for automated collection, either because their terms forbid
it or because the data is licensed: Google Maps, Apple Maps and Bing Maps; Ahpra (Australia's
health practitioner register); the New York court attorney directory; the State Bar of Texas; G2 and
Capterra; Crunchbase; bulk OpenCorporates; CPABC. Where a person can read a page and type a fact
into the CRM, that is fine - the line is automated collection.

## What the importer needs

One importer, four adapters, one shared pipeline. Each adapter turns a source row into a candidate
with a `source`, `source_url` and `retrieved_at`, and the pipeline does the rest:

1. **Normalise** the name (strip Ltd/Limited/LLC/Pty/Inc), the domain (strip `www.`, trailing slash)
   and the phone (E.164).
2. **Dedupe** on registration number first, then domain, then normalised name plus postcode. A firm
   that appears in Companies House and in a brokerage listing is one company, not two.
3. **Score** against the target profile: size band, sector, country, owner-managed signal
   (director tenure, incorporation year), and whether the firm runs a client portal or an old ticket
   system (a hand-checked field).
4. **Write** to `companies` only when the score clears the bar, with stage `New lead` and a note that
   records where the row came from. Everything else goes to a review queue rather than the pipeline.
5. **Record** the source and retrieval date on every row, so a later question about where a company
   came from has an answer.

Volume estimate: to land 20 LOIs you need a few hundred qualified firms in the pipeline, not tens of
thousands of raw rows. The arithmetic sits in `docs/ai-marketing-engine.md`; the practical
consequence here is that precision beats volume, and the four sources above are enough to reach
several hundred qualified firms without buying a list.
