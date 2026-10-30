import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'dataleasers CRM',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <nav className="sidebar" aria-label="CRM">
            <img className="logo" src="/logo-reversed.svg" alt="dataleasers" />
            <Link href="/leads">Leads</Link>
            <Link href="/pipeline">Pipeline</Link>
            <Link href="/companies">Companies</Link>
            <Link href="/review">Review queue</Link>
          </nav>
          <div className="content">{children}</div>
        </div>
      </body>
    </html>
  );
}
