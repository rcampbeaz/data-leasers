// Deliverability arithmetic. Pure, so the rates and verdicts can be tested without a database.
//
// The counts come from two places and nothing else: outbound_sends for what was sent, and
// suppressions for what came back. A bounce is a suppression with reason 'bounced'; a complaint
// is a suppression with reason 'complaint'. If nobody recorded it, it is not in the report -
// which is why the page says where those rows come from rather than implying the numbers are
// complete.

export type Verdict = 'ok' | 'watch' | 'stop';

// House thresholds. The complaint figure follows the published bulk-sender guidance of staying
// under 0.1%; the bounce figures are the conventional warning band, not a legal limit.
export const COMPLAINT_WATCH = 0.0005;
export const COMPLAINT_STOP = 0.001;
export const BOUNCE_WATCH = 0.02;
export const BOUNCE_STOP = 0.05;

export type SendLike = { status: string; sent_at: string; email: string | null };
export type SuppressionLike = { email: string; reason: string; created_at: string };

// The domain is what a reputation problem is actually attached to, so every figure is also
// kept per recipient domain.
export function domainOf(email: string | null | undefined): string | null {
  const value = (email ?? '').trim().toLowerCase();
  const at = value.lastIndexOf('@');
  if (at < 1) return null;
  const domain = value.slice(at + 1);
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)
    ? domain
    : null;
}

export function monthKeyOf(iso: string): string {
  return String(iso ?? '').slice(0, 7);
}

export function monthLabel(key: string): string {
  const [year, month] = key.split('-').map(Number);
  if (!year || !month) return key;
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

// Oldest first, so a chart reads left to right.
export function recentMonths(count: number, today: Date = new Date()): string[] {
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
}

export function shiftMonth(key: string, delta: number): string {
  const [year, month] = key.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function isMonthKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export type Tally = {
  sent: number;
  bounced: number;
  complained: number;
  unsubscribed: number;
  added: number;
};

export function emptyTally(): Tally {
  return { sent: 0, bounced: 0, complained: 0, unsubscribed: 0, added: 0 };
}

// Null rather than zero when nothing was sent: "no messages" and "no bounces" are different
// facts, and a rate of 0% over an empty month reads as success.
export function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return numerator / denominator;
}

export function verdictFor(t: Tally): Verdict {
  const complaints = rate(t.complained, t.sent);
  const bounces = rate(t.bounced, t.sent);
  if (t.sent === 0) return t.bounced + t.complained > 0 ? 'watch' : 'ok';
  if ((complaints ?? 0) >= COMPLAINT_STOP || (bounces ?? 0) >= BOUNCE_STOP) return 'stop';
  if ((complaints ?? 0) >= COMPLAINT_WATCH || (bounces ?? 0) >= BOUNCE_WATCH) return 'watch';
  return 'ok';
}

function addSuppression(t: Tally, reason: string) {
  t.added += 1;
  if (reason === 'bounced') t.bounced += 1;
  else if (reason === 'complaint') t.complained += 1;
  else if (reason === 'unsubscribed') t.unsubscribed += 1;
}

export type MonthlyRow = Tally & {
  key: string;
  label: string;
  bounceRate: number | null;
  complaintRate: number | null;
  verdict: Verdict;
};

export function monthlyReport(
  sends: SendLike[],
  suppressions: SuppressionLike[],
  months: string[],
): MonthlyRow[] {
  const buckets = new Map<string, Tally>(months.map((m) => [m, emptyTally()]));

  for (const send of sends) {
    if (send.status !== 'sent') continue;
    const bucket = buckets.get(monthKeyOf(send.sent_at));
    if (bucket) bucket.sent += 1;
  }
  for (const row of suppressions) {
    const bucket = buckets.get(monthKeyOf(row.created_at));
    if (bucket) addSuppression(bucket, String(row.reason));
  }

  return months.map((key) => {
    const t = buckets.get(key) ?? emptyTally();
    return {
      ...t,
      key,
      label: monthLabel(key),
      bounceRate: rate(t.bounced, t.sent),
      complaintRate: rate(t.complained, t.sent),
      verdict: verdictFor(t),
    };
  });
}

export type DomainRow = Tally & {
  domain: string;
  bounceRate: number | null;
  complaintRate: number | null;
  verdict: Verdict;
};

// Per domain for one month. Ordered by volume, because a domain that sent four messages is not
// the one that will get the sending domain blocked.
export function domainReport(
  sends: SendLike[],
  suppressions: SuppressionLike[],
  month: string,
): DomainRow[] {
  const buckets = new Map<string, Tally>();

  const bucketFor = (domain: string) => {
    const existing = buckets.get(domain);
    if (existing) return existing;
    const created = emptyTally();
    buckets.set(domain, created);
    return created;
  };

  for (const send of sends) {
    if (send.status !== 'sent') continue;
    if (monthKeyOf(send.sent_at) !== month) continue;
    const domain = domainOf(send.email);
    if (!domain) continue;
    bucketFor(domain).sent += 1;
  }

  for (const row of suppressions) {
    if (monthKeyOf(row.created_at) !== month) continue;
    const domain = domainOf(row.email);
    // An address with no domain is unusable but still a suppression that happened; it is
    // reported under a label rather than dropped, so the month's totals add up.
    const key = domain ?? '(unparsed address)';
    addSuppression(bucketFor(key), String(row.reason));
  }

  return Array.from(buckets.entries())
    .map(([domain, t]) => ({
      ...t,
      domain,
      bounceRate: rate(t.bounced, t.sent),
      complaintRate: rate(t.complained, t.sent),
      verdict: verdictFor(t),
    }))
    .sort((a, b) => b.sent - a.sent || b.added - a.added || a.domain.localeCompare(b.domain));
}

export type TotalRow = Tally & { verdict: Verdict };

// A total carries its own verdict: the sum of the domains and the verdict on that sum are two
// different questions, and the month figure needs the second one.
export function totalOf(rows: Tally[]): TotalRow {
  const sum = rows.reduce<Tally>((acc, row) => {
    acc.sent += row.sent;
    acc.bounced += row.bounced;
    acc.complained += row.complained;
    acc.unsubscribed += row.unsubscribed;
    acc.added += row.added;
    return acc;
  }, emptyTally());
  return { ...sum, verdict: verdictFor(sum) };
}

export function formatRate(value: number | null): string {
  if (value === null) return '—';
  // Two decimals is the resolution that matters at 0.1%: 0.05% and 0.1% must not look alike.
  return `${(value * 100).toFixed(2)}%`;
}
