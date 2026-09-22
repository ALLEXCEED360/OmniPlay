import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/auth-form';
import { AuthShell } from '@/components/auth-shell';
import { apiFetchOrNull } from '@/lib/api';

export const metadata = { title: 'Sign in — OMNIPLAY' };

interface Methods {
  password: boolean;
  google: boolean;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Someone already signed in has no business here; through to the title.
  if (await apiFetchOrNull('/auth/me')) redirect('/boot');

  const params = await searchParams;
  const error = typeof params.error === 'string' ? params.error : undefined;

  // Asked of the API rather than assumed, so the Google button reflects
  // whether this instance actually has credentials. Password-only if the
  // API cannot be reached: the form still works.
  const methods = (await apiFetchOrNull<Methods>('/auth/methods')) ?? { password: true, google: false };

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to your gaming identity.">
      <AuthForm mode="login" methods={methods} initialError={error} />
    </AuthShell>
  );
}
