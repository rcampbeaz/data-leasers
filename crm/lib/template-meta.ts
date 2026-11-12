// Template purposes, shared by the actions and the page.
//
// A 'use server' module may only export async functions, so the constants cannot live alongside the
// actions that use them.

export const PURPOSES = ['opener', 'follow_up', 'value_add', 'break_up', 'reply', 'partner'] as const;

export type Purpose = (typeof PURPOSES)[number];

export const PURPOSE_LABELS: Record<Purpose, string> = {
  opener: 'Opener',
  follow_up: 'Follow-up',
  value_add: 'Value add',
  break_up: 'Break-up',
  reply: 'After a reply',
  partner: 'Partner ask',
};

// Order the library as the cadence runs, so the list reads like the sequence it feeds.
export const PURPOSE_ORDER: Purpose[] = ['opener', 'follow_up', 'value_add', 'break_up', 'reply', 'partner'];
