import { NextResponse } from 'next/server';
import { createIntakeClient } from '@/lib/supabase';
import { domainOf } from '@/lib/deliverability';
import { HOLD_WINDOW_DAYS, decideHolds, ratesInWindow, type ExistingHold } from '@/lib/domain-holds';

export const dynamic = 'force-dynamic';

// The hourly deliverability sweep. It reads the last 30 days of sends and complaints per domain
// and writes a hold for any domain over the stop threshold with enough volume to trust. The
// sender checks those holds before every message, so a hold takes effect on the next batch rather
// than after the queue drains.

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 500 });

  const header = request.headers.get('authorization') ?? '';
  const given = header.replace(/^Bearer\s+/i, '') || request.headers.get('x-cron-secret') || '';
  if (given !== secret) return NextResponse.json({ error: 'unauthorised' }, { status: 401 });

  const admin = createIntakeClient();
  const sinceMs = Date.now() - HOLD_WINDOW_DAYS * 24 * 3600 * 1000;
  const since = new Date(sinceMs).toISOString();

  const [{ data: sendData, error: sendError }, { data: suppressionData, error: suppressionError }, { data: holdData }] =
    await Promise.all([
      admin
        .from('outbound_sends')
        .select('status, sent_at, contact:outreach_contacts(email)')
        .gte('sent_at', since)
        .limit(10_000),
      admin
        .from('suppressions')
        .select('email, reason, created_at')
        .gte('created_at', since)
        .limit(10_000),
      admin.from('domain_holds').select('domain, released_at'),
    ]);

  if (sendError || suppressionError) {
    return NextResponse.json({ error: sendError?.message ?? suppressionError?.message }, { status: 500 });
  }

  const sends = ((sendData ?? []) as unknown as {
    status: string;
    sent_at: string;
    contact: { email?: string } | { email?: string }[] | null;
  }[]).map((row) => {
    const contact = Array.isArray(row.contact) ? row.contact[0] : row.contact;
    return { status: row.status, sent_at: row.sent_at, email: contact?.email ?? null };
  });

  const suppressions = (suppressionData ?? []) as unknown as {
    email: string;
    reason: string;
    created_at: string;
  }[];

  const rates = ratesInWindow(sends, suppressions, sinceMs);
  const decisions = decideHolds(rates, (holdData ?? []) as ExistingHold[]);
  const toHold = decisions.filter((d) => d.hold);

  const held: string[] = [];
  for (const decision of toHold) {
    const { error } = await admin.from('domain_holds').upsert(
      {
        domain: decision.domain,
        reason: decision.reason,
        sent: decision.sent,
        complained: decision.complained,
        complaint_rate: decision.complaintRate,
        window_days: HOLD_WINDOW_DAYS,
        created_at: new Date().toISOString(),
        released_at: null,
        released_by: null,
      },
      { onConflict: 'domain' },
    );
    if (!error) held.push(decision.domain);
  }

  // Domains with a complaint but too little volume to hold are reported, so a person sees the
  // signal the sweep deliberately did not act on.
  const nearMisses = decisions
    .filter((d) => !d.hold && d.complained > 0 && d.complaintRate !== null && d.complaintRate >= 0.001)
    .map((d) => ({ domain: d.domain, sent: d.sent, complained: d.complained, reason: d.reason }));

  return NextResponse.json({
    window_days: HOLD_WINDOW_DAYS,
    domains_evaluated: rates.length,
    held,
    near_misses: nearMisses,
    checked_at: new Date().toISOString(),
  });
}

// A GET is a readout for a person with the cron secret, not a second way to trigger the sweep.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 500 });
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  const admin = createIntakeClient();
  const [{ data: holds }, { data: sends }] = await Promise.all([
    admin
      .from('domain_holds')
      .select('domain, reason, sent, complained, complaint_rate, created_at')
      .is('released_at', null)
      .order('created_at', { ascending: false }),
    admin.from('outbound_sends').select('status, sent_at, contact:outreach_contacts(email)').limit(5000),
  ]);

  const domains = new Set<string>();
  for (const row of (sends ?? []) as unknown as { contact: { email?: string } | { email?: string }[] | null }[]) {
    const contact = Array.isArray(row.contact) ? row.contact[0] : row.contact;
    const domain = domainOf(contact?.email ?? null);
    if (domain) domains.add(domain);
  }

  return NextResponse.json({ held: holds ?? [], domains_seen: domains.size });
}
