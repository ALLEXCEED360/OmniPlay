import { AuthForm } from '@/components/auth-form';
import { AuthShell } from '@/components/auth-shell';

export const metadata = { title: 'Create account — OMNIPLAY' };

export default function RegisterPage() {
  return (
    <AuthShell
      title="Create your OMNIPLAY account"
      subtitle="One identity. Every game. Your entire gaming history."
    >
      <AuthForm mode="register" />
    </AuthShell>
  );
}
