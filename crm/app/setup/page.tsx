// Reached only when the middleware finds no Supabase project to talk to. It imports nothing from
// lib/, because everything there needs the very configuration that is missing.

export const dynamic = 'force-static';

type Variable = { name: string; what: string };

const REQUIRED: Variable[] = [
  {
    name: 'NEXT_PUBLIC_SUPABASE_URL',
    what: 'The project URL, from Supabase → Project Settings → API.',
  },
  {
    name: 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    what: 'The publishable key beside it. It reaches the browser, but every query it makes is still held to the row-level security policies.',
  },
  {
    name: 'SUPABASE_SERVICE_ROLE_KEY',
    what: 'Server-only, and never sent to a browser. The website intake, the publisher, the unsubscribe route and the erasure action use it, because they must not be subject to a policy written for a signed-in person.',
  },
];

const OPTIONAL: Variable[] = [
  {
    name: 'CRM_ORIGIN',
    what: 'The public origin, for links that leave the server (magic links, unsubscribe links). Defaults to https://app.dataleasers.com.',
  },
  {
    name: 'CRON_SECRET',
    what: 'The shared secret the reminder, publisher and partner-report jobs present. Without it those routes answer 401.',
  },
  {
    name: 'RESEND_API_KEY',
    what: 'Sends outbound email. Without it a send is recorded as a failure rather than pretending to have gone out.',
  },
  { name: 'MFA_REQUIRED', what: 'Set to true to require two-factor before the console opens.' },
  {
    name: 'SEED_STAFF_PASSWORD',
    what: 'Read by npm run seed only, to give the first staff account a password. It is never stored in the repository.',
  },
];

function Table({ rows }: { rows: Variable[] }) {
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Variable</th>
          <th>What it is for</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.name}>
            <td>
              <code>{row.name}</code>
            </td>
            <td className="wrap-cell">{row.what}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function SetupPage() {
  return (
    <main className="page">
      <header className="page-head">
        <h1>This console is not configured yet</h1>
        <p className="muted">
          It has no Supabase project to talk to, so there is nothing to sign in to and no data to
          show. Nothing is broken, and nothing was saved.
        </p>
      </header>

      <p className="notice blocked">
        Set the three variables below where this deployment reads its environment — the hosting
        provider&apos;s settings, or <code>.env.local</code> for <code>npm run dev</code> — then
        restart the process and reload this page.
      </p>

      <section className="panel">
        <h2>Required</h2>
        <Table rows={REQUIRED} />
        <p className="muted small-note">
          The service-role key bypasses row-level security by design. It belongs in the server
          environment only: never in a NEXT_PUBLIC_ variable, a committed file, or a browser.
        </p>
      </section>

      <section className="panel">
        <h2>Optional, and what changes without them</h2>
        <Table rows={OPTIONAL} />
      </section>

      <section className="panel">
        <h2>After the environment is set</h2>
        <ul className="list">
          <li>
            <code>npm run check:env</code> holds the variable names the code reads to{' '}
            <code>.env.example</code> and to what <code>npm run preflight</code> reports. It compares
            names, never values.
          </li>
          <li>
            <code>npm run preflight</code> answers whether <em>this</em> machine has the values, and
            what each missing one would stop working.
          </li>
          <li>
            <code>npm run check:migrations</code> confirms the SQL that has been pasted into the
            project matches the migrations in the repository.
          </li>
          <li>
            <code>npm run seed</code> creates the first staff account and a set of sample records.
            Run it against a new project only: it writes rows.
          </li>
        </ul>
        <p className="muted small-note">
          SETUP.md in the repository has the same list with the steps around it.
        </p>
      </section>
    </main>
  );
}
