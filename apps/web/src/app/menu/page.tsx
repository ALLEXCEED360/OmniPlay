import { redirect } from 'next/navigation';
import { MainMenu, type MenuEntry } from '@/components/main-menu';
import { apiFetchOptional } from '@/lib/api';

export const metadata = { title: 'Main menu — OMNIPLAY' };

interface MeResponse {
  user: { username: string; displayName: string | null; isAdmin?: boolean };
}

/**
 * The main menu, between the title screen and the pages.
 *
 * The entries are the rail's entries in the rail's order — the same
 * questions in the same sequence, so the menu teaches the rail and the rail
 * remembers the menu. Each description is written in the voice of the page
 * it opens (they are the pages' own eyebrows, near enough). Nine at most,
 * so each has a number key; sign out is a corner button, not an entry.
 *
 * The case art is one Unsplash photograph per entry (Unsplash licence),
 * cropped portrait at /backdrop/menu/, chosen to be the thing the page is
 * about: a shelf for the library, a wall of trophies for achievements.
 */
export default async function MenuPage() {
  const me = await apiFetchOptional<MeResponse>('/auth/me');
  if (!me) redirect('/login');

  const entries: MenuEntry[] = [
    {
      id: 'overview',
      image: '/backdrop/menu/overview.jpg',
      label: 'Overview',
      description: 'What is happening across your platforms right now.',
      href: '/dashboard',
    },
    {
      id: 'library',
      image: '/backdrop/menu/library.jpg',
      label: 'Library',
      description: 'Everything you own and everything you have played, on one shelf.',
      href: '/library',
    },
    {
      id: 'collections',
      image: '/backdrop/menu/collections.jpg',
      label: 'Collections',
      description: 'The shelves you build yourself.',
      href: '/collections',
    },
    {
      id: 'timeline',
      image: '/backdrop/menu/timeline.jpg',
      label: 'Timeline',
      description: 'Every day your platforms could put a date on.',
      href: '/timeline',
    },
    {
      id: 'achievements',
      image: '/backdrop/menu/achievements.jpg',
      label: 'Achievements',
      description: 'Everything you have earned, platform by platform.',
      href: '/achievements',
    },
    {
      id: 'statistics',
      image: '/backdrop/menu/statistics.jpg',
      label: 'Statistics',
      description: 'The shape of a decade of playing.',
      href: '/stats',
    },
    {
      id: 'profile',
      image: '/backdrop/menu/profile.jpg',
      label: 'Profile',
      description: 'Your public page, as anyone else sees it.',
      href: `/u/${me.user.username}`,
    },
    {
      id: 'settings',
      image: '/backdrop/menu/settings.jpg',
      label: 'Settings',
      description: 'Connected accounts, imports, and what is public.',
      href: '/settings',
    },
  ];

  // Appended rather than filtered from a constant, so a non-admin never
  // receives the route in their markup at all.
  if (me.user.isAdmin) {
    entries.push({
      id: 'admin',
      image: '/backdrop/menu/admin.jpg',
      label: 'Data quality',
      description: 'Merges and matches waiting on a decision.',
      href: '/admin',
    });
  }

  return <MainMenu entries={entries} name={me.user.displayName ?? me.user.username} />;
}
