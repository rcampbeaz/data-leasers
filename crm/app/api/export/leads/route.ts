import { NextResponse } from 'next/server';
import { createStaffClient } from '@/lib/supabase';
import { currentStaff } from '@/lib/data';
import { toCsv } from '@/lib/csv';

// CSV export of leads with their pipeline stage. Admins and introducers only.
export async function GET() {
  const supabase = await createStaffClient();
  const me = await currentStaff(supabase);
  if (!me || !['admin', 'introducer'].includes(me.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data, error } = await supabase
    .from('leads')
    .select('created_at, name, email, company, role_title, data_note, source_page, companies(stage)')
    .order('created_at', { ascending: false })
    .limit(5000);
  if (error) return NextResponse.json({ error: 'Could not load leads' }, { status: 500 });

  const rows = (data ?? []).map((l) => {
    const company = (l.companies as unknown as { stage: string }[] | null)?.[0];
    return [
      l.created_at,
      l.name,
      l.email,
      l.company,
      l.role_title,
      l.data_note,
      l.source_page,
      company?.stage ?? 'New lead',
    ];
  });

  const body = toCsv(['received', 'name', 'email', 'company', 'role', 'note', 'source', 'stage'], rows);
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="leads-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
