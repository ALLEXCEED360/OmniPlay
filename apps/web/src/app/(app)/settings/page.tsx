import { apiFetch } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { PageHeader, SectionHeading } from '@/components/ui';
import { ProviderCard } from '@/components/provider-card';
import { ProfileSettings } from '@/components/profile-settings';

/**
 * Settings (spec 16, 23, 24).
 *
 * Two jobs: manage connections, and tell the user exactly what OMNIPLAY has
 * imported from each one. The capability matrix is rendered from what each
 * adapter declares, so it cannot drift out of step with what the code does.
 */

interface ProviderEntry {
  id: string;
  displayName: string;
  access: 'api' | 'import';
  configured: boolean;
  missingEnv: string[];
  setupUrl: string | null;
  setupHint: string | null;
  importReason: string | null;
  exportUrl: string | null;
  capabilities: {
    library: 'none' | 'partial' | 'full';
    playtime: 'none' | 'partial' | 'full';
    achievements: 'none' | 'partial' | 'full';
    playHistory: 'none' | 'partial' | 'full';
    profile: 'none' | 'partial' | 'full';
    incrementalSync: boolean;
    importOnly: boolean;
  } | null;
  connected: {
    id: string;
    provider: string;
    displayName: string | null;
    avatar: string | null;
    status: string;
    statusMessage: string | null;
    connectedAt: string;
    lastSyncAt: string | null;
  } | null;
}

interface ProfileUser {
  username: string;
  displayName: string | null;
  bio: string | null;
  profilePublic: boolean;
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const [providers, me] = await Promise.all([
    apiFetch<ProviderEntry[]>('/providers'),
    apiFetch<{ user: ProfileUser }>('/auth/me'),
  ]);

  const error = typeof params.error === 'string' ? params.error : null;
  const connected = typeof params.connected === 'string' ? params.connected : null;

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Manage connected accounts, see what has been imported, and control your data."
      />

      {/* Callbacks land back here with a result to report. */}
      {error ? (
        <div
          role="alert"
          className="mb-6 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-ink-200"
        >
          {error}
        </div>
      ) : null}
      {connected ? (
        <div
          role="status"
          className="mb-6 rounded-lg border border-positive/30 bg-positive/10 px-4 py-3 text-sm text-ink-200"
        >
          {connected} connected. Your first sync is running now.
        </div>
      ) : null}

      <section>
        <SectionHeading>Connected accounts</SectionHeading>
        {providers.length === 0 ? (
          <div className="card p-6 text-sm text-ink-400">
            No providers are configured on this instance. Set <code className="text-ink-200">STEAM_API_KEY</code>{' '}
            or <code className="text-ink-200">XBOX_CLIENT_ID</code> to enable them.
          </div>
        ) : (
          <div className="space-y-4">
            {providers.map((provider) => (
              <ProviderCard key={provider.id} provider={provider} />
            ))}
          </div>
        )}
      </section>

      <section className="mt-10">
        <SectionHeading>Your public profile</SectionHeading>
        <ProfileSettings user={me.user} />
      </section>

      <section className="mt-10">
        <SectionHeading>What OMNIPLAY has imported</SectionHeading>
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[36rem] text-sm">
            <caption className="sr-only">
              Data imported from each connected provider, and the completeness of each category
            </caption>
            <thead>
              <tr className="border-b border-ink-850 text-left text-xs uppercase tracking-wider text-ink-500">
                <th scope="col" className="px-4 py-3 font-medium">Provider</th>
                <th scope="col" className="px-4 py-3 font-medium">Library</th>
                <th scope="col" className="px-4 py-3 font-medium">Playtime</th>
                <th scope="col" className="px-4 py-3 font-medium">Achievements</th>
                <th scope="col" className="px-4 py-3 font-medium">History</th>
                <th scope="col" className="px-4 py-3 font-medium">Last sync</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-850">
              {providers.map((provider) => (
                <tr key={provider.id}>
                  <th scope="row" className="px-4 py-3 text-left font-medium text-ink-200">
                    {provider.displayName}
                  </th>
                  <Capability level={provider.capabilities?.library ?? null} />
                  <Capability level={provider.capabilities?.playtime ?? null} />
                  <Capability level={provider.capabilities?.achievements ?? null} />
                  <Capability level={provider.capabilities?.playHistory ?? null} />
                  <td className="px-4 py-3 text-ink-500">
                    {provider.connected?.lastSyncAt
                      ? formatRelative(provider.connected.lastSyncAt)
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-ink-500">
          <strong className="text-ink-400">Partial</strong> means the provider supports the category
          but does not guarantee completeness. Xbox&rsquo;s history, for example, is derived from
          achievement activity and is not a full record of every game launched.
        </p>
      </section>
    </>
  );
}

function Capability({ level }: { level: 'none' | 'partial' | 'full' | null }) {
  // Null means the adapter is not configured, so we genuinely do not know what
  // it would report — distinct from knowing it offers nothing.
  if (level === null) {
    return <td className="px-4 py-3 text-ink-700">—</td>;
  }

  const display = {
    full: { label: 'Yes', className: 'text-positive' },
    partial: { label: 'Partial', className: 'text-warning' },
    none: { label: 'Not available', className: 'text-ink-600' },
  }[level];

  return <td className={`px-4 py-3 ${display.className}`}>{display.label}</td>;
}
