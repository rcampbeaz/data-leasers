// Which roles can see each part of the CRM. Pages still check access themselves;
// this only controls what the sidebar shows.
export type Role = 'admin' | 'introducer' | 'reviewer' | 'viewer';

export const NAV_ITEMS: { href: string; label: string; roles: Role[] }[] = [
  { href: '/dashboard', label: 'Dashboard', roles: ['admin', 'introducer', 'reviewer', 'viewer'] },
  { href: '/leads', label: 'Leads', roles: ['admin', 'introducer', 'viewer'] },
  { href: '/pipeline', label: 'Pipeline', roles: ['admin', 'introducer', 'viewer'] },
  { href: '/companies', label: 'Companies', roles: ['admin', 'introducer', 'viewer'] },
  { href: '/buyers', label: 'Buyers', roles: ['admin', 'introducer', 'viewer'] },
  { href: '/partners', label: 'Partners', roles: ['admin', 'introducer', 'viewer'] },
  { href: '/tasks', label: 'Tasks', roles: ['admin', 'introducer', 'viewer'] },
  { href: '/marketing', label: 'Marketing', roles: ['admin', 'introducer', 'viewer'] },
  { href: '/outbound', label: 'Outbound', roles: ['admin', 'introducer', 'viewer'] },
  { href: '/templates', label: 'Templates', roles: ['admin', 'introducer', 'viewer'] },
  { href: '/deliverability', label: 'Deliverability', roles: ['admin', 'introducer', 'viewer'] },
  { href: '/import', label: 'Import', roles: ['admin', 'introducer'] },
  { href: '/agents', label: 'Agents', roles: ['admin', 'introducer'] },
  { href: '/review', label: 'Review queue', roles: ['admin', 'reviewer'] },
  { href: '/audit', label: 'Activity log', roles: ['admin', 'reviewer'] },
  { href: '/privacy-requests', label: 'Privacy requests', roles: ['admin'] },
  { href: '/admin/staff', label: 'Staff', roles: ['admin'] },
];

export function navFor(role: string): { href: string; label: string }[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role as Role));
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  introducer: 'Introducer',
  reviewer: 'Reviewer',
  viewer: 'Viewer',
};
