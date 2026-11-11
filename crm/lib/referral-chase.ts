// Planning the chase tasks for a referral that is running out of time. Pure, so the boundary
// cases can be tested without a database.
//
// Two chases, not one: the first at 30 days while there is still time to negotiate, and an
// escalation at 7 days when the window is about to close. They are separate tasks with separate
// links, so completing one does not silently complete the other.

import { OPEN_STATUSES, daysLeft } from './partner-report';

export const CHASE_WINDOW_DAYS = 30;
export const ESCALATION_WINDOW_DAYS = 7;

export type ChaseKind = 'first' | 'escalation';

export type ReferralRow = {
  id: string;
  company_id: string | null;
  company_name: string;
  deadline_on: string;
  status: string;
  chase_task_id: string | null;
  escalation_task_id: string | null;
  owner_id?: string | null;
};

export type ChasePlan = {
  referralId: string;
  companyId: string;
  companyName: string;
  kind: ChaseKind;
  title: string;
  dueOn: string;
  daysLeft: number;
  assignedTo: string | null;
};

export type ChaseSkip = {
  referralId: string;
  companyName: string;
  kind?: ChaseKind;
  reason: string;
};

function phrase(days: number): string {
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`;
  if (days === 0) return 'due today';
  return `${days} day${days === 1 ? '' : 's'} left`;
}

export function chaseTitle(companyName: string, days: number, deadline: string): string {
  return `Referral deadline: ${companyName} — ${phrase(days)} (${String(deadline).slice(0, 10)})`.slice(0, 195);
}

// A different opening so the two tasks are distinguishable in a list that is sorted by due date,
// where both may be due today if the sweep first sees the referral late.
export function escalationTitle(companyName: string, days: number, deadline: string): string {
  return `Referral closing: ${companyName} — ${phrase(days)} (${String(deadline).slice(0, 10)})`.slice(0, 195);
}

function isoDay(value: Date): string {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

// One plan per referral per window, and a reason for every task deliberately not created, so the
// sweep's response says what it did rather than just how many rows it touched.
export function planChaseTasks(
  rows: ReferralRow[],
  opts: { today?: Date } = {},
): { create: ChasePlan[]; skipped: ChaseSkip[] } {
  const today = opts.today ?? new Date();
  const dueOn = isoDay(today);
  const create: ChasePlan[] = [];
  const skipped: ChaseSkip[] = [];

  for (const row of rows) {
    const skip = (reason: string, kind?: ChaseKind) =>
      skipped.push({ referralId: row.id, companyName: row.company_name, kind, reason });

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

    const days = daysLeft(row.deadline_on, today);
    if (days === null) {
      skip('Deadline is not a readable date');
      continue;
    }
    if (days > CHASE_WINDOW_DAYS) {
      continue; // Outside both windows; nothing to say about it.
    }

    const base = {
      referralId: row.id,
      companyId: row.company_id,
      companyName: row.company_name,
      dueOn,
      daysLeft: days,
      assignedTo: row.owner_id ?? null,
    };

    if (days <= ESCALATION_WINDOW_DAYS) {
      if (row.escalation_task_id) {
        skip('Already has an escalation task', 'escalation');
      } else {
        create.push({
          ...base,
          kind: 'escalation',
          title: escalationTitle(row.company_name, days, row.deadline_on),
        });
      }
      // The escalation supersedes the routine chase: raising two tasks in the same hour for one
      // referral is how a task list stops being read.
      skip(
        row.escalation_task_id ? 'Already has a chase task' : 'Escalation task covers this referral',
        'first',
      );
      continue;
    }

    if (row.chase_task_id) {
      skip('Already has a chase task', 'first');
    } else {
      create.push({
        ...base,
        kind: 'first',
        title: chaseTitle(row.company_name, days, row.deadline_on),
      });
    }
  }

  // Most urgent first, so a partial run leaves the worst cases covered.
  create.sort((a, b) => a.daysLeft - b.daysLeft || (a.kind === b.kind ? 0 : a.kind === 'escalation' ? -1 : 1));
  return { create, skipped };
}
