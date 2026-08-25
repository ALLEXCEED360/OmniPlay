import { AuthForm } from '@/components/auth-form';
import { AuthShell } from '@/components/auth-shell';

export const metadata = { title: 'Sign in — OMNIPLAY' };

export default function LoginPage() {
  return (
    <AuthShell title="Welcome back" subtitle="Sign in to your gaming identity.">
      <AuthForm mode="login" />
    </AuthShell>
  );
}
