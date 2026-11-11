import { NextResponse } from 'next/server';
import { unsubscribeByToken } from '@/lib/unsubscribe';

export const dynamic = 'force-dynamic';

// The URL that goes in the List-Unsubscribe header. It has to answer two very different
// callers: a person clicking the link in the footer, and a mail client performing RFC 8058
// one-click. The GET hands off to the page, which explains what happened.

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token') ?? '';
  const target = new URL('/unsubscribe', url.origin);
  if (token) target.searchParams.set('token', token);
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
