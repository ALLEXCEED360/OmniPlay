import { redirect } from 'next/navigation';
import { BootScreen } from '@/components/boot-screen';
import { apiFetchOptional } from '@/lib/api';

export const metadata = { title: 'OMNIPLAY' };

interface MeResponse {
  user: { username: string; displayName: string | null };
}

/**
 * The title screen, sitting between signing in and the menu.
 *
 * Outside the `(app)` group on purpose: it has no rail, no backdrop of its
 * own to inherit, and nothing behind it to tab into. Sign-in, registration,
 * password reset and Google all land here; the root route does not, so a
 * returning tab goes straight to the menu rather than through the title
 * every time.
 */
export default async function BootPage() {
  const me = await apiFetchOptional<MeResponse>('/auth/me');
  if (!me) redirect('/login');

  return <BootScreen name={me.user.displayName ?? me.user.username} />;
}
