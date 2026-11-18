#!/usr/bin/env node
// Every exported server action has to be reachable from something.
//
// Run with:  npm run check:actions
//
// A server action is an exported function in a module that begins with 'use server'. Nothing calls
// it — it is called by a form, an href, a cron route or another action — so a rename on one side
// leaves the function exported and doing nothing, and the compiler is content. `changeRole` sat in
// lib/staff-actions.ts with no caller until it was found by reading. This finds that case by itself:
// for each exported action, the name has to appear somewhere other than its own declaration and the
// import that brought it in.
//
// What it does not check: whether the action's parameters match how a form calls it (the type
// checker does), actions exported as const arrow functions (none are), or an action called only
// through a string at runtime. Those are worth knowing, not worth guessing at here.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (name === 'node_modules' || name === '.next') return [];
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(?:ts|tsx|mjs)$/.test(name) ? [full] : [];
  });

const files = ['lib', 'app', 'scripts'].flatMap((dir) => walk(join(ROOT, dir)));

const sources = new Map();
for (const full of files) {
  sources.set(relative(ROOT, full).split('\\').join('/'), readFileSync(full, 'utf8'));
}

// The module directive sits above any comment, import or code. Reading the first line that is not
// blank or a comment is how the file itself is judged by the compiler, so it is how it is judged here.
const isActionModule = (source) => {
  for (const line of source.split('\n')) {
    const text = line.trim();
    if (!text || text.startsWith('//') || text.startsWith('/*') || text.startsWith('*')) continue;
    return text === "'use server';" || text === '"use server";';
  }
  return false;
};

// Imports and the declaration itself do not count as a use. An action that is only imported and
// never called is exactly the failure this looks for, and the import is what makes it look used.
const withoutImportsAnd = (source, name) => {
  const lines = source.split('\n');
  const kept = [];
  let inImport = false;
  for (const line of lines) {
    if (!inImport && /^\s*import\b/.test(line)) {
      if (!line.includes(';')) inImport = true;
      continue;
    }
    if (inImport) {
      if (line.includes(';')) inImport = false;
      continue;
    }
    if (new RegExp(`^\\s*export\\s+(?:async\\s+)?function\\s+${name}\\b`).test(line)) continue;
    kept.push(line);
  }
  return kept.join('\n');
};

const DECLARATION = /^\s*export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/gm;

const actions = [];
for (const [file, source] of sources) {
  if (!file.endsWith('.ts') || !isActionModule(source)) continue;
  for (const match of source.matchAll(DECLARATION)) {
    const line = source.slice(0, match.index).split('\n').length;
    actions.push({ name: match[1], file, line });
  }
}

const dead = [];
for (const action of actions) {
  const callers = [];
  for (const [file, source] of sources) {
    if (new RegExp(`\\b${action.name}\\b`).test(withoutImportsAnd(source, action.name))) callers.push(file);
  }
  if (callers.length === 0) dead.push(action);
}

if (actions.length === 0) {
  console.error('No server actions were found. The check is looking for modules that begin with');
  console.error("'use server'; if the directive moved, this check has stopped guarding anything.");
  process.exit(1);
}

if (dead.length === 0) {
  console.log(`Every server action has a caller (${actions.length} actions).`);
  process.exit(0);
}

console.error(`${dead.length} server action${dead.length === 1 ? ' is' : 's are'} exported and never used:\n`);
for (const action of dead) console.error(`  ${action.file}:${action.line}  ${action.name}`);
console.error('\nAn exported action nothing calls is not harmless: it reads as a supported operation,');
console.error('it is one more thing to keep working, and its validations are never exercised. Either');
console.error('wire it to the form that should post to it, or delete it.');
process.exit(1);
