import { Suspense } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { ChooseNewPassword } from '@/components/password-reset-form';

export const metadata = { title: 'Choose a new password — OMNIPLAY' };

/**
 * The token arrives in the query string, and reading it needs
 * useSearchParams, which suspends. Without the boundary this page opts the
 * whole route out of static rendering with a build-time error.
 */
export default function ResetPasswordPage() {
  return (
    <AuthShell title="Choose a new password" subtitle="One link, one use, one hour.">
      <Suspense fallback={<div className="h-40" />}>
        <ChooseNewPassword />
      </Suspense>
    </AuthShell>
  );
}
