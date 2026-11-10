# Security headers

The live site returns no security headers: `Strict-Transport-Security`,
`Content-Security-Policy`, `X-Content-Type-Options`, `Referrer-Policy`,
`Permissions-Policy` and `X-Frame-Options` are all absent from the response.

Cloudflare terminates TLS for `dataleasers.com`, so the headers belong in a
response-header transform rule at the edge. Do not add them to `.htaccess`:
the deploy workflow never touches that file, and an unrunnable directive there
returns a 500 for every page if `AllowOverride` does not permit it.

## Cloudflare: Transform Rules → Modify Response Header

Rule name: `Security headers`
When: custom filter, `http.host in {"dataleasers.com" "www.dataleasers.com"}`
Then: set static, one entry per row:

| Header | Value |
| --- | --- |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `geolocation=(), microphone=(), camera=(), payment=()` |
| `X-Frame-Options` | `SAMEORIGIN` |
| `Content-Security-Policy` | see below |

Add `preload` to HSTS only once every subdomain of the domain is confirmed
HTTPS-only; removing it afterwards takes months.

## Content Security Policy

Ship it as `Content-Security-Policy-Report-Only` first, watch the console for a
week, then rename the header to `Content-Security-Policy`.

```
default-src 'self';
img-src 'self' data:;
style-src 'self' 'unsafe-inline';
script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com;
connect-src 'self' https://cloudflareinsights.com;
frame-ancestors 'self';
base-uri 'self';
form-action 'self' https://app.dataleasers.com
```

`'unsafe-inline'` is required because the fit quiz (`index.html`) and the
contact form (`contact.html`) both use inline `<script>`. Removing it means
moving those scripts into `assets/` and adding a hash or nonce per page. The
`form-action` entry is required because the contact form posts to
`app.dataleasers.com`.

## Verify

```bash
curl -sI https://dataleasers.com/ \
  | grep -iE 'strict-transport|content-security|referrer-policy|x-content-type|permissions-policy|x-frame-options'
curl -sI https://dataleasers.com/assets/site.css | grep -i x-content-type
```

Both should list every header. A `Content-Security-Policy-Report-Only` value is
expected until the policy is enforced.

## Apache alternative

If the headers must be set on the origin instead, the Virtualmin server needs
`mod_headers` enabled and `AllowOverride FileInfo` on the document root, then:

```apache
<IfModule mod_headers.c>
  Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains"
  Header always set X-Content-Type-Options "nosniff"
  Header always set Referrer-Policy "strict-origin-when-cross-origin"
  Header always set Permissions-Policy "geolocation=(), microphone=(), camera=(), payment=()"
  Header always set X-Frame-Options "SAMEORIGIN"
</IfModule>
```

Test one page with `curl -sI` before trusting it across the site, and remove the
block immediately if Apache returns 500.
