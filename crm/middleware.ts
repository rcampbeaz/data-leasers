import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { originFromHeaders } from '@/lib/origin';

// Rules, in order:
// 1. Signed out: only /login and /auth/* are reachable.
// 2. Signed in without two-factor (aal2): only /mfa is reachable.
// 3. Signed in with two-factor but not on the staff list: /no-access only.
// 4. Staff with two-factor: the CRM.

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // The magic-link return must run its own code exchange.
  if (path.startsWith('/auth/')) {
    return NextResponse.next({ request });
  }

  // Static files pass straight through. Gating them meant a signed-out sign-in page had no logo and
  // no fonts, and the browser got a 307 instead of a .woff2. The list is explicit rather than a
  // catch-all extension check, so nothing new becomes public without being named here.
  if (
    path.startsWith('/fonts/') ||
    path === '/logo.svg' ||
    path === '/logo-reversed.svg' ||
    path === '/icon.svg' ||
    path === '/favicon.ico'
  ) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Resolved from the forwarded headers: request.url is the internal localhost address behind the
  // proxy, and redirecting a browser there breaks sign-in at the last step.
  const redirect = (to: string) =>
    NextResponse.redirect(new URL(to, originFromHeaders(request.headers, request.url)));

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 1. Signed out. /reset is reachable because its first job is to ask for an address and send a
  // recovery link - an account that cannot sign in still needs that page.
  if (!user) {
    return path.startsWith('/login') || path.startsWith('/reset') ? response : redirect('/login');
  }

  // 2. Two-factor, when MFA_REQUIRED is on. It stays off by default so an account
  // that has not enrolled yet cannot lock itself out of the CRM.
  if (process.env.MFA_REQUIRED === 'true' && !path.startsWith('/mfa')) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel !== 'aal2') return redirect('/mfa');
  }

  // Signed in: keep them off the sign-in screen
  if (path.startsWith('/login')) {
    return redirect('/dashboard');
  }

  // 3. Must be on the staff list
  if (path.startsWith('/no-access')) {
    return response;
  }
  const { data: staff } = await supabase
    .from('crm_staff')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!staff) {
    return redirect('/no-access');
  }

  return response;
}

export const config = {
  // Routes that authenticate themselves with their own secret and must not be sent to
  // the sign-in screen: the website intake, the reminder job, the inbound email hook,
  // the social publisher and the outbound sender (cron, CRON_SECRET, answers 401).
  // The unsubscribe page and its one-click POST are public by design: they are the opt-out
  // the law requires, and a mail client posting to them has no session to offer.
  // The provider webhook authenticates itself with a signed request, so it cannot be sent
  // to the sign-in screen either. The partner report is a cron job with CRON_SECRET, and a
  // redirect to /login would have looked like a working schedule while sending nothing.
  matcher: [
    '/((?!api/leads|api/reminders|api/inbound|api/social|api/outbound|api/partners|api/unsubscribe|api/webhooks|unsubscribe|_next/static|_next/image|favicon.ico|logo.*\\.svg|icon\\.svg).*)',
  ],
};
