import { NextResponse } from 'next/server';
import { unsubscribeByToken } from '@/lib/unsubscribe';
import { unsubscribeUrl } from '@/lib/outbound';

// Behind the reverse proxy `request.url` carries the internal origin (localhost:3000), so a
// redirect built from it sends a real recipient nowhere. The public origin is configuration.
function publicOrigin(): string {
  return process.env.CRM_ORIGIN ?? 'https://app.dataleasers.com';
}

export const dynamic = 'force-dynamic';

// The URL that goes in the List-Unsubscribe header. It has to answer two very different
// callers: a person clicking the link in the footer, and a mail client performing RFC 8058
// one-click. The GET hands off to the page, which explains what happened.

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token') ?? '';
  const target = token ? unsubscribeUrl(token) : `${publicOrigin()}/unsubscribe`;
  return NextResponse.redirect(target, 302);
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  let token = url.searchParams.get('token');

  // Some clients put the token in the body instead of the query. The expected body is
  // `List-Unsubscribe=One-Click`, so the token is read from either place and nothing else is
  // required: no session, no CSRF token, no HTML in the answer.
  if (!token) {
    const body = await request.text().catch(() => '');
    token = new URLSearchParams(body).get('token');
  }

  const outcome = await unsubscribeByToken(token);

  return new NextResponse(outcome.ok ? 'unsubscribed' : 'invalid token', {
    status: outcome.ok ? 200 : 400,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
