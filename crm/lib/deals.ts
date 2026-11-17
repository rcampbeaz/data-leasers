// Deal maths. Pure functions, so they can be tested without a database.
// Dates are handled as ISO day strings (YYYY-MM-DD) throughout, on the console's clock.

export const OFFER_STATUSES = ['offered', 'accepted', 'declined', 'withdrawn'] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

export const REFERRAL_STATUSES = [
  'registered',
  'introduced',
  'signed',
  'paid',
  'lapsed',
  'declined',
] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];

export const BUYER_KINDS = ['program', 'lab', 'broker'] as const;
export const DOCUMENT_KINDS = ['rights-file', 'agreement', 'nda', 'export-manifest', 'other'] as const;

// The program publishes a six-month window for the agreement to be signed.
export const REFERRAL_SIGNING_MONTHS = 6;
// The published term for deleting the raw upload after delivery.
export const DELETION_DAYS = 120;

// Adds whole months in UTC, clamping to the last day of a short month
// (January 31 plus one month is February 28, not March 3).
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, lastDay));
  return first.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function deadlineFor(registeredOn: string): string {
  return addMonths(registeredOn, REFERRAL_SIGNING_MONTHS);
}

// The published referral fee: the percentage or the floor, whichever is larger.
export function referralFee(
  amount: number | string | null | undefined,
  rate: number,
  floor: number,
): number | null {
  const value = Number(amount);
  if (amount === null || amount === undefined || amount === '' || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  // Whole cents, rounded once. 0.03 has no exact binary form, so multiplying dollars by the rate and
  // rounding at the end is how a fee on a six-figure licence ends up a cent out. A rate on cents is the
  // same arithmetic with the error below the level being rounded away.
  const byRate = Math.round(Math.round(value * 100) * rate);
  return Math.max(byRate, Math.round(floor * 100)) / 100;
}

export function money(amount: number | string | null | undefined, currency = 'USD'): string {
  if (amount === null || amount === undefined || amount === '') return '-';
  const value = Number(amount);
  if (!Number.isFinite(value)) return '-';
  // Show cents only when the figure has them, so an offer reads $250,000 and a
  // referral fee of $15,000.06 is not quietly rounded to $15,000. The figure is put on whole cents
  // first, so the decision and the printed value come from the same number.
  const cents = Math.round(value * 100);
  const hasCents = cents % 100 !== 0;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  }).format(cents / 100);
}

export function label(value: string): string {
  return value.replace(/-/g, ' ');
}
