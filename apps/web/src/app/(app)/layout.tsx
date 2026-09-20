import { redirect } from 'next/navigation';
import { Hud } from '@/components/hud';
import { Backdrop } from '@/components/backdrop';
import { Motion } from '@/components/motion';
import { apiFetchOptional } from '@/lib/api';

interface MeResponse {
  user: {
    id: string;
    username: string;
    displayName: string | null;
    avatar: string | null;
    isAdmin?: boolean;
  };
}

/**
 * Authenticated shell.
 *
 * The session is resolved server-side on every request. An expired cookie
 * redirects to sign-in rather than rendering a shell full of empty states.
 *
 * The shell is three layers: footage at the back (`Backdrop`), one thin
 * bar across the top (`Hud`) with the way back to the menu, and the page.
 * There is no sidebar: the menu is the navigation, and every page is a
 * screen you opened from it. Each page arrives through the wipe in
 * `template.tsx`.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await apiFetchOptional<MeResponse>('/auth/me');
  if (!me) redirect('/login');

  return (
    <Motion>
      <Backdrop />
      <div className="flex min-h-dvh flex-col">
        <Hud user={me.user} />
        {/* The densest things here — a 53-week calendar, a six-column library,
            a decade table — need the width a desktop has to give. Prose is
            held to its own measure where it appears. */}
        {/* The board runs the width of the screen. A 1280px cap left a
            third of a wide monitor black on either side; the pages are
            laid out in columns that want the room. */}
        <main className="min-w-0 flex-1 px-4 pb-16 pt-6 sm:px-8 sm:pt-8 2xl:px-12">
          <div className="mx-auto max-w-[1920px]">{children}</div>
        </main>
      </div>
    </Motion>
  );
}
