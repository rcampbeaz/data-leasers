import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { originFromHeaders } from '@/lib/origin';

// Magic-link return: exchanges the one-time code for a session cookie.
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const cookieStore = await cookies();
  // Behind the proxy, request.url is localhost:3000. Redirecting to it is what made a correct
  // password look like a broken sign-in, so the public origin is resolved from the forwarded headers.
  const origin = originFromHeaders(request.headers, request.url);

  if (code) {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          },
        },
      },
    );
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      // A link that has expired or been used twice lands here. Say so on the sign-in page instead of
      // dropping the person on a dashboard they cannot see.
      return NextResponse.redirect(
        `${origin}/login?failed=1&code=${encodeURIComponent(error.code ?? 'link_failed')}`,
      );
    }
  }

  return NextResponse.redirect(new URL('/dashboard', origin));
}
