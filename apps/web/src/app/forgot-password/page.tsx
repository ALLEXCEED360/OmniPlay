import { AuthShell } from '@/components/auth-shell';
import { RequestReset } from '@/components/password-reset-form';
import { apiFetchOptional } from '@/lib/api';

export const metadata = { title: 'Reset your password — OMNIPLAY' };

interface Methods {
  emailDelivery: boolean;
}

export default async function ForgotPasswordPage() {
  // Asked rather than assumed. If the API cannot be reached, assume no
  // delivery: promising an email that never comes is the worse failure.
  const methods = await apiFetchOptional<Methods>('/auth/methods');
  const emailDelivery = methods?.emailDelivery ?? false;

  const subtitle = emailDelivery
    ? 'Give us the address on your account and we’ll send a link to set a new password.'
    : 'Give us the address on your account and we’ll make a link to set a new password.';

  return (
    <AuthShell title="Reset your password" subtitle={subtitle}>
      <RequestReset emailDelivery={emailDelivery} />
    </AuthShell>
  );
}
