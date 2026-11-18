#!/usr/bin/env node
// Pins what a company save writes, so one panel cannot clear the other.
//
// Run with:  npm run check:company-save
//
// The company page has two panels posting to the same action: owner and next action, and the profile.
// When the action wrote every column from whichever form arrived, saving the owner nulled the legal
// name, address and staff countries, and saving the profile cleared the owner and the next action.
// That is invisible to a type check, to a build, and to check:writes — the payload is well formed, it
// just carries fields the form never sent. So the rule is tested here directly: a field the form did
// not send must be absent from the patch, while an empty input must still clear its own column.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLib } from './load-lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const { companyPatch } = await loadLib('company-fields.ts', 'check:company-save');

// The page's own field names, so a rename there fails here rather than quietly emptying the test.
const page = readFileSync(resolve(HERE, '..', 'app', 'companies', '[id]', 'page.tsx'), 'utf8');

const OWNER_FIELDS = ['ownerId', 'introducedBy', 'nextAction', 'nextActionDue'];
const OWNER_COLUMNS = ['owner_id', 'introduced_by', 'next_action', 'next_action_due'];
const PROFILE_FIELDS = [
  'legalName',
  'registrationNumber',
  'website',
  'industry',
  'foundedYear',
  'employeeCount',
  'addressLine1',
  'addressLine2',
  'city',
  'region',
  'postalCode',
  'country',
  'phone',
  'staffCountries',
];
const PROFILE_COLUMNS = [
  'legal_name',
  'registration_number',
  'website',
  'industry',
  'founded_year',
  'employee_count',
  'address_line1',
  'address_line2',
  'city',
  'region',
  'postal_code',
  'country',
  'phone',
  'staff_countries',
];

const failures = [];
let checked = 0;

const show = (value) => (value === undefined ? 'nothing' : JSON.stringify(value));

const same = (what, actual, expected) => {
  checked += 1;
  if (show(actual) !== show(expected)) failures.push(`${what}: expected ${show(expected)}, got ${show(actual)}`);
};

const form = (entries) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
};

const filled = (fields) => Object.fromEntries(fields.map((name) => [name, 'x']));

const patchOf = (entries) => {
  const result = companyPatch(form(entries));
  return result.ok ? result.patch : { error: result.error };
};

// The owner panel on its own: its four columns, and nothing from the profile.
const owner = patchOf({ ownerId: 'u1', introducedBy: 'u2', nextAction: 'Call the CFO', nextActionDue: '2026-12-01' });
same('the owner panel writes its own four columns', Object.keys(owner).sort(), OWNER_COLUMNS.slice().sort());
for (const column of PROFILE_COLUMNS) {
  same(`the owner panel does not write ${column}`, column in owner, false);
}

// The profile panel on its own: every profile column, and neither the owner nor the next action.
const profile = patchOf({ ...filled(PROFILE_FIELDS), employeeCount: '40', foundedYear: '1998', country: 'US' });
same('the profile panel writes every profile column', Object.keys(profile).sort(), PROFILE_COLUMNS.slice().sort());
for (const column of OWNER_COLUMNS) {
  same(`the profile panel does not write ${column}`, column in profile, false);
}

// The save that started this: a profile, then an owner, then the profile again. If either save wrote
// the other panel's columns, the second read would differ from the first.
const firstProfile = patchOf({ legalName: 'Acme Ltd', city: 'Phoenix', staffCountries: 'US' });
const ownerAfter = patchOf({ ownerId: 'u1' });
const secondProfile = patchOf({ legalName: 'Acme Ltd', city: 'Phoenix', staffCountries: 'US' });
same('a profile save survives an owner save between it', firstProfile, secondProfile);
same('the owner save in between carried only its own field', Object.keys(ownerAfter), ['owner_id']);

// An empty input still clears its own column: absent means untouched, empty means cleared.
same('an emptied legal name is cleared', patchOf({ legalName: '' }).legal_name, null);
same('an emptied next action is cleared', patchOf({ nextAction: '' }).next_action, null);
same('an emptied employee count is cleared', patchOf({ employeeCount: '' }).employee_count, null);
same('an emptied due date is cleared', patchOf({ nextActionDue: '' }).next_action_due, null);

// Validation the panel relies on, kept beside the mapping it protects.
same('a lower-case country is stored upper-case', patchOf({ country: 'us' }).country, 'US');
same(
  'a three-letter country is refused',
  patchOf({ country: 'USA' }).error,
  'The country must be a two-letter code, such as US.',
);
same(
  'staff countries are upper-cased and de-duplicated',
  patchOf({ staffCountries: 'us, CA, us' }).staff_countries,
  ['US', 'CA'],
);
same('an employee count is a number', patchOf({ employeeCount: '40' }).employee_count, 40);
same('a fractional employee count is refused', patchOf({ employeeCount: '12.5' }).error, 'Enter a whole number for employeeCount.');
same('a founded year before 1800 is refused', patchOf({ foundedYear: '1799' }).error, 'Enter a whole number for foundedYear.');
same('an unreadable due date is refused', patchOf({ nextActionDue: '2026-13-45' }).error, 'The due date is not valid.');
same(
  'a form with nothing this action knows is refused',
  patchOf({ nickname: 'Ace' }).error,
  'That form did not contain anything to save.',
);

// Every field this test sends has to still be a field on the page, or the test is guarding nothing.
const missing = [...OWNER_FIELDS, ...PROFILE_FIELDS].filter((name) => !page.includes(`name="${name}"`));
same('every field the test sends is still on the page', missing, []);

// And the premise: two panels, one action. Split into two actions and this rule stops being what keeps
// the panels apart, so the check should fail and be reread rather than quietly pass.
same(
  'both panels still post to the same action',
  (page.match(/action=\{updateCompanyWithId\}/g) ?? []).length,
  2,
);

if (failures.length === 0) {
  console.log(`A company save writes only the fields its own panel sent (${checked} checks).`);
  process.exit(0);
}

console.error(`A company save is wrong in ${failures.length} place${failures.length === 1 ? '' : 's'}:\n`);
for (const failure of failures) console.error(`  ${failure}`);
console.error('\nThe two panels on the company page post to the same action, so the patch has to carry');
console.error('the fields that arrived and no others. Writing a column the form did not send clears it,');
console.error('and the person who saved the owner panel never sees the profile go. An empty input must');
console.error('still be written as null: that is how a field is deliberately cleared.');
process.exit(1);
