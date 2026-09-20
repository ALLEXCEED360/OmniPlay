'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { Wordmark } from '@/components/wordmark';
import { SignOut } from '@/components/sign-out';

/**
 * Primary navigation (spec 15), as a game menu.
 *
 * The order follows the questions each screen answers: what is happening now,
 * what do I have, what has my history looked like, what kind of player am I.
 *
 * Each entry is a numbered, slanted block in the display cut. The active one
 * is an off-white cut-out — the single loudest thing in the rail — and the
 * marker that says "you are here" is one element that slides between rows
 * with a spring (`layoutId`), so changing page reads as the cursor moving
 * rather than one row switching off and another on.
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

const spring = { type: 'spring', stiffness: 560, damping: 40, mass: 0.7 } as const;

export function Sidebar({
  user,
}: {
  user: { username: string; displayName: string | null; isAdmin?: boolean };
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close the sheet on navigation, and keep the page from scrolling under it.
  useEffect(() => setMobileOpen(false), [pathname]);
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

  // The admin entry is appended rather than filtered out of a constant, so a
  // non-admin never receives the route in their markup at all.
  const items = user.isAdmin
    ? [...NAV_ITEMS, { href: '/admin', label: 'Data quality', icon: 'shield' } as const]
    : NAV_ITEMS;

  const initials = (user.displayName ?? user.username).slice(0, 2).toUpperCase();

  const nav = (id: string) => (
    <nav className="flex flex-col gap-1.5" aria-label="Primary">
      {items.map((item, index) => {
        // Prefix match so /game/foo keeps Library highlighted.
        const active =
          pathname === item.href ||
          (item.href !== '/dashboard' && pathname.startsWith(item.href));

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className="group relative block"
          >
            {active ? (
              <motion.span
                layoutId={`nav-active-${id}`}
                transition={spring}
                className="paper slant absolute inset-0"
                aria-hidden
              />
            ) : (
              // The hover fill grows from the left edge: the answer arrives
              // before the click, and from the direction the cursor came.
              <span
                className="slant absolute inset-0 origin-left scale-x-0 bg-accent transition-transform duration-200 ease-out group-hover:scale-x-100"
                aria-hidden
              />
            )}

            <span
              className={`relative flex items-center gap-3 py-2 pl-5 pr-4 transition-colors duration-150 ${
                active ? 'text-ink-950' : 'text-ink-300 group-hover:text-ink-950'
              }`}
            >
              <span
                className={`stat-figure w-5 text-[11px] ${
                  active ? 'text-accent-strong' : 'text-ink-600 group-hover:text-ink-900'
                }`}
                aria-hidden
              >
                {String(index + 1).padStart(2, '0')}
              </span>
              <NavIcon name={item.icon} />
              <span className="display text-[1.35rem] leading-none">{item.label}</span>
            </span>
          </Link>
        );
      })}
    </nav>
  );

  const profile = (
    <Link
      href={`/u/${user.username}`}
      className="group flex items-center gap-3 px-3 py-2 text-sm text-ink-400 transition-colors hover:text-ink-100"
    >
      <span className="slant grid size-9 shrink-0 place-items-center bg-accent font-display text-sm font-bold italic text-ink-950 transition-transform duration-200 group-hover:-skew-x-6">
        {initials}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-display text-base font-semibold uppercase tracking-wide">
          {user.displayName ?? user.username}
        </span>
        <span className="block text-[11px] text-ink-600">Public profile →</span>
      </span>
    </Link>
  );

  return (
    <>
      {/* Mobile bar */}
      <div className="glass sticky top-0 z-40 flex items-center justify-between px-4 py-3 lg:hidden">
        <Wordmark href="/menu" />
        <button
          type="button"
          onClick={() => setMobileOpen((open) => !open)}
          aria-expanded={mobileOpen}
          aria-label="Toggle navigation"
          className="slant grid size-10 place-items-center bg-accent text-ink-950"
        >
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.2">
            {mobileOpen ? (
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            ) : (
              <path d="M4 7h16M4 12h12M4 17h16" strokeLinecap="round" />
            )}
          </svg>
        </button>
      </div>

      {/* Mobile sheet: full screen, wipes in from the left. */}
      <AnimatePresence>
        {mobileOpen ? (
          <motion.div
            key="sheet"
            className="fixed inset-0 z-30 flex flex-col bg-ink-950 px-4 pb-6 pt-20 halftone lg:hidden"
            initial={{ x: '-100%', skewX: -6 }}
            animate={{ x: 0, skewX: 0 }}
            exit={{ x: '-100%', skewX: -6 }}
            transition={{ duration: 0.34, ease: [0.76, 0, 0.24, 1] }}
          >
            <div className="flex-1 overflow-y-auto">
              <Link
                href="/menu"
                className="mb-3 flex items-center gap-2 px-5 font-display text-xs font-semibold uppercase tracking-[0.2em] text-ink-500"
              >
                &larr; Main menu
              </Link>
              {nav('mobile')}
            </div>
            <div className="mt-4 border-t border-ink-850 pt-3">
              {profile}
              <SignOut />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Desktop rail */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col bg-ink-950/80 px-4 py-6 backdrop-blur-sm lg:flex">
        {/* A red edge down the rail, cut at the top like a bookmark. */}
        <span
          className="pointer-events-none absolute inset-y-0 right-0 w-px bg-gradient-to-b from-accent via-ink-700 to-transparent"
          aria-hidden
        />

        <div className="px-3">
          <Wordmark large href="/menu" />
        </div>

        {/* The way back to the menu, above the list it condenses. */}
        <Link
          href="/menu"
          className="group mt-6 flex items-center gap-2 px-5 font-display text-xs font-semibold uppercase tracking-[0.2em] text-ink-500 transition-colors hover:text-accent"
        >
          <span className="inline-block transition-transform duration-200 group-hover:-translate-x-1">
            &larr;
          </span>
          Main menu
        </Link>

        <div className="mt-4 flex-1">{nav('desktop')}</div>

        <div className="border-t border-ink-850 pt-3">
          {profile}
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
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={paths[name] ?? paths.grid!} />
    </svg>
  );
}
