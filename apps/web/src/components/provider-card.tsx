'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { formatRelative } from '@/lib/format';
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
      const { redirectUrl } = (await response.json()) as { redirectUrl: string };
      // Full navigation, not a fetch: the provider needs to see the browser.
      window.location.href = redirectUrl;
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

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-ink-850 text-sm font-semibold text-ink-300">
            {provider.displayName.slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0">
            <div className="font-medium text-ink-100">{provider.displayName}</div>
            {connection ? (
              <div className="mt-0.5 truncate text-xs text-ink-500">
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
                  className="rounded-lg bg-warning px-3 py-1.5 text-xs font-medium text-ink-950 disabled:opacity-60"
                >
                  Reconnect
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setConfirming(true)}
                disabled={busy}
                className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-ink-300 transition-colors hover:bg-ink-850 disabled:opacity-60"
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
              className="rounded-lg bg-accent px-4 py-1.5 text-xs font-medium text-ink-950 transition-colors hover:bg-accent-strong disabled:opacity-60"
            >
              {busy ? 'Opening…' : `Connect ${provider.displayName}`}
            </button>
          ) : (
            <span className="text-xs text-ink-600">Needs setup</span>
          )}
        </div>
      </div>

      {needsReauth && connection?.statusMessage ? (
        <p className="mt-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-ink-200">
          {connection.statusMessage} Your existing data is safe.
        </p>
      ) : null}

      {error ? <p className="mt-3 text-xs text-danger">{error}</p> : null}

      {/* Setup guidance for anything not ready to connect. */}
      {!provider.configured || isImport ? <ProviderSetup provider={provider} /> : null}

      {isImport && provider.configured ? (
        <ImportPanel provider={provider.id} displayName={provider.displayName} />
      ) : null}

      {confirming ? (
        <div className="mt-4 rounded-lg border border-ink-800 bg-ink-950/60 p-4">
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
