// Which roles can see each part of the CRM. Pages still check access themselves;
// this only controls what the sidebar shows.
export type Role = 'admin' | 'introducer' | 'reviewer' | 'viewer';

type NavItem = { href: string; label: string; hint: string; roles: Role[] };

// Grouped by the job, not by how the database is shaped. A flat list of seventeen links in creation
// order told a new person nothing about where to start or which pages belong together; these four
// sections answer "what am I doing" before "where is it".
export const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Pipeline',
    items: [
      { href: '/dashboard', label: 'Dashboard', hint: 'Figures, and what needs a person today', roles: ['admin', 'introducer', 'reviewer', 'viewer'] },
      { href: '/leads', label: 'Leads', hint: 'Enquiries that are not companies yet', roles: ['admin', 'introducer', 'viewer'] },
      { href: '/pipeline', label: 'Pipeline', hint: 'Companies by stage; drag one to move it', roles: ['admin', 'introducer', 'viewer'] },
      { href: '/companies', label: 'Companies', hint: 'Every company, including closed records', roles: ['admin', 'introducer', 'viewer'] },
      { href: '/tasks', label: 'Tasks', hint: 'Follow-ups across all companies', roles: ['admin', 'introducer', 'viewer'] },
      { href: '/buyers', label: 'Buyers', hint: 'Who a company can be introduced to', roles: ['admin', 'introducer', 'viewer'] },
      { href: '/partners', label: 'Referral partners', hint: 'Fee terms and the six-month deadline', roles: ['admin', 'introducer', 'viewer'] },
    ],
  },
  {
    title: 'Outreach',
    items: [
      { href: '/marketing', label: 'Social & marketing', hint: 'Write, schedule and check social posts', roles: ['admin', 'introducer', 'viewer'] },
      { href: '/outbound', label: 'Cold email', hint: 'Sequences, enrolments and approvals', roles: ['admin', 'introducer', 'viewer'] },
      { href: '/templates', label: 'Email templates', hint: 'The copy a cadence draws from', roles: ['admin', 'introducer', 'viewer'] },
      { href: '/deliverability', label: 'Email health', hint: 'Bounce and complaint rates per domain', roles: ['admin', 'introducer', 'viewer'] },
      { href: '/import', label: 'Prospect import', hint: 'Companies House search and CSV upload', roles: ['admin', 'introducer'] },
    ],
  },
  {
    title: 'Automation',
    items: [
      { href: '/agents', label: 'Agents', hint: 'Model-written drafts, capped daily', roles: ['admin', 'introducer'] },
    ],
  },
  {
    title: 'Admin',
    items: [
      { href: '/review', label: 'Data review', hint: 'Datasets still marked Review or Blocked', roles: ['admin', 'reviewer'] },
      { href: '/audit', label: 'Activity log', hint: 'The 200 most recent recorded changes', roles: ['admin', 'reviewer'] },
      { href: '/privacy-requests', label: 'Privacy requests', hint: 'Erase one person at their request', roles: ['admin'] },
      { href: '/admin/staff', label: 'Staff', hint: 'Who can sign in, and what they can do', roles: ['admin'] },
      { href: '/account', label: 'Account', hint: 'Your sign-in email and password', roles: ['admin', 'introducer', 'reviewer', 'viewer'] },
    ],
  },
];

export type NavGroup = { title: string; items: { href: string; label: string; hint: string }[] };

export function navFor(role: string): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    title: group.title,
    items: group.items
      .filter((item) => item.roles.includes(role as Role))
      .map(({ href, label, hint }) => ({ href, label, hint })),
  })).filter((group) => group.items.length > 0);
}

// Kept for anything that wants a flat list of reachable pages.
export const NAV_ITEMS = NAV_GROUPS.flatMap((group) => group.items);

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  introducer: 'Introducer',
  reviewer: 'Reviewer',
  viewer: 'Viewer',
};
