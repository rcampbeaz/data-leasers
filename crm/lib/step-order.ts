// Renumbering after a step is deleted.
//
// Positions must stay 1..n with no gaps because the sender looks for `position === current + 1`:
// a hole reads as the end of the sequence, so a deleted step would silently cut a cadence short.
//
// The move list is pure so the property that matters can be tested without a database: applying the
// moves in order never puts two steps on the same position, which is what `unique (sequence_id,
// position)` would reject mid-way. Ascending order guarantees it — every target is lower than the
// step's current position and every lower slot has already been settled.

export type OrderedStep = { id: string; position: number };
export type StepMove = { id: string; from: number; to: number };

export function renumberPlan(steps: OrderedStep[]): StepMove[] {
  const sorted = [...steps].sort((a, b) => a.position - b.position);
  const moves: StepMove[] = [];
  sorted.forEach((step, index) => {
    const to = index + 1;
    if (step.position !== to) moves.push({ id: step.id, from: step.position, to });
  });
  return moves;
}
