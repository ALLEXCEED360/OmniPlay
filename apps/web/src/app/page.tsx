import { redirect } from 'next/navigation';
import { apiFetchOptional } from '@/lib/api';

/**
 * Root entry. Sends signed-in users straight to their dashboard and everyone
 * else to sign-up, so there is no marketing page to maintain while the product
 * is still being built.
 */
export default async function HomePage() {
  const me = await apiFetchOptional<{ user: unknown }>('/auth/me');
  redirect(me ? '/dashboard' : '/register');
}
