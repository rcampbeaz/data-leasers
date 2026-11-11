// The weekly partner deadline report. Pure, so the bucketing and the digest can be tested without
// a database or a mail provider.
//
// The six-month window is the commitment the website makes to a partner: a referral registered on
// a date has until that date plus six months for the agreement to be signed. The deadline is
// stored on the row, so a later change to the rule cannot rewrite an existing referral.

export type ReferralInput = {
  id: string;
  company_name: string;
  company_id?: string | null;
  partnerName: string;
  deadline_on: string;
  status: string;
};

export const OPEN_STATUSES = ['registered', 'introduced'];

// Overdue is its own bucket: a referral past its deadline is not "due soon", it is a conversation
// that has to happen now or the introduction is lost.
export type Bucket = 'overdue' | 'week' | 'month' | 'later';

export const BUCKET_LABELS: Record<Bucket, string> = {
  overdue: 'Past the deadline',
  week: 'Inside 7 days',
  month: 'Inside 30 days',
  later: 'Later',
};

function utcDay(value: Date): number {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

function parseDay(iso: string): number | null {
  const trimmed = String(iso ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const time = Date.parse(`${trimmed}T00:00:00Z`);
  return Number.isFinite(time) ? time : null;
}

// Whole days, counted from midnight UTC, so a report run in the morning and one run in the evening
// agree on how long is left.
export function daysLeft(deadline: string, today: Date = new Date()): number | null {
  const due = parseDay(deadline);
  if (due === null) return null;
  return Math.round((due - utcDay(today)) / 86_400_000);
}

export function bucketFor(days: number | null): Bucket {
  if (days === null) return 'later';
  if (days < 0) return 'overdue';
  if (days <= 7) return 'week';
  if (days <= 30) return 'month';
  return 'later';
}

export type ReportRow = ReferralInput & { daysLeft: number | null; bucket: Bucket };

export type PartnerReport = {
  rows: ReportRow[];
  counts: Record<Bucket, number>;
  openTotal: number;
  urgent: number;
  subject: string;
  digest: string;
};

function describe(days: number | null): string {
  if (days === null) return 'no readable deadline';
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`;
  if (days === 0) return 'due today';
  return `${days} day${days === 1 ? '' : 's'} left`;
}

// Only referrals that are still open count. A signed or paid referral has no deadline problem, and
// a lapsed one is already a known loss rather than something to chase this week.
export function buildPartnerReport(
  rows: ReferralInput[],
  opts: { today?: Date } = {},
): PartnerReport {
  const today = opts.today ?? new Date();
  const counts: Record<Bucket, number> = { overdue: 0, week: 0, month: 0, later: 0 };

  const open = rows
    .filter((row) => OPEN_STATUSES.includes(String(row.status)))
    .map<ReportRow>((row) => {
      const remaining = daysLeft(row.deadline_on, today);
      const bucket = bucketFor(remaining);
      counts[bucket] += 1;
      return { ...row, daysLeft: remaining, bucket };
    })
    .sort((a, b) => (a.daysLeft ?? 99999) - (b.daysLeft ?? 99999));

  const urgent = counts.overdue + counts.week;
  const openTotal = open.length;

  const subject =
    openTotal === 0
      ? 'Partner deadlines: nothing open'
      : `Partner deadlines: ${counts.overdue + counts.week + counts.month} inside 30 days of ${openTotal} open`;

  const sections: string[] = [];
  for (const bucket of ['overdue', 'week', 'month', 'later'] as Bucket[]) {
    const inBucket = open.filter((row) => row.bucket === bucket);
    if (inBucket.length === 0) continue;
    sections.push(`${BUCKET_LABELS[bucket]} (${inBucket.length})`);
    for (const row of inBucket) {
      sections.push(
        `- ${row.company_name} · partner ${row.partnerName} · ${row.status} · deadline ${String(row.deadline_on).slice(0, 10)} (${describe(row.daysLeft)})`,
      );
    }
    sections.push('');
  }

  const digest = [
    openTotal === 0
      ? 'No open referrals, so no deadline needs attention this week.'
      : `${openTotal} open referral${openTotal === 1 ? '' : 's'}: ${counts.overdue} overdue, ${counts.week} inside 7 days, ${counts.month} inside 30 days.`,
    '',
    ...sections,
  ]
    .join('\n')
    .trim();

  return { rows: open, counts, openTotal, urgent, subject, digest };
}
