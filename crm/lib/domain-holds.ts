// Deciding which recipient domains the sweep should hold. Pure, so the threshold behaviour can be
// tested without a database.
//
// A hold is not a suppression. A suppression is a dead address; a hold is a domain that is
// currently unsafe to mail, whose contacts stay in the pipeline and resume when it is released.

import {
  COMPLAINT_STOP,
  domainOf,
  rate,
  type SendLike,
  type SuppressionLike,
} from './deliverability';

export const HOLD_WINDOW_DAYS = 30;

// One complaint in a handful of sends is noise, and auto-pausing on it would strand small
// domains that were never a problem. Below this volume the deliverability report still shows the
// rate as a watch item, and a person decides.
export const HOLD_MIN_SENDS = 50;

// After a person releases a domain, the sweep leaves it alone for this long even if the rate is
// still over the line. Otherwise the release would be undone within the hour.
export const RELEASE_COOLDOWN_DAYS = 7;

export type DomainRate = {
  domain: string;
  sent: number;
  complained: number;
  bounced: number;
  complaintRate: number | null;
};

// A rolling window, because reputation is not a calendar month: complaints from 31 days ago are
// no longer part of the signal.
export function ratesInWindow(
  sends: SendLike[],
  suppressions: SuppressionLike[],
  sinceMs: number,
): DomainRate[] {
  const buckets = new Map<string, { sent: number; complained: number; bounced: number }>();

  const bucketFor = (domain: string) => {
    const existing = buckets.get(domain);
    if (existing) return existing;
    const created = { sent: 0, complained: 0, bounced: 0 };
    buckets.set(domain, created);
    return created;
  };

  for (const send of sends) {
    if (send.status !== 'sent') continue;
    if (new Date(send.sent_at).getTime() < sinceMs) continue;
    const domain = domainOf(send.email);
    if (!domain) continue;
    bucketFor(domain).sent += 1;
  }

  for (const row of suppressions) {
    if (new Date(row.created_at).getTime() < sinceMs) continue;
    if (row.reason !== 'complained' && row.reason !== 'complaint' && row.reason !== 'bounced') continue;
    const domain = domainOf(row.email);
    if (!domain) continue;
    const bucket = bucketFor(domain);
    if (row.reason === 'bounced') bucket.bounced += 1;
    else bucket.complained += 1;
  }

  return Array.from(buckets.entries())
    .map(([domain, b]) => ({
      domain,
      sent: b.sent,
      complained: b.complained,
      bounced: b.bounced,
      complaintRate: rate(b.complained, b.sent),
    }))
    .sort((a, b) => b.sent - a.sent || a.domain.localeCompare(b.domain));
}

export type ExistingHold = { domain: string; released_at: string | null };

export type HoldDecision = {
  domain: string;
  sent: number;
  complained: number;
  complaintRate: number | null;
  hold: boolean;
  reason: string;
};

// The rule, in one place: over the threshold, enough volume to trust it, not already held, and
// not released recently.
export function decideHolds(
  rates: DomainRate[],
  existing: ExistingHold[],
  opts: { now?: number } = {},
): HoldDecision[] {
  const now = opts.now ?? Date.now();
  const byDomain = new Map(existing.map((hold) => [hold.domain.toLowerCase(), hold]));
  const cooldownMs = RELEASE_COOLDOWN_DAYS * 24 * 3600 * 1000;

  return rates.map((row) => {
    const current = byDomain.get(row.domain);
    const base = {
      domain: row.domain,
      sent: row.sent,
      complained: row.complained,
      complaintRate: row.complaintRate,
    };

    if (row.complained === 0 || row.complaintRate === null) {
      return { ...base, hold: false, reason: 'No complaints in the window' };
    }
    if (row.complaintRate < COMPLAINT_STOP) {
      return { ...base, hold: false, reason: 'Below the stop threshold' };
    }
    if (row.sent < HOLD_MIN_SENDS) {
      return {
        ...base,
        hold: false,
        reason: `Over the threshold but only ${row.sent} sends in the window; a person decides`,
      };
    }
    if (current && current.released_at === null) {
      return { ...base, hold: false, reason: 'Already held' };
    }
    if (current && current.released_at) {
      const released = new Date(current.released_at).getTime();
      if (now - released < cooldownMs) {
        return { ...base, hold: false, reason: 'Released recently; leaving it alone' };
      }
    }

    return {
      ...base,
      hold: true,
      reason: `Complaint rate ${(row.complaintRate * 100).toFixed(2)}% over ${HOLD_WINDOW_DAYS} days (${row.complained} of ${row.sent}). Sending paused for this domain.`,
    };
  });
}
