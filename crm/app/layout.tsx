import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { createStaffClient } from '@/lib/supabase';
import { currentStaff } from '@/lib/data';
import { navFor, ROLE_LABELS, type Role } from '@/lib/nav';
import { SidebarLinks } from '@/components/sidebar-links';
import { signOut } from '@/lib/staff-actions';

export const metadata: Metadata = {
  title: 'dataleasers CRM',
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createStaffClient();
  const staff = await currentStaff(supabase);

  // Signed-out pages (sign-in, no access) render without the CRM shell.
  if (!staff) {
    return (
      <html lang="en">
        <body>{children}</body>
      </html>
    );
  }

  const items = navFor(staff.role);
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <nav className="sidebar" aria-label="CRM">
            <img className="logo" src="/logo-reversed.svg" alt="dataleasers" />
            {items.map((group) => (
              <div key={group.title} className="sidebar-group">
                <span className="sidebar-group-title">{group.title}</span>
                <SidebarLinks items={group.items} />
              </div>
            ))}
            <div className="sidebar-foot">
              <div className="who">
                {staff.full_name}
                <span>{ROLE_LABELS[staff.role as Role] ?? staff.role}</span>
              </div>
              <Link href="/account">Account</Link>
              <form action={signOut}>
                <button type="submit" className="sidebar-signout">Sign out</button>
              </form>
            </div>
          </nav>
          <div className="content">{children}</div>
        </div>
      </body>
    </html>
  );
}
