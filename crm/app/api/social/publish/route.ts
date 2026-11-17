import { NextResponse, type NextRequest } from 'next/server';
import { publishDue } from '@/lib/social-publish';

// Publishes every post whose time has come, gives retrying channels their next attempt,
// and emails once when a post ends up failed or partial. Called from the VPS on a short
// schedule, protected by the same shared secret as the reminders job.
//
// This route is excluded from the auth middleware in crm/middleware.ts: it has no
// session, and the bearer secret is its authentication.
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 401 });
  }

  try {
    const report = await publishDue();
    return NextResponse.json(report);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'The run failed.' },
      { status: 500 },
    );
  }
}
