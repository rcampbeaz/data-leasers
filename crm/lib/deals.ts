// Deal maths. Pure functions, so they can be tested without a database.
// Dates are handled as UTC ISO day strings (YYYY-MM-DD) throughout.

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

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

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

// Whole days from one ISO day to another. Negative means the second date is past.
export function daysUntil(iso: string, from = todayIso()): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

export function deadlineFor(registeredOn: string): string {
  return addMonths(registeredOn, REFERRAL_SIGNING_MONTHS);
}

// The published referral fee: the percentage or the floor, whichever is larger.
export function referralFee(amount: number | null, rate: number, floor: number): number | null {
  if (amount === null || !Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(Math.max(amount * rate, floor) * 100) / 100;
}

export function money(amount: number | string | null | undefined, currency = 'USD'): string {
  if (amount === null || amount === undefined || amount === '') return '-';
  const value = Number(amount);
  if (!Number.isFinite(value)) return '-';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

export function label(value: string): string {
  return value.replace(/-/g, ' ');
}
