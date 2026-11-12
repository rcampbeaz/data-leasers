// The address a browser should be sent to, decided in one place.
//
// Behind the reverse proxy the request carries the internal address (localhost:3000), so a redirect
// built from request.url sends the browser to a host that only exists on the server. Signing in then
// looks broken at the very last step, after the credential has already been accepted.
//
// Order matters: an explicit CRM_ORIGIN wins, then the proxy's forwarded host and protocol, then the
// Host header, and the request URL only as a last resort. Values are treated as untrusted: anything
// that is not a plain host is ignored rather than echoed into a redirect.

export type OriginInput = {
  configured?: string | null;
  forwardedHost?: string | null;
  forwardedProto?: string | null;
  host?: string | null;
  fallbackUrl?: string | null;
};

// Hostnames only: letters, digits, dots, hyphens, an optional port. No slashes, no userinfo, no CRLF,
// so a forged header cannot turn a redirect into a different origin or a header injection.
const HOST = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/i;

function firstValue(value: string | null | undefined): string {
  return (value ?? '').split(',')[0]?.trim() ?? '';
}

function cleanHost(value: string | null | undefined): string | null {
  const host = firstValue(value);
  return host && HOST.test(host) ? host.toLowerCase() : null;
}

function cleanProto(value: string | null | undefined): 'http' | 'https' | null {
  const proto = firstValue(value).toLowerCase();
  if (proto === 'http' || proto === 'https') return proto;
  return null;
}

function fromUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

// localhost is the only place http is expected; anywhere else, plain http would drop the session
// cookie's Secure flag and sign people out on every request.
function protoFor(host: string): 'http' | 'https' {
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host) ? 'http' : 'https';
}

export function resolveOrigin(input: OriginInput): string {
  const configured = (input.configured ?? '').trim().replace(/\/+$/, '');
  if (configured) {
    const parsed = fromUrl(configured);
    if (parsed) return parsed;
  }

  const forwardedHost = cleanHost(input.forwardedHost);
  if (forwardedHost) {
    // A proxy that rewrites Host but not the protocol is common; https is the safer assumption for a
    // public host and the only one that keeps the cookie.
    const proto = cleanProto(input.forwardedProto) ?? protoFor(forwardedHost);
    return `${proto}://${forwardedHost}`;
  }

  const host = cleanHost(input.host);
  if (host) return `${protoFor(host)}://${host}`;

  return fromUrl(input.fallbackUrl) ?? 'https://app.dataleasers.com';
}

// The same decision, from a Headers object (route handlers and server actions both have one).
export function originFromHeaders(headers: Headers, requestUrl?: string): string {
  return resolveOrigin({
    configured: process.env.CRM_ORIGIN,
    forwardedHost: headers.get('x-forwarded-host'),
    forwardedProto: headers.get('x-forwarded-proto'),
    host: headers.get('host'),
    fallbackUrl: requestUrl,
  });
}

// An absolute URL on the public origin, for redirects and links in email.
export function publicUrl(path: string, headers: Headers, requestUrl?: string): string {
  const origin = originFromHeaders(headers, requestUrl);
  return `${origin}${path.startsWith('/') ? path : `/${path}`}`;
}
