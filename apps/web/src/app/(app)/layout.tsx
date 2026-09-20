import { redirect } from 'next/navigation';
import { Sidebar } from '@/components/nav';
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
 * The shell is three layers: footage at the back (`Backdrop`), the menu rail
 * down the left, and the page in front. Each page arrives through the wipe
 * in `template.tsx`.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await apiFetchOptional<MeResponse>('/auth/me');
  if (!me) redirect('/login');

  return (
    <Motion>
      <Backdrop />
      <div className="flex min-h-dvh flex-col lg:flex-row">
        <Sidebar user={me.user} />
        {/* The densest things here — a 53-week calendar, a six-column library,
            a decade table — need the width a desktop has to give. Prose is
            held to its own measure where it appears. */}
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-8 sm:py-10">
          <div className="mx-auto max-w-7xl">{children}</div>
        </main>
      </div>
    </Motion>
  );
}
