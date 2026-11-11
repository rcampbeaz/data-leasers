import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

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

  const redirect = (to: string) => NextResponse.redirect(new URL(to, request.url));

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 1. Signed out
  if (!user) {
    return path.startsWith('/login') ? response : redirect('/login');
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
  // the sign-in screen: the website intake, the reminder job, the inbound email hook
  // and the social publisher, which cron calls with CRON_SECRET and which answers 401.
  matcher: [
    '/((?!api/leads|api/reminders|api/inbound|api/social|_next/static|_next/image|favicon.ico|logo.*\\.svg|icon\\.svg).*)',
  ],
};
