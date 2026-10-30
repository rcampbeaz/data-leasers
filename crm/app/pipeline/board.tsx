'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { dragMoveStage } from '@/lib/actions';

export type BoardCompany = {
  id: string;
  name: string;
  stage: string;
  next_action: string | null;
  next_action_due: string | null;
};

export default function PipelineBoard({
  companies,
  stages,
  today,
}: {
  companies: BoardCompany[];
  stages: readonly string[];
  today: string;
}) {
  const router = useRouter();
  const [items, setItems] = useState(companies);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Keep the board in step with the server after each refresh.
  useEffect(() => setItems(companies), [companies]);

  function drop(stage: string) {
    const id = dragId;
    setDragId(null);
    setOverStage(null);
    if (!id) return;

    const current = items.find((c) => c.id === id);
    if (!current || current.stage === stage) return;

    if (stage === 'Closed') {
      setMessage('To close a company, open it and choose a close reason.');
      return;
    }

    const previous = items;
    setItems(items.map((c) => (c.id === id ? { ...c, stage } : c)));
    setMessage(null);
    startTransition(async () => {
      const result = await dragMoveStage(id, stage);
      if (result.error) {
        setItems(previous);
        setMessage(result.error);
      }
      router.refresh();
    });
  }

  return (
    <>
      {message ? <p className="notice blocked">{message}</p> : null}
      <div className="board">
        {stages.map((stage) => {
          const cards = items.filter((c) => c.stage === stage);
          return (
            <section
              key={stage}
              className={`column ${overStage === stage ? 'dragover' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setOverStage(stage);
              }}
              onDragLeave={() => setOverStage((s) => (s === stage ? null : s))}
              onDrop={(e) => {
                e.preventDefault();
                drop(stage);
              }}
            >
              <h2>
                {stage} <span className="muted small">({cards.length})</span>
              </h2>
              {cards.length === 0 ? <p className="muted small">Drop a company here.</p> : null}
              {cards.map((c) => {
                const overdue = !!c.next_action_due && c.next_action_due < today && stage !== 'Closed';
                return (
                  <div
                    key={c.id}
                    draggable
                    onDragStart={() => setDragId(c.id)}
                    onDragEnd={() => {
                      setDragId(null);
                      setOverStage(null);
                    }}
                    className={`card ${overdue ? 'overdue' : ''} ${dragId === c.id ? 'dragging' : ''}`}
                  >
                    <Link href={`/companies/${c.id}`} draggable={false}>
                      <strong>{c.name}</strong>
                    </Link>
                    {c.next_action ? <span className="small">{c.next_action}</span> : null}
                    {c.next_action_due ? (
                      <span className="small muted">
                        Due {c.next_action_due}
                        {overdue ? ' (overdue)' : ''}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
    </>
  );
}
