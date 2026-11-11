'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createStaffClient } from '@/lib/supabase';
import { currentStaff } from '@/lib/data';
import {
  buildSearchQuery,
  companyNumberKey,
  displayName,
  findDuplicate,
  isChCompany,
  scoreCompany,
  type ExistingCompany,
} from '@/lib/companies-house';

// Sourcing. Runs a Companies House advanced search, scores what comes back, and writes it to
// the prospect queue. Nothing here creates a company: that only happens when a person
// accepts a candidate, and the accept path records who did it and when.

const PATH = '/import';
const SEARCH_URL = 'https://api.company-information.service.gov.uk/advanced-search/companies';

function fail(message: string): never {
  redirect(`${PATH}?error=${encodeURIComponent(message)}`);
}

async function requireImporter() {
  const supabase = await createStaffClient();
  const me = await currentStaff(supabase);
  if (!me || !['admin', 'introducer'].includes(me.role)) {
    fail('Your role does not allow importing prospects.');
  }
  return { supabase, me };
}

type SearchResponse = { hits?: string | number; items?: unknown[] };

// GET /advanced-search/companies. The API key is the basic-auth username, with an empty
// password, as Companies House documents. One page of results; `hits` is the true total.
async function searchCompanies(query: URLSearchParams, key: string): Promise<SearchResponse> {
  const response = await fetch(`${SEARCH_URL}?${query.toString()}`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });

  if (response.status === 401) fail('Companies House rejected the API key. Check COMPANIES_HOUSE_API_KEY.');
  if (response.status === 429) {
    fail('Companies House is rate limiting. The limit is 600 requests in five minutes; try again shortly.');
  }
  if (!response.ok) fail(`Companies House returned ${response.status}.`);

  return (await response.json().catch(() => ({}))) as SearchResponse;
}

export async function runCompaniesHouseImport(formData: FormData) {
  const { supabase } = await requireImporter();

  const key = process.env.COMPANIES_HOUSE_API_KEY;
  if (!key) {
    fail('Set COMPANIES_HOUSE_API_KEY on the server first. It is free from the Companies House developer hub.');
  }

  const groups = formData.getAll('groups').map(String).filter(Boolean);
  if (groups.length === 0) fail('Choose at least one sector to search.');

  const beforeYear = Number(formData.get('incorporatedBefore') ?? 0);
  const thisYear = new Date().getUTCFullYear();
  if (!Number.isInteger(beforeYear) || beforeYear < 1900 || beforeYear > thisYear) {
    fail(`Enter an incorporation year between 1900 and ${thisYear}.`);
  }
  const location = String(formData.get('location') ?? '').trim().slice(0, 100);

  const query = buildSearchQuery({
    groups,
    incorporatedTo: `${beforeYear}-12-31`,
    location: location || undefined,
  });

  const body = await searchCompanies(query, key);
  const items = (body.items ?? []).filter(isChCompany);
  if (items.length === 0) {
    redirect(`${PATH}?ran=1&found=0&added=0`);
  }

  // Everything already in the pipeline, so a firm is not imported twice. Bounded: this CRM
  // holds hundreds of companies, not millions.
  const { data: existingRows } = await supabase
    .from('companies')
    .select('id, name, registration_number, website')
    .limit(5000);
  const existing = (existingRows ?? []) as ExistingCompany[];

  const scored = items.map((item) => {
    const result = scoreCompany(item);
    const duplicate = findDuplicate(
      { nameKey: result.nameKey, registrationNumber: companyNumberKey(item.company_number) },
      existing,
    );
    const address = item.registered_office_address ?? {};
    return {
      source: 'companies_house' as const,
      source_id: companyNumberKey(item.company_number),
      source_url: `https://find-and-update.company-information.service.gov.uk/company/${companyNumberKey(item.company_number)}`,
      company_name: item.company_name,
      name_key: result.nameKey,
      registration_number: companyNumberKey(item.company_number),
      company_type: item.company_type ?? null,
      company_status: item.company_status ?? null,
      incorporated_on: item.date_of_creation ?? null,
      sic_codes: (item.sic_codes ?? []).map(String),
      industry: result.industry,
      region: address.region ?? null,
      locality: address.locality ?? null,
      postcode: address.postal_code ?? null,
      address_line1: address.address_line_1 ?? null,
      address_line2: address.address_line_2 ?? null,
      score: result.score,
      band: result.band,
      reasons: result.reasons,
      status: duplicate ? 'duplicate' : 'pending',
      matched_company_id: duplicate?.companyId ?? null,
      note: duplicate ? `Matched on ${duplicate.kind.replace('_', ' ')}: ${duplicate.companyName}` : null,
    };
  });

  // Skip what this source has already delivered, including rows a person has decided on.
  const { data: known } = await supabase
    .from('import_candidates')
    .select('source_id')
    .eq('source', 'companies_house')
    .in('source_id', scored.map((row) => row.source_id));
  const knownIds = new Set((known ?? []).map((row) => String(row.source_id)));
  const fresh = scored.filter((row) => !knownIds.has(row.source_id));

  if (fresh.length > 0) {
    const { error } = await supabase
      .from('import_candidates')
      .upsert(fresh, { onConflict: 'source,source_id', ignoreDuplicates: true });
    if (error) fail('Could not save the candidates. Has migration 0012 been run?');
  }

  revalidatePath(PATH);
  redirect(`${PATH}?ran=1&found=${items.length}&added=${fresh.length}`);
}

export async function acceptCandidate(candidateId: string) {
  const { supabase, me } = await requireImporter();

  const { data: candidate } = await supabase
    .from('import_candidates')
    .select(
      'id, company_name, registration_number, industry, incorporated_on, region, locality, postcode, address_line1, address_line2, score, band, reasons, status, matched_company_id, source_url',
    )
    .eq('id', candidateId)
    .maybeSingle();
  if (!candidate) fail('That candidate could not be found.');
  if (candidate.status !== 'pending') fail('That candidate has already been decided.');

  // A firm already in the pipeline is linked, not duplicated. The reviewer can then open the
  // existing record rather than working a second one.
  if (candidate.matched_company_id) {
    await supabase
      .from('import_candidates')
      .update({
        status: 'duplicate',
        reviewed_by: me.user_id,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', candidateId);
    revalidatePath(PATH);
    redirect(`${PATH}?duplicate=1`);
  }

  const foundedYear = candidate.incorporated_on
    ? new Date(candidate.incorporated_on as string).getUTCFullYear()
    : null;

  const { data: company, error } = await supabase
    .from('companies')
    .insert({
      name: displayName(String(candidate.company_name)),
      legal_name: String(candidate.company_name).slice(0, 200),
      stage: 'New lead',
      source: 'Companies House',
      industry: candidate.industry,
      employee_count: null,
      founded_year: foundedYear,
      registration_number: candidate.registration_number,
      address_line1: candidate.address_line1,
      address_line2: candidate.address_line2,
      city: candidate.locality,
      region: candidate.region,
      postal_code: candidate.postcode,
      country: 'GB',
      staff_countries: ['GB'],
    })
    .select('id')
    .single();
  if (error || !company) fail('Could not create the company.');

  // The score and its reasons are kept with the company as a note, so the call has the same
  // evidence the reviewer saw.
  const reasons = Array.isArray(candidate.reasons) ? (candidate.reasons as string[]) : [];
  await supabase.from('activities').insert({
    company_id: company.id,
    kind: 'note',
    body: [
      `Imported from Companies House (${candidate.registration_number ?? 'no number'}).`,
      `Score ${candidate.score}/100 (${candidate.band}).`,
      reasons.length ? `Reasons: ${reasons.join('; ')}.` : null,
      candidate.source_url ? `Register: ${candidate.source_url}` : null,
    ]
      .filter(Boolean)
      .join(' '),
    created_by: me.user_id,
  });

  await supabase
    .from('import_candidates')
    .update({
      status: 'accepted',
      matched_company_id: company.id,
      reviewed_by: me.user_id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', candidateId);

  revalidatePath(PATH);
  revalidatePath('/companies');
  redirect(`${PATH}?accepted=1`);
}

export async function rejectCandidate(candidateId: string, formData: FormData) {
  const { supabase, me } = await requireImporter();

  const reason = String(formData.get('note') ?? '').trim().slice(0, 1000);

  await supabase
    .from('import_candidates')
    .update({
      status: 'rejected',
      note: reason || null,
      reviewed_by: me.user_id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', candidateId)
    .in('status', ['pending', 'duplicate']);

  revalidatePath(PATH);
}

// Clearing the tail: weak candidates are still stored for the record, but there is no reason
// to read through them one at a time.
export async function rejectWeakCandidates() {
  const { supabase, me } = await requireImporter();

  const { error } = await supabase
    .from('import_candidates')
    .update({
      status: 'rejected',
      note: 'Below the score bar',
      reviewed_by: me.user_id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('status', 'pending')
    .eq('band', 'weak');
  if (error) fail('Could not clear the weak candidates.');

  revalidatePath(PATH);
  redirect(`${PATH}?cleared=1`);
}
