#!/usr/bin/env node
// Pins the arithmetic that decides what a referral is worth, and how a figure is printed.
//
// Run with:  npm run check:money
//
// These are the only place in the console where a rounding error is money rather than a pixel: a fee
// rate applied to a six-figure licence, and the format that shows it. The cases below are the ones that
// go wrong quietly — a rate with no exact binary form, the floor winning by a cent, a database numeric
// arriving as a string, and a figure with and without cents.

import { loadLib } from './load-lib.mjs';

const deals = await loadLib('deals.ts', 'check:money');
const { money, referralFee } = deals;

const failures = [];
let checked = 0;

const show = (value) => (typeof value === 'string' ? `"${value}"` : String(value));

const same = (what, actual, expected) => {
  checked += 1;
  if (actual !== expected) failures.push(`${what}: expected ${show(expected)}, got ${show(actual)}`);
};

// The rate. 3% of $250,000 is $7,500.00 exactly, and 2.5% of $1,234.56 is $30.86 after one rounding.
same('3% of $250,000', referralFee(250000, 0.03, 5000), 7500);
same('2.5% of $1,234.56', referralFee(1234.56, 0.025, 0), 30.86);
same('10% of $1,000,000', referralFee(1000000, 0.1, 0), 100000);
same('a rate on cents, not dollars', referralFee(333.33, 0.15, 0), 50);

// The floor wins when the rate comes up short, and loses when it does not.
same('the floor holds up a small fee', referralFee(100000, 0.03, 5000), 5000);
same('the floor does not cap a large fee', referralFee(500000, 0.03, 5000), 15000);
same('the floor by a cent', referralFee(1000, 0.01, 5000.01), 5000.01);

// A numeric column can arrive as a string, and an unusable one is no fee rather than a free one.
same('a numeric arriving as a string', referralFee('250000', 0.03, 5000), 7500);
same('a decimal arriving as a string', referralFee('1234.56', 0.025, 0), 30.86);
same('a missing amount', referralFee(null, 0.03, 5000), null);
same('an empty amount', referralFee('', 0.03, 5000), null);
same('zero', referralFee(0, 0.03, 5000), null);
same('a negative amount', referralFee(-100, 0.03, 5000), null);
same('an unreadable amount', referralFee('nonsense', 0.03, 5000), null);
same('a NaN amount', referralFee(Number.NaN, 0.03, 5000), null);

// Printing. Cents appear only when the figure has them, and the printed number is the one that was
// rounded, not a second rounding of the original.
same('a whole figure', money(250000), '$250,000');
same('a figure with cents', money(15000.06), '$15,000.06');
same('cents arriving as a string', money('15000.06'), '$15,000.06');
same('a single decimal place', money(1234.5), '$1,234.50');
same('zero', money(0), '$0');
same('a negative figure', money(-500), '-$500');
same('a missing figure', money(null), '-');
same('an empty figure', money(''), '-');
same('an unreadable figure', money('nonsense'), '-');
same('another currency', money(250000, 'GBP'), '£250,000');

if (failures.length === 0) {
  console.log(`The referral fee and its formatting hold (${checked} checks).`);
  process.exit(0);
}

console.error(`Money is wrong in ${failures.length} place${failures.length === 1 ? '' : 's'}:\n`);
for (const failure of failures) console.error(`  ${failure}`);
console.error('\nreferralFee works in whole cents and rounds once, because a rate applied to dollars and');
console.error('rounded at the end is how a fee lands a cent out on a six-figure licence. money() prints the');
console.error('same rounded cents it decided the format from. If a change here was deliberate, the expected');
console.error('values are part of what changed.');
process.exit(1);
