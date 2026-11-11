// Planning the chase task for a referral that is running out of time. Pure, so the boundary
// cases can be tested without a database.

import { OPEN_STATUSES, daysLeft } from './partner-report';

export const CHASE_WINDOW_DAYS = 30;

export type ReferralRow = {
  id: string;
  company_id: string | null;
  company_name: string;
  deadline_on: string;
  status: string;
  chase_task_id: string | null;
  owner_id?: string | null;
};

export type ChasePlan = {
  referralId: string;
  companyId: string;
  companyName: string;
  title: string;
  dueOn: string;
  daysLeft: number;
  assignedTo: string | null;
};

export type ChaseSkip = { referralId: string; companyName: string; reason: string };

export function chaseTitle(companyName: string, days: number, deadline: string): string {
  const when =
    days < 0
      ? `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`
      : days === 0
        ? 'due today'
        : `${days} day${days === 1 ? '' : 's'} left`;
  return `Referral deadline: ${companyName} — ${when} (${String(deadline).slice(0, 10)})`.slice(0, 195);
}

function isoDay(value: Date): string {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

// One plan per referral, and a reason for every referral left alone, so the sweep's response says
// what it did rather than just how many rows it touched.
export function planChaseTasks(
  rows: ReferralRow[],
  opts: { today?: Date } = {},
): { create: ChasePlan[]; skipped: ChaseSkip[] } {
  const today = opts.today ?? new Date();
  const dueOn = isoDay(today);
  const create: ChasePlan[] = [];
  const skipped: ChaseSkip[] = [];

  for (const row of rows) {
    const skip = (reason: string) =>
      skipped.push({ referralId: row.id, companyName: row.company_name, reason });

    if (!OPEN_STATUSES.includes(String(row.status))) {
      skip(`Status is ${row.status}`);
      continue;
    }
    // tasks.company_id is required, so a referral that is not linked to a company record cannot
    // carry a task. It is reported rather than dropped, because it needs linking by hand.
    if (!row.company_id) {
      skip('Not linked to a company record, so a task cannot be attached');
      continue;
    }
    if (row.chase_task_id) {
      skip('Already has a chase task');
      continue;
    }

    const days = daysLeft(row.deadline_on, today);
    if (days === null) {
      skip('Deadline is not a readable date');
      continue;
    }
    if (days > CHASE_WINDOW_DAYS) {
      skip(`Outside the ${CHASE_WINDOW_DAYS}-day window`);
      continue;
    }

    create.push({
      referralId: row.id,
      companyId: row.company_id,
      companyName: row.company_name,
      title: chaseTitle(row.company_name, days, row.deadline_on),
      dueOn,
      daysLeft: days,
      assignedTo: row.owner_id ?? null,
    });
  }

  // Most urgent first, so a partial run leaves the worst cases covered.
  create.sort((a, b) => a.daysLeft - b.daysLeft);
  return { create, skipped };
}
