'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Wordmark } from '@/components/wordmark';
import { SignOut } from '@/components/sign-out';
import type { CSSProperties } from 'react';
import { useState } from 'react';

/**
 * Primary navigation (spec 15).
 *
 * The order follows the questions each screen answers: what is happening now,
 * what do I have, what has my history looked like, what kind of player am I.
 */
const NAV_ITEMS = [
  { href: '/dashboard', label: 'Overview', icon: 'grid' },
  { href: '/library', label: 'Library', icon: 'library' },
  { href: '/collections', label: 'Collections', icon: 'stack' },
  { href: '/timeline', label: 'Timeline', icon: 'clock' },
  { href: '/achievements', label: 'Achievements', icon: 'trophy' },
  { href: '/stats', label: 'Statistics', icon: 'chart' },
  { href: '/settings', label: 'Settings', icon: 'gear' },
] as const;

export function Sidebar({
  user,
}: {
  user: { username: string; displayName: string | null; isAdmin?: boolean };
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  // The admin entry is appended rather than filtered out of a constant, so a
  // non-admin never receives the route in their markup at all.
  const items = user.isAdmin
    ? [...NAV_ITEMS, { href: '/admin', label: 'Data quality', icon: 'shield' } as const]
    : NAV_ITEMS;

  const nav = (
    <nav className="flex flex-col gap-1" aria-label="Primary">
      {items.map((item, index) => {
        // Prefix match so /game/foo keeps Library highlighted.
        const active =
          pathname === item.href ||
          (item.href !== '/dashboard' && pathname.startsWith(item.href));

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setMobileOpen(false)}
            aria-current={active ? 'page' : undefined}
            style={{ '--i': index } as CSSProperties}
            className={`group anim-fade stagger relative flex items-center gap-3 rounded-lg py-2 pl-4 pr-3 text-sm transition-colors duration-200 ${
              active
                ? 'bg-ink-850/70 font-medium text-ink-100'
                : 'text-ink-400 hover:bg-ink-850/40 hover:text-ink-200'
            }`}
          >
            {/* A rail marker rather than a filled pill. The active row reads
                as a position in a list, which is what navigation is, and it
                leaves the row's own background free to respond to hover.
                It grows from a stub on hover and runs full height when
                active, so the pointer gets an answer before the click. */}
            <span
              className={`absolute left-0 w-0.5 rounded-full bg-accent transition-all duration-200 ${
                active
                  ? 'inset-y-1.5 opacity-100'
                  : 'inset-y-1/2 -translate-y-1/2 opacity-0 group-hover:inset-y-2.5 group-hover:translate-y-0 group-hover:opacity-60'
              }`}
              aria-hidden
            />
            <span
              className={`transition-transform duration-200 group-hover:scale-110 ${
                active ? 'text-accent' : ''
              }`}
            >
              <NavIcon name={item.icon} />
            </span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* Mobile bar */}
      <div className="glass sticky top-0 z-30 flex items-center justify-between px-4 py-3 lg:hidden">
        <Wordmark />
        <button
          type="button"
          onClick={() => setMobileOpen((open) => !open)}
          aria-expanded={mobileOpen}
          aria-label="Toggle navigation"
          className="rounded-lg p-2 text-ink-300 hover:bg-ink-800"
        >
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {mobileOpen ? (
        <div className="glass anim-rise border-t-0 px-4 py-3 lg:hidden">
          {nav}
          <div className="mt-2 border-t border-ink-850 pt-2">
            <Link
              href={`/u/${user.username}`}
              onClick={() => setMobileOpen(false)}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-ink-400 transition-colors hover:bg-ink-850 hover:text-ink-200"
            >
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-gradient-to-br from-accent via-violet to-positive text-[10px] font-semibold text-ink-950">
                {(user.displayName ?? user.username).slice(0, 2).toUpperCase()}
              </span>
              <span className="truncate">{user.displayName ?? user.username}</span>
            </Link>
            <SignOut />
          </div>
        </div>
      ) : null}

      {/* Desktop rail */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-ink-850 px-4 py-6 lg:flex">
        <div className="px-3">
          <Wordmark />
        </div>

        <div className="mt-8 flex-1">{nav}</div>

        <div className="border-t border-ink-850 pt-3">
          <Link
            href={`/u/${user.username}`}
            className="group flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-ink-400 transition-colors hover:bg-ink-850 hover:text-ink-200"
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-accent via-violet to-positive text-xs font-semibold text-ink-950 transition-transform duration-200 group-hover:scale-105">
              {(user.displayName ?? user.username).slice(0, 2).toUpperCase()}
            </span>
            <span className="truncate">{user.displayName ?? user.username}</span>
          </Link>
          <SignOut />
        </div>
      </aside>
    </>
  );
}

function NavIcon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
    library: 'M4 5h5v14H4zM11 5h4v14h-4zM17.5 5.6l3 13.3',
    clock: 'M12 7v5l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    chart: 'M5 20V10M12 20V4M19 20v-7',
    stack: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17l9 5 9-5',
    shield: 'M12 3l8 3v6c0 4.4-3.2 7.9-8 9-4.8-1.1-8-4.6-8-9V6l8-3z',
    trophy: 'M7 4h10v5a5 5 0 01-10 0V4zM7 6H4v1a3 3 0 003 3M17 6h3v1a3 3 0 01-3 3M9 19h6M12 14v5',
    gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-2.9 1.2V21a2 2 0 11-4 0v-.1A1.7 1.7 0 004.6 19l-.1.1a2 2 0 11-2.8-2.8l.1-.1A1.7 1.7 0 003 13.4H3a2 2 0 110-4h.1A1.7 1.7 0 004.9 6.6l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3H10a1.7 1.7 0 001-1.5V2a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9V9a1.7 1.7 0 001.5 1H22a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
  };

  return (
    <svg
      viewBox="0 0 24 24"
      className="size-[18px] shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={paths[name] ?? paths.grid!} />
    </svg>
  );
}
