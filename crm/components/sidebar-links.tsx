'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// The sidebar had no idea which page you were on, which is most of why it read as a list of links
// rather than a navigation. A tool you sit in all day should say where you are.

export function SidebarLinks({ items }: { items: { href: string; label: string }[] }) {
  const path = usePathname() ?? '';

  return (
    <>
      {items.map((item) => {
        const active = item.href === '/' ? path === '/' : path === item.href || path.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={active ? 'active' : undefined}
            aria-current={active ? 'page' : undefined}
          >
            {item.label}
          </Link>
        );
      })}
    </>
  );
}
