'use client';

import { useRouter } from 'next/navigation';
import type { CSSProperties } from 'react';
import { useState } from 'react';
import { formatRelative } from '@/lib/format';
import { platformStyle } from '@/lib/platform';
import { ImportPanel } from './import-panel';
import { ProviderSetup } from './provider-setup';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

interface Props {
  provider: {
    id: string;
    displayName: string;
    access: 'api' | 'import';
    configured: boolean;
    missingEnv: string[];
    setupUrl: string | null;
    setupHint: string | null;
    importReason: string | null;
    exportUrl: string | null;
    capabilities: { importOnly: boolean } | null;
    connected: {
      displayName: string | null;
      avatar: string | null;
      status: string;
      statusMessage: string | null;
      connectedAt: string;
      lastSyncAt: string | null;
    } | null;
  };
}

/**
 * One connected-account row, with connect and disconnect (spec 23).
 *
 * Disconnecting asks a second question - unlink, or unlink and erase - because
 * they are genuinely different intentions and the destructive one is
 * irreversible.
 */
export function ProviderCard({ provider }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connection = provider.connected;
  const needsReauth = connection?.status === 'REAUTH_REQUIRED';
  // `access` comes from the catalogue and is known even when the adapter is
  // not registered; `capabilities` is null until it is.
  const isImport = provider.access === 'import';

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${API_URL}/providers/${provider.id}/connect`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        setError(body?.message ?? 'Could not start the connection.');
        return;
      }
      const result = (await response.json()) as
        | { redirectUrl: string }
        | { connected: true };

      // A key-based provider (OpenXBL) connects server-side with no redirect,
      // so there is nothing to navigate to — just show the result.
      if ('connected' in result) {
        router.refresh();
        setBusy(false);
        return;
      }

      // Full navigation, not a fetch: the provider needs to see the browser.
      window.location.href = result.redirectUrl;
    } catch {
      setError('Could not reach OMNIPLAY. Check your connection and try again.');
      setBusy(false);
    }
  }

  async function disconnect(deleteData: boolean) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `${API_URL}/providers/${provider.id}?deleteData=${deleteData}`,
        { method: 'DELETE', credentials: 'include' },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        setError(body?.message ?? 'Could not disconnect.');
        return;
      }
      setConfirming(false);
      router.refresh();
    } catch {
      setError('Could not reach OMNIPLAY. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  const style = platformStyle(provider.id);

  return (
    <div
      style={{ '--bloom': style.bloom } as CSSProperties}
      className={`card bloom p-5 transition-colors ${connection ? `ring-1 ${style.ring}` : ''}`}
    >
      <div className="relative flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span
            className={`grid size-10 shrink-0 place-items-center rounded-lg text-sm font-semibold ${
              connection ? `bg-ink-850 ${style.text}` : 'bg-ink-850 text-ink-500'
            }`}
          >
            {provider.displayName.slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0">
            <div className="font-medium text-ink-100">{provider.displayName}</div>
            {connection ? (
              <div className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-ink-500">
                {/* A live dot rather than the word "connected" repeated: the
                    row already carries the account name. */}
                <span className={`size-1.5 shrink-0 rounded-full ${style.bar}`} aria-hidden />
                {connection.displayName ?? 'Connected'} · last synced{' '}
                {formatRelative(connection.lastSyncAt)}
              </div>
            ) : (
              <div className="mt-0.5 text-xs text-ink-600">Not connected</div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {connection ? (
            <>
              {needsReauth ? (
                <button
                  type="button"
                  onClick={() => void connect()}
                  disabled={busy}
                  className="rounded-lg bg-warning px-3 py-1.5 text-xs font-medium text-ink-950 transition-transform duration-150 active:scale-95 disabled:opacity-60"
                >
                  Reconnect
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setConfirming(true)}
                disabled={busy}
                className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-ink-300 transition-all duration-150 hover:bg-ink-850 hover:text-ink-100 active:scale-95 disabled:opacity-60"
              >
                Disconnect
              </button>
            </>
          ) : isImport ? (
            // No connect button: there is nothing to sign in to. The panel
            // below is the whole flow.
            <span className="text-xs text-ink-600">Import only</span>
          ) : provider.configured ? (
            <button
              type="button"
              onClick={() => void connect()}
              disabled={busy}
              className="btn-primary btn-sm"
            >
              {busy ? 'Opening…' : `Connect ${provider.displayName}`}
            </button>
          ) : (
            <span className="text-xs text-ink-600">Needs setup</span>
          )}
        </div>
      </div>

      {needsReauth && connection?.statusMessage ? (
        <p className="anim-fade mt-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-ink-200">
          {connection.statusMessage} Your existing data is safe.
        </p>
      ) : null}

      {error ? <p className="anim-fade mt-3 text-xs text-danger">{error}</p> : null}

      {/* Setup guidance for anything not ready to connect. */}
      {!provider.configured || isImport ? <ProviderSetup provider={provider} /> : null}

      {isImport && provider.configured ? (
        <ImportPanel provider={provider.id} displayName={provider.displayName} />
      ) : null}

      {confirming ? (
        <div className="anim-rise mt-4 rounded-lg border border-ink-800 bg-ink-950/60 p-4">
          <p className="text-sm text-ink-200">Disconnect {provider.displayName}?</p>
          <p className="mt-1 text-xs text-ink-500">
            You can keep the games already imported, or remove everything that came from this
            account. Removing is permanent.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void disconnect(false)}
              disabled={busy}
              className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-ink-200 hover:bg-ink-850 disabled:opacity-60"
            >
              Disconnect, keep my data
            </button>
            <button
              type="button"
              onClick={() => void disconnect(true)}
              disabled={busy}
              className="rounded-lg bg-danger px-3 py-1.5 text-xs font-medium text-ink-100 disabled:opacity-60"
            >
              Disconnect and delete imported data
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="rounded-lg px-3 py-1.5 text-xs text-ink-400 hover:text-ink-200"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
