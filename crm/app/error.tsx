'use client';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="page">
      <header className="page-head">
        <h1>That page could not load</h1>
      </header>
      <p className="notice blocked">
        Something failed while loading this page. Nothing was saved. Try again, and if it keeps
        happening the reference below identifies the failure in the server log.
      </p>
      {error.digest ? <p className="muted small">Reference: {error.digest}</p> : null}
      <button className="btn" type="button" onClick={() => reset()}>
        Try again
      </button>
    </main>
  );
}
