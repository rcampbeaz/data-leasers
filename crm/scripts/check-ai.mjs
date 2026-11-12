#!/usr/bin/env node
// Checks the AI provider before you rely on it: does the key work, does the model id exist, and what
// is this key actually allowed to call.
//
// Run with:  npm run check-ai
//
// Reads the same .env the app reads, so it fails for the same reasons the app would, and it makes one
// tiny request (a handful of tokens) rather than spending a real drafting run.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

// Minimal .env reader: KEY=VALUE, optional quotes, # comments, optional `export`. Values are never
// printed by this script, only used.
function loadEnv() {
  const out = {};
  let raw = '';
  try {
    raw = readFileSync(resolve(ROOT, '.env'), 'utf8');
  } catch {
    console.log('No crm/.env found. Copy .env.example to .env first.');
    process.exit(1);
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).replace(/^export\s+/, '').trim();
    out[key] = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = { ...loadEnv(), ...process.env };
const key = env.OPENAI_API_KEY ?? '';
const base = (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const model = env.OPENAI_MODEL || 'gpt-4o-mini';

const fail = (message, hint) => {
  console.log(`\nFAILED: ${message}`);
  if (hint) console.log(hint);
  process.exit(1);
};

console.log(`Base URL : ${base}`);
console.log(`Model    : ${model}`);
if (!key) {
  fail(
    'OPENAI_API_KEY is empty in crm/.env.',
    'For a free Groq key: sign in at https://console.groq.com/keys, create a key, then set\n' +
      '  OPENAI_API_KEY=<your key, starting gsk>\n' +
      '  OPENAI_BASE_URL=https://api.groq.com/openai/v1\n' +
      '  OPENAI_MODEL=openai/gpt-oss-120b',
  );
}
console.log(`Key      : present (${key.length} characters, starts "${key.slice(0, 4)}")\n`);

async function get(path) {
  const response = await fetch(`${base}${path}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  return response;
}

// 1. Is the key accepted at all, and what can it call? /models is free and is the clearest signal.
let available = [];
try {
  const response = await get('/models');
  if (response.status === 401 || response.status === 403) {
    fail(
      `The provider rejected the key (HTTP ${response.status}).`,
      'It may be revoked, copied with a trailing space, or belong to a different provider than OPENAI_BASE_URL.',
    );
  }
  if (!response.ok) {
    fail(
      `The provider answered HTTP ${response.status} for ${base}/models.`,
      'Check OPENAI_BASE_URL. For Groq it must be exactly https://api.groq.com/openai/v1',
    );
  }
  const body = await response.json();
  available = (body.data ?? []).map((m) => m.id).filter(Boolean);
  console.log(`Key accepted. ${available.length} models are visible to it.`);
} catch (error) {
  fail(
    `Could not reach ${base}: ${error.message}`,
    'Check the URL and that this machine can reach the internet.',
  );
}

// 2. Does the configured model exist here? A wrong id is the most common failure and the provider
//    wording for it ("model_not_found") does not say which ids would work.
if (available.length && !available.includes(model)) {
  const chat = available.filter((id) => !/(whisper|tts|guard|orpheus|embed)/i.test(id));
  fail(
    `The model "${model}" is not available to this key.`,
    `Set OPENAI_MODEL to one of:\n${chat.map((id) => `  ${id}`).join('\n')}`,
  );
}
console.log(`Model "${model}" is available.`);

// 3. One real call, because a model can be listed and still fail (context, tier, capacity).
const started = Date.now();
let reply = null;
try {
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
      max_tokens: 10,
      temperature: 0,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    fail(
      `The chat call failed with HTTP ${response.status}: ${body?.error?.message ?? 'no message'}`,
      response.status === 429
        ? 'That is a rate limit. The free Groq plan is 30 requests/minute and 1,000/day per model.'
        : undefined,
    );
  }
  reply = (body?.choices?.[0]?.message?.content ?? '').trim();
} catch (error) {
  fail(`The chat call could not be made: ${error.message}`);
}

const ms = Date.now() - started;
console.log(`Chat call OK in ${ms} ms. Reply: ${JSON.stringify(reply)}`);
console.log('\nAI drafting will work on the server with these values.');
console.log('Next: put the three values in the server .env, redeploy, then turn agents on in /agents.');
console.log('Set the daily cap there BEFORE enabling, so a run cannot overspend.');
