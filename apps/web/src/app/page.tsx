import { redirect } from 'next/navigation';
import { apiFetchOptional } from '@/lib/api';

/**
 * Root entry. Sends signed-in users to the main menu and everyone else to
 * sign-up, so there is no marketing page to maintain while the product is
 * still being built. The menu rather than the dashboard: a signed-in open
 * is a return to the game, and the game opens on its menu.
 */
export default async function HomePage() {
  const me = await apiFetchOptional<{ user: unknown }>('/auth/me');
  redirect(me ? '/menu' : '/register');
}
