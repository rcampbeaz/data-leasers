#!/usr/bin/env node
// Holds .env.example to the two directions it can drift: a name the app reads that the template never
// mentions, and a name the template still documents that nothing reads.
//
// Run with:  npm run check:env
//
// Both directions have already caused a bad afternoon here. Preflight listed only the aggregator's two
// names after Facebook publishing landed, so a server configured for the Page failed its own check —
// that was the template and the tool disagreeing. And when the provider path was extended, its two
// names stayed in the template, sending whoever set up a server to configure something no code read.
// Neither is visible by reading either file alone.
//
// The rule is deliberately narrow. Names read by the running app (`lib/`, `app/`, `components/`,
// `middleware.ts`) must appear in .env.example, because that file is how a new server gets configured.
// Names read only by `scripts/` are operator flags — `SEED_CONFIRM=yes`, `SEED_STAFF_PASSWORD` — not
// project configuration, so they are not required there. `NODE_ENV` is provided by the runtime.
//
// What this does not prove: that a value is set on any machine (preflight answers that), or that the
// name is used correctly. It is the contract between the code and the file a person copies.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Files the deployed app runs.
const RUNTIME = ['lib', 'app', 'components', 'middleware.ts'];
// Everything that runs at all, including the one-off scripts.
const ANYWHERE = [...RUNTIME, 'scripts'];

const ENV = /process\.env\.([A-Z][A-Z0-9_]*)/g;
// Provided by the platform, not by an operator.
const PROVIDED = new Set(['NODE_ENV']);

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

const undocumented = [...runtime.keys()].filter((name) => !documented.has(name) && !PROVIDED.has(name));
const unread = [...documented].filter((name) => !anywhere.has(name));

if (undocumented.length === 0 && unread.length === 0) {
  console.log(
    `Every name the app reads is in .env.example, and nothing there has outlived its reader (${documented.size} names).`,
  );
  process.exit(0);
}

if (undocumented.length > 0) {
  console.error(`The app reads ${undocumented.length} name${undocumented.length === 1 ? '' : 's'} that .env.example never mentions:\n`);
  for (const name of undocumented) console.error(`  ${name.padEnd(32)} ${where(runtime.get(name))}`);
  console.error('\nAdd each one to crm/.env.example with a line saying what it is and where it comes from:');
  console.error('a server set up from that file has to end up able to run this code.');
}

if (unread.length > 0) {
  console.error(`\n.env.example documents ${unread.length} name${unread.length === 1 ? '' : 's'} no code reads:\n`);
  for (const name of unread) console.error(`  ${name}`);
  console.error('\nRemove them, or read them again: a name nobody reads sends whoever sets up a server to');
  console.error('configure something that does nothing.');
}

process.exit(1);

function where(file) {
  return file ? file.slice(ROOT.length + 1) : '';
}
