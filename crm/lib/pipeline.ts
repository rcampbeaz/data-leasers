// Stage rules. Pure functions, so they can be tested without the database.
// Early stages move automatically when their criteria are met.
// Later stages are only suggested; a person confirms them.

export const STAGES = [
  'New lead',
  'Call booked',
  'Data assessed',
  'Introduced to Mode',
  'Mode in discussion',
  'Owner decision',
  'Closed',
] as const;

export type Stage = (typeof STAGES)[number];
export type DatasetStatus = 'Approved' | 'Review' | 'Blocked';

export type CompanyState = {
  stage: Stage;
  closeReason: string | null;
  datasets: { status: DatasetStatus }[];
  noteCount: number;
  // Earliest logged call time, if any.
  callAt: Date | null;
};

export type StageSuggestion = {
  to: Stage;
  auto: boolean; // true: apply now. false: show as a suggestion for a person to confirm.
  reason: string;
} | null;

const rank = (s: Stage) => STAGES.indexOf(s);

export function suggestStage(c: CompanyState): StageSuggestion {
  if (c.stage === 'Closed') return null;

  // Any blocked dataset holds the company at Data assessed or earlier.
  const hasBlocked = c.datasets.some((d) => d.status === 'Blocked');
  const allCleared =
    c.datasets.length > 0 && c.datasets.every((d) => d.status === 'Approved');

  // Automatic: a call with a date moves New lead to Call booked.
  if (c.stage === 'New lead' && c.callAt) {
    return { to: 'Call booked', auto: true, reason: 'Call logged with a date' };
  }

  // Automatic: all datasets approved and at least one note moves to Data assessed.
  if (
    (c.stage === 'New lead' || c.stage === 'Call booked') &&
    allCleared &&
    c.noteCount > 0 &&
    !hasBlocked
  ) {
    return { to: 'Data assessed', auto: true, reason: 'Datasets approved and notes added' };
  }

  // Suggested only: never automatic beyond Data assessed.
  if (c.stage === 'Data assessed' && allCleared && !hasBlocked) {
    return {
      to: 'Introduced to Mode',
      auto: false,
      reason: 'Datasets approved. Confirm once the introduction is made.',
    };
  }

  return null;
}

// Closing needs a reason. Returns an error message, or null if the move is allowed.
// Moving backwards is allowed; closed records can be reopened.
export function validateMove(to: Stage, closeReason: string | null): string | null {
  if (to === 'Closed' && !closeReason) return 'Choose a close reason before closing.';
  return null;
}

export const rankOf = rank;
