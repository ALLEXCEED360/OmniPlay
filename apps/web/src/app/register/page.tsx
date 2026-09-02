import { AuthForm } from '@/components/auth-form';
import { AuthShell } from '@/components/auth-shell';
import { apiFetchOptional } from '@/lib/api';

export const metadata = { title: 'Create account — OMNIPLAY' };

interface Methods {
  password: boolean;
  google: boolean;
}

export default async function RegisterPage() {
  // Asked of the API rather than assumed, so an instance without Google
  // credentials renders no Google button instead of one that dead-ends.
  // Falls back to password-only if the API cannot be reached: the form still
  // works, and a sign-in page that renders nothing helps nobody.
  const methods =
    (await apiFetchOptional<Methods>('/auth/methods')) ?? { password: true, google: false };

  return (
    <AuthShell title="Create your account" subtitle="One history across every platform you play on.">
      <AuthForm mode="register" methods={methods} />
    </AuthShell>
  );
}
