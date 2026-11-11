import { NextResponse } from 'next/server';
import { createIntakeClient } from '@/lib/supabase';
import { buildPartnerReport, type ReferralInput } from '@/lib/partner-report';

export const dynamic = 'force-dynamic';

// The weekly partner deadline report. Mondays, by cron with CRON_SECRET. It reads the open
// referrals, buckets them by how long is left on the six-month window, and emails the digest to
// admins and introducers. Nobody has to remember to look at the Partners page.

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 500 });

  const header = request.headers.get('authorization') ?? '';
  const given = header.replace(/^Bearer\s+/i, '') || request.headers.get('x-cron-secret') || '';
  if (given !== secret) return NextResponse.json({ error: 'unauthorised' }, { status: 401 });

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.REMINDER_FROM_EMAIL;
  if (!apiKey || !from) {
    return NextResponse.json({ error: 'Email is not configured' }, { status: 500 });
  }

  const supabase = createIntakeClient();

  const [{ data: referralData, error: referralError }, { data: partnerData }] = await Promise.all([
    supabase
      .from('referrals')
      .select('id, partner_id, company_id, company_name, registered_on, deadline_on, status')
      .in('status', ['registered', 'introduced'])
      .order('deadline_on'),
    supabase.from('partners').select('id, name'),
  ]);
  if (referralError) {
    return NextResponse.json({ error: 'Could not read referrals' }, { status: 500 });
  }

  const names = new Map(
    ((partnerData ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]),
  );

  const rows: ReferralInput[] = ((referralData ?? []) as unknown as {
    id: string;
    partner_id: string;
    company_id: string | null;
    company_name: string;
    deadline_on: string;
    status: string;
  }[]).map((row) => ({
    id: row.id,
    company_id: row.company_id,
    company_name: row.company_name,
    partnerName: names.get(row.partner_id) ?? 'Unknown partner',
    deadline_on: row.deadline_on,
    status: row.status,
  }));

  const report = buildPartnerReport(rows);

  // Nothing open means nothing worth an email. The next run starts again from scratch.
  if (report.openTotal === 0) {
    return NextResponse.json({ skipped: 'no open referrals', open: 0 });
  }

  const { data: staff } = await supabase
    .from('crm_staff')
    .select('user_id, role')
    .in('role', ['admin', 'introducer']);

  const addresses: string[] = [];
  for (const member of (staff ?? []) as { user_id: string }[]) {
    const { data } = await supabase.auth.admin.getUserById(member.user_id);
    const email = data.user?.email;
    if (email) addresses.push(email);
  }
  if (addresses.length === 0) {
    return NextResponse.json({ error: 'No staff email addresses' }, { status: 500 });
  }

  const origin = process.env.CRM_ORIGIN ?? 'https://app.dataleasers.com';
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: addresses,
      subject: report.subject,
      text: `${report.digest}\n\nOpen the referral ledger: ${origin}/partners`,
    }),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    return NextResponse.json({ error: 'Could not send the report', detail }, { status: 502 });
  }

  return NextResponse.json({
    sent: addresses.length,
    open: report.openTotal,
    counts: report.counts,
  });
}
