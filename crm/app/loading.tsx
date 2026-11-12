// Shown while a page's data loads. Before this, a slow query looked like a dead click: the previous
// page stayed on screen and nothing said work was happening.

export default function Loading() {
  return (
    <main className="page">
      <header className="page-head">
        <h1>Loading</h1>
        <p className="muted">Fetching the latest figures.</p>
      </header>
      <div className="kpis" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="kpi skeleton" />
        ))}
      </div>
      <div className="panel skeleton skeleton-block" aria-hidden="true" />
      <p className="muted small" role="status">
        If this stays for more than a few seconds, the database or the connection is slow rather than
        the page being empty.
      </p>
    </main>
  );
}
