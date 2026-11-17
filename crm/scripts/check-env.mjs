#!/usr/bin/env node
// Holds three things to each other: the names the app reads, the names .env.example documents, and the
// names preflight reports on.
//
// Run with:  npm run check:env
//
// Each pair of these can drift on its own, and each has already cost an afternoon here. Preflight listed
// only the aggregator's two names for days after Facebook publishing landed, so a server configured for
// the Page failed its own readiness check — .env.example had both names all along, which is why the
// template alone is not the contract worth asserting. A name the template keeps after nothing reads it
// sends whoever sets up a server to configure something that does nothing. And a name the app reads that
// the template never mentions leaves that server unable to do the thing it was set up for.
//
// The rule: a name the running app reads (`lib/`, `app/`, `components/`, `middleware.ts`) must be
// documented in .env.example AND reported by a group in preflight — unless it is listed below with the
// reason it needs neither, which for every entry so far is that the code supplies a default. Names read
// only by `scripts/` are operator flags (`SEED_CONFIRM=yes`), not server configuration, and are exempt.
//
// What this does not prove: that any machine has the values (preflight answers that), or that a name is
// used correctly. It is the contract between the code, the file a person copies, and the tool they run
// when the server misbehaves.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Files the deployed app runs.
const RUNTIME = ['lib', 'app', 'components', 'middleware.ts'];
// Everything that runs at all, including the one-off scripts.
const ANYWHERE = [...RUNTIME, 'scripts'];

const ENV = /process\.env\.([A-Z][A-Z0-9_]*)/g;

// Read by the app, deliberately absent from .env.example and from preflight, with the reason.
const NOT_A_SERVER_SETTING = new Map([
  ['NODE_ENV', 'set by the runtime, never by an operator'],
  ['FACEBOOK_API_VERSION', 'defaults to v26.0 in lib/social.ts; preflight does not need to ask'],
  ['OPENAI_BASE_URL', 'blank means OpenAI, which is the default in lib/social-actions.ts'],
  ['MFA_REQUIRED', 'false until the admin enrols, which is the safe direction'],
  ['BOOKING_URL', 'no link means the button is not shown, not a broken deploy'],
]);

const walk = (path) => {
  const full = join(ROOT, path);
  if (statSync(full).isFile()) return [full];
  return readdirSync(full).flatMap((name) => {
    if (name === 'node_modules' || name === '.next') return [];
    const child = join(full, name);
    if (statSync(child).isDirectory()) return walk(join(path, name));
    return /\.(?:ts|tsx|mjs|js)$/.test(name) ? [child] : [];
  });
};

const names = (dirs) => {
  const found = new Map();
  for (const dir of dirs) {
    for (const file of walk(dir)) {
      for (const match of readFileSync(file, 'utf8').matchAll(ENV)) {
        if (!found.has(match[1])) found.set(match[1], file);
      }
    }
  }
  return found;
};

const runtime = names(RUNTIME);
const anywhere = names(ANYWHERE);

const documented = new Set(
  readFileSync(join(ROOT, '.env.example'), 'utf8')
    .split('\n')
    .map((line) => line.match(/^([A-Z][A-Z0-9_]*)=/)?.[1])
    .filter(Boolean),
);

// preflight's own list of what it reports. Parsed rather than imported because running that module
// reads the environment and calls the server; a failure to read it must fail this check, not empty it.
const PREFLIGHT = readFileSync(join(ROOT, 'scripts/preflight.mjs'), 'utf8');
const groups = [...PREFLIGHT.matchAll(/\[\s*'([A-Za-z ]+)'\s*,\s*\[([^\]]*)\]/g)].map((match) => ({
  title: match[1],
  names: [...match[2].matchAll(/'([A-Z][A-Z0-9_]*)'/g)].map((name) => name[1]),
}));
const reported = new Set(groups.flatMap((group) => group.names));

const problems = [];

if (groups.length === 0) {
  problems.push({
    title: 'preflight\u2019s groups could not be read',
    detail: [
      'scripts/preflight.mjs no longer has a GROUPS array this check can follow, so nothing can be',
      'said about what it reports. Restore the shape, or teach scripts/check-env.mjs the new one.',
    ],
  });
}

const undocumented = [...runtime.keys()].filter(
  (name) => !documented.has(name) && !NOT_A_SERVER_SETTING.has(name),
);
if (undocumented.length > 0) {
  problems.push({
    title: `the app reads ${undocumented.length} name${undocumented.length === 1 ? '' : 's'} .env.example never mentions`,
    lines: undocumented.map((name) => `${name.padEnd(30)} ${where(runtime.get(name))}`),
    detail: [
      'Add each to crm/.env.example with a line saying what it is and where it comes from: a server',
      'set up from that file has to end up able to run this code.',
    ],
  });
}

const unreported = [...runtime.keys()].filter(
  (name) => !reported.has(name) && !NOT_A_SERVER_SETTING.has(name),
);
if (unreported.length > 0) {
  problems.push({
    title: `${unreported.length} name${unreported.length === 1 ? '' : 's'} the app reads that preflight never reports`,
    lines: unreported.map((name) => `${name.padEnd(30)} ${where(runtime.get(name))}`),
    detail: [
      'preflight is how a misconfigured server is diagnosed, so a name it does not list is invisible',
      'when one is set up wrong. Add it to a group in scripts/preflight.mjs (optional is fine), or to',
      'NOT_A_SERVER_SETTING in this file with the reason the code can do without it.',
    ],
  });
}

const unread = [...documented].filter((name) => !anywhere.has(name));
if (unread.length > 0) {
  problems.push({
    title: `.env.example documents ${unread.length} name${unread.length === 1 ? '' : 's'} no code reads`,
    lines: unread,
    detail: [
      'Remove them, or read them again: a name nobody reads sends whoever sets up a server to',
      'configure something that does nothing.',
    ],
  });
}

const stale = [...reported].filter((name) => !anywhere.has(name));
if (stale.length > 0) {
  problems.push({
    title: `preflight reports ${stale.length} name${stale.length === 1 ? '' : 's'} no code reads`,
    lines: stale,
    detail: ['Drop them from scripts/preflight.mjs: a group that asks for nothing is a false alarm.'],
  });
}

if (problems.length === 0) {
  console.log(
    `Every name the app reads is documented and reported (${documented.size} names in .env.example, ` +
      `${reported.size} in ${groups.length} preflight groups, ${NOT_A_SERVER_SETTING.size} deliberate exceptions).`,
  );
  process.exit(0);
}

for (const problem of problems) {
  console.error(`${problem.title}:\n`);
  for (const line of problem.lines ?? []) console.error(`  ${line}`);
  console.error('');
  for (const line of problem.detail) console.error(line);
  console.error('');
}
process.exit(1);

function where(file) {
  return file ? file.slice(ROOT.length + 1) : '';
}
