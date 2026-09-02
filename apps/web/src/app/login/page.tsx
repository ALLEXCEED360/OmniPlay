import { AuthForm } from '@/components/auth-form';
import { AuthShell } from '@/components/auth-shell';
import { apiFetchOptional } from '@/lib/api';

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
  const params = await searchParams;
  const error = typeof params.error === 'string' ? params.error : undefined;

  // Asked of the API rather than assumed, so an instance without Google
  // credentials renders no Google button instead of one that dead-ends.
  // Falls back to password-only if the API cannot be reached: the form still
  // works, and a sign-in page that renders nothing helps nobody.
  const methods =
    (await apiFetchOptional<Methods>('/auth/methods')) ?? { password: true, google: false };

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to your gaming identity.">
      <AuthForm mode="login" methods={methods} initialError={error} />
    </AuthShell>
  );
}
