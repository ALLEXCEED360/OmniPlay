import { AuthShell } from '@/components/auth-shell';
import { RequestReset } from '@/components/password-reset-form';
import { apiFetchOrNull } from '@/lib/api';

export const metadata = { title: 'Reset your password — OMNIPLAY' };

interface Methods {
  emailDelivery: boolean;
}

export default async function ForgotPasswordPage() {
  // Asked rather than assumed. If the API cannot be reached, assume no
  // delivery: promising an email that never comes is the worse failure.
  const methods = await apiFetchOrNull<Methods>('/auth/methods');
  const emailDelivery = methods?.emailDelivery ?? false;

  return (
    <AuthShell
      title="Reset your password"
      subtitle={
        emailDelivery
          ? 'Enter the email on your OMNIPLAY account and we will send a link to choose a new one.'
          : 'Enter the email on your OMNIPLAY account and we will make a link to choose a new one.'
      }
    >
      <RequestReset emailDelivery={emailDelivery} />
    </AuthShell>
  );
}
