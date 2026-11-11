#!/usr/bin/env node
// Route audit. Fails if a route that authenticates itself is left behind the sign-in middleware.
//
// Why this exists: the middleware redirects anything not excluded to /login. For a route called by
// cron or by a provider, that redirect looks like a working schedule - a 307, no error - and the job
// silently does nothing. It has already happened twice (the partner report, and the publisher), so
// the check is a script rather than a habit.
//
// The exclusion list in middleware.ts is a negative lookahead of path prefixes, so the model here is
// a prefix test against the path without its leading slash. Run: node scripts/audit-routes.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const root = process.cwd();

const middleware = readFileSync(join(root, 'middleware.ts'), 'utf8');
const matcher = middleware.match(/'\/\(\(\?!([^)]+)\)/);
if (!matcher) {
  console.error('Could not find the middleware matcher in middleware.ts.');
  process.exit(1);
}
const exclusions = matcher[1].split('|');

// A route is self-authenticating if it checks a shared secret or a signature, or is public by
// design. Everything else is expected to sit behind the session.
const SELF_AUTH_MARKERS = ['CRON_SECRET', 'INBOUND_EMAIL_SECRET', 'svix-signature'];
const PUBLIC_PATHS = new Set(['/api/leads', '/api/unsubscribe']);

function routeFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...routeFiles(full));
    else if (entry === 'route.ts') found.push(full);
  }
  return found;
}

const rows = routeFiles(join(root, 'app', 'api'))
  .map((file) => {
    const segments = relative(join(root, 'app'), file).split(sep).slice(0, -1);
    const path = `/${segments.join('/')}`;
    const source = readFileSync(file, 'utf8');
    const selfAuthenticating =
      PUBLIC_PATHS.has(path) || SELF_AUTH_MARKERS.some((marker) => source.includes(marker));
    const skipped = exclusions.some((prefix) => path.slice(1).startsWith(prefix));
    return { path, selfAuthenticating, skipped, ok: skipped === selfAuthenticating };
  })
  .sort((a, b) => a.path.localeCompare(b.path));

const failures = rows.filter((row) => !row.ok);

for (const row of rows) {
  const expectation = row.selfAuthenticating ? 'skipped' : 'session gate';
  console.log(
    `${row.ok ? 'OK  ' : 'FAIL'} ${row.path.padEnd(26)} expects ${expectation.padEnd(13)} got ${row.skipped ? 'skipped' : 'session gate'}`,
  );
}

if (failures.length > 0) {
  console.error(`\n${failures.length} route(s) would be redirected before their own check runs:`);
  for (const row of failures) {
    console.error(
      row.selfAuthenticating
        ? `  - ${row.path} authenticates itself but is behind the sign-in gate; add it to the matcher`
        : `  - ${row.path} relies on the session but is excluded; it would be reachable signed out`,
    );
  }
  process.exit(1);
}

console.log(`\n${rows.length} routes checked; exclusions match what each route expects.`);
