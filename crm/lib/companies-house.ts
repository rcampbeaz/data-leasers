// Scoring, normalising and de-duplicating Companies House search results. Pure functions,
// so the bar a prospect has to clear can be tested without a database or an API key.
//
// The single source of truth for a name key is here. The importer stores the key on each
// candidate and compares it with keys built the same way from the companies already in the
// CRM, so there is one implementation rather than two that can drift.

export type ChAddress = {
  address_line_1?: string;
  address_line_2?: string;
  locality?: string;
  region?: string;
  postal_code?: string;
  country?: string;
};

export type ChCompany = {
  company_name: string;
  company_number: string;
  company_status: string;
  company_type?: string;
  date_of_creation?: string;
  sic_codes?: string[];
  registered_office_address?: ChAddress;
};

export type SicGroup = {
  key: string;
  label: string;
  industry: string;
  codes: string[];
  // The published eligibility floor for this sector, kept for the reviewer to compare
  // against; the register does not carry headcount, so this is never scored automatically.
  minStaff: number;
};

export const SIC_GROUPS: SicGroup[] = [
  {
    key: 'accounting',
    label: 'Accounting, tax and bookkeeping',
    industry: 'Accounting',
    codes: ['69201', '69202', '69203', '69209'],
    minStaff: 10,
  },
  {
    key: 'legal',
    label: 'Solicitors and legal',
    industry: 'Legal',
    codes: ['69101', '69102', '69109'],
    minStaff: 6,
  },
  {
    key: 'medical',
    label: 'Medical and dental practices',
    industry: 'Medical',
    codes: ['86210', '86220', '86230', '86900'],
    minStaff: 10,
  },
  {
    key: 'finance',
    label: 'Financial and insurance advice',
    industry: 'Finance',
    codes: ['64999', '66190', '66220', '66290'],
    minStaff: 10,
  },
];

// Adjacent work: firms that hold client records worth licensing, but are not the core
// sectors the buyer described. Half weight, still worth a look.
const ADJACENT_SIC = ['68320', '70229', '74909', '82990', '85590'];

const CORE_CODES = new Set(SIC_GROUPS.flatMap((g) => g.codes));

export function sicGroupFor(codes: string[] | undefined): SicGroup | null {
  if (!codes?.length) return null;
  for (const group of SIC_GROUPS) {
    if (codes.some((code) => group.codes.includes(String(code)))) return group;
  }
  return null;
}

export function sicCodesFor(groups: string[]): string[] {
  const wanted = new Set(groups);
  return SIC_GROUPS.filter((g) => wanted.has(g.key)).flatMap((g) => g.codes);
}

const SUFFIXES = new Set([
  'ltd', 'limited', 'llp', 'plc', 'inc', 'co', 'company', 'the', 'uk',
  'holdings', 'holding', 'group', 'ventures', 'investments',
]);

// "Rowe & Co (Accountants) Limited" and "ROWE AND CO ACCOUNTANTS LTD" are the same firm.
export function companyNameKey(name: string): string {
  return (name ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((token) => token && !SUFFIXES.has(token))
    .join('');
}

export function companyNumberKey(number: string | null | undefined): string {
  return (number ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// The register stores names as filed, which for older firms is ALL CAPS with the legal form
// attached. A pipeline record should read like a firm's name, so the suffix is dropped and
// all-caps names are title-cased. Anything already mixed case is left exactly as filed,
// because title-casing would break names like McDonald or de la Cruz.
export function displayName(name: string): string {
  const trimmed = (name ?? '').replace(/\s+(LIMITED|LTD|LLP|PLC|CIC)\.?$/i, '').trim();
  if (!trimmed) return (name ?? '').trim();
  const letters = trimmed.replace(/[^A-Za-z]/g, '');
  const allCaps = letters.length > 0 && letters === letters.toUpperCase();
  if (!allCaps) return trimmed;
  return trimmed
    .toLowerCase()
    .replace(/(^|[\s&\-/(])([a-z])/g, (_m, lead: string, letter: string) => `${lead}${letter.toUpperCase()}`);
}

export type ScoreBand = 'strong' | 'review' | 'weak';

export type Scored = {
  score: number;
  band: ScoreBand;
  reasons: string[];
  industry: string | null;
  nameKey: string;
  dedupeKey: string;
};

// The bar: a sector the buyer described, old enough to be owner-managed, a legal form that
// matches a professional firm, and a real registered address. Nothing here needs headcount,
// because the register does not publish it - that stays a job for a person on the call.
export function scoreCompany(item: ChCompany, opts: { today?: Date } = {}): Scored {
  const today = opts.today ?? new Date();
  const reasons: string[] = [];
  const codes = (item.sic_codes ?? []).map(String);
  let score = 0;

  const group = sicGroupFor(codes);
  if (group) {
    score += 40;
    reasons.push(`${group.label} (SIC ${codes.filter((c) => group.codes.includes(c)).join(', ')})`);
  } else if (codes.some((c) => ADJACENT_SIC.includes(c))) {
    score += 15;
    reasons.push('Adjacent professional services, not a core sector');
  } else {
    reasons.push('SIC code is outside the target sectors');
  }

  const created = item.date_of_creation ? new Date(item.date_of_creation) : null;
  const years = created ? Math.floor((today.getTime() - created.getTime()) / (365.25 * 24 * 3600 * 1000)) : null;
  if (years === null) {
    reasons.push('No incorporation date');
  } else if (years >= 15) {
    score += 25;
    reasons.push(`Incorporated ${created!.getUTCFullYear()} (${years} years)`);
  } else if (years >= 10) {
    score += 20;
    reasons.push(`Incorporated ${created!.getUTCFullYear()} (${years} years)`);
  } else if (years >= 5) {
    score += 12;
    reasons.push(`Incorporated ${created!.getUTCFullYear()} (${years} years)`);
  } else {
    score += 5;
    reasons.push(`Recent incorporation (${years} years)`);
  }

  const type = String(item.company_type ?? '');
  if (type.includes('llp') || type.includes('partnership')) {
    score += 10;
    reasons.push('Partnership or LLP, the usual form for a professional firm');
  } else if (type === 'ltd' || type === 'plc') {
    score += 8;
    reasons.push('Limited company');
  } else {
    score += 3;
    reasons.push(`Company type ${type || 'unknown'}`);
  }

  if (String(item.company_status).toLowerCase() === 'active') {
    score += 10;
  } else {
    reasons.push(`Status is ${item.company_status}`);
  }

  const address = item.registered_office_address ?? {};
  if (address.postal_code || address.locality) {
    score += 5;
  } else {
    reasons.push('No usable registered address');
  }

  // A parent or a roll-up is a different conversation: it is usually already advised, and
  // the owner who decides is not in the building.
  if (/\b(holdings?|group|ventures|investments|capital|partners holdings)\b/i.test(item.company_name)) {
    score -= 15;
    reasons.push('Name suggests a holding company or group');
  }

  const bounded = Math.max(0, Math.min(100, score));
  const band: ScoreBand = bounded >= 70 ? 'strong' : bounded >= 45 ? 'review' : 'weak';

  return {
    score: bounded,
    band,
    reasons,
    industry: group?.industry ?? null,
    nameKey: companyNameKey(item.company_name),
    dedupeKey: `ch:${companyNumberKey(item.company_number)}`,
  };
}

// ---- duplicate detection --------------------------------------------------

export type ExistingCompany = {
  id: string;
  name: string;
  registration_number: string | null;
  website: string | null;
};

export type DuplicateMatch =
  | { kind: 'registration_number'; companyId: string; companyName: string }
  | { kind: 'name'; companyId: string; companyName: string }
  | null;

// Registration number first, then the normalised name. A firm already in the CRM must not
// arrive a second time just because a newer search found it under a slightly different name.
export function findDuplicate(
  candidate: { nameKey: string; registrationNumber: string | null },
  existing: ExistingCompany[],
): DuplicateMatch {
  const number = companyNumberKey(candidate.registrationNumber);
  if (number) {
    const byNumber = existing.find((c) => companyNumberKey(c.registration_number) === number);
    if (byNumber) {
      return { kind: 'registration_number', companyId: byNumber.id, companyName: byNumber.name };
    }
  }
  if (candidate.nameKey.length >= 4) {
    const byName = existing.find((c) => companyNameKey(c.name) === candidate.nameKey);
    if (byName) return { kind: 'name', companyId: byName.id, companyName: byName.name };
  }
  return null;
}

// ---- the search request ---------------------------------------------------

export type SearchInput = {
  groups: string[];
  incorporatedTo?: string; // YYYY-MM-DD
  location?: string;
};

// Advanced search, as documented by Companies House: sic_codes takes a comma-delimited
// list, company_status filters status, incorporated_to bounds the age, location is free
// text. One page of results is requested; `hits` reports how many matched in total.
export function buildSearchQuery(input: SearchInput): URLSearchParams {
  const params = new URLSearchParams();
  const codes = sicCodesFor(input.groups);
  if (codes.length) params.set('sic_codes', codes.join(','));
  params.set('company_status', 'active');
  if (input.incorporatedTo) params.set('incorporated_to', input.incorporatedTo);
  if (input.location) params.set('location', input.location.trim());
  params.set('size', '100');
  return params;
}

export function isChCompany(value: unknown): value is ChCompany {
  const row = value as Partial<ChCompany> | null;
  return Boolean(row && typeof row.company_name === 'string' && typeof row.company_number === 'string');
}
