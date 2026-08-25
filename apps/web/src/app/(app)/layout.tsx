import { redirect } from 'next/navigation';
import { Sidebar } from '@/components/nav';
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
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await apiFetchOptional<MeResponse>('/auth/me');
  if (!me) redirect('/login');

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <Sidebar user={me.user} />
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-8 sm:py-10">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
