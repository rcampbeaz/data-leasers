import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { originFromHeaders } from '@/lib/origin';

// Magic-link and recovery return: exchanges the one-time code for a session cookie.
//
// Two things here are load-bearing:
//   1. The redirect is built from the public origin, not request.url (which is localhost behind the
//      proxy).
//   2. Session cookies are copied onto the response we actually return. Setting them through
//      cookies() only is not enough for a hand-built NextResponse, and losing them is what turned a
//      valid recovery link into a loop: the code exchanged, no session arrived, and the page asked
//      for the address again.
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const cookieStore = await cookies();
  const origin = originFromHeaders(request.headers, request.url);

  if (!code) {
    return NextResponse.redirect(`${origin}/login?failed=1&code=no_code`);
  }

  // Collected so they can be set on the response explicitly.
  const pending: { name: string; value: string; options: CookieOptions }[] = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach((cookie) => {
            pending.push(cookie);
            try {
              cookieStore.set(cookie.name, cookie.value, cookie.options);
            } catch {
              // The explicit copy below is what matters.
            }
          });
        },
      },
    },
  );

  // A recovery link and a sign-in link share this callback, so the intent comes from a short-lived
  // cookie set when the link was requested. A query parameter would have to survive Supabase
  // appending its own `code` to the redirect address, which is not worth depending on.
  const isRecovery = cookieStore.get('dl-recovery')?.value === '1';
  const nextParam = request.nextUrl.searchParams.get('next');
  const safeNext =
    nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : null;
  const destination = isRecovery ? '/reset' : (safeNext ?? '/dashboard');

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    // Say why. A generic failure here is what made this look like a loop rather than a bad link.
    const reason =
      error.code === 'pkce_code_verifier_not_found'
        ? 'That link was opened in a different browser from the one that requested it. Request a new link and open it in the same browser.'
        : 'That link has expired or has already been used. Request a new one.';
    return NextResponse.redirect(`${origin}/reset?error=${encodeURIComponent(reason)}`);
  }

  const response = NextResponse.redirect(new URL(destination, origin));
  for (const cookie of pending) {
    response.cookies.set(cookie.name, cookie.value, cookie.options);
  }
  response.cookies.delete('dl-recovery');
  return response;
}
