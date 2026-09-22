import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/auth-form';
import { AuthShell } from '@/components/auth-shell';
import { apiFetchOrNull } from '@/lib/api';

export const metadata = { title: 'Create account — OMNIPLAY' };

interface Methods {
  password: boolean;
  google: boolean;
}

export default async function RegisterPage() {
  if (await apiFetchOrNull('/auth/me')) redirect('/boot');

  const methods = (await apiFetchOrNull<Methods>('/auth/methods')) ?? { password: true, google: false };

  return (
    <AuthShell
      title="Create your account"
      subtitle="One history across every platform you play on."
    >
      <AuthForm mode="register" methods={methods} />
    </AuthShell>
  );
}
