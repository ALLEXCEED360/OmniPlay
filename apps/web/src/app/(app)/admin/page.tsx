import type { CSSProperties } from 'react';
import { ApiError, apiFetch } from '@/lib/api';
import { formatRelative, providerLabel } from '@/lib/format';
import { PageHeader, SectionHeading, StatCard } from '@/components/ui';
import {
  EnrichButton,
  MergeDuplicates,
  SweepQueueButton,
  UnresolvedQueue,
} from '@/components/admin-tools';
import { notFound } from 'next/navigation';

/**
 * Data-quality tools (spec 26).
 *
 * Automatic matching is tuned to defer rather than guess, so a queue of
 * decisions accumulates by design. This page is what drains it — without it
 * the resolver's caution turns into a permanent backlog of provisional rows.
 */

interface Overview {
  games: number;
  provisional: number;
  unresolvedPending: number;
  merged: number;
  failedSyncs: number;
  duplicateCandidates: number;
}

interface UnresolvedRecord {
  id: string;
  provider: string;
  externalId: string;
  externalName: string;
  hitCount: number;
  createdAt: string;
  candidates: Array<{ gameId: string; name: string; coverImage: string | null; score: number }>;
}

interface ProvisionalGame {
  id: string;
  name: string;
  slug: string;
  metadataSyncedAt: string | null;
  _count: { ownerships: number; externalIds: number };
}

interface DuplicateGroup {
  normalizedName: string;
  games: Array<{ id: string; name: string }>;
}

interface SyncFailure {
  id: string;
  provider: string;
  status: string;
  error: string | null;
  errorKind: string | null;
  createdAt: string;
  user: { username: string };
}

export default async function AdminPage() {
  let overview: Overview;
  let unresolved: { total: number; records: UnresolvedRecord[] };
  let provisional: { total: number; games: ProvisionalGame[] };
  let duplicates: DuplicateGroup[];
  let failures: SyncFailure[];

  try {
    [overview, unresolved, provisional, duplicates, failures] = await Promise.all([
      apiFetch<Overview>('/admin/overview'),
      apiFetch<{ total: number; records: UnresolvedRecord[] }>('/admin/unresolved?pageSize=25'),
      apiFetch<{ total: number; games: ProvisionalGame[] }>('/admin/games/provisional?pageSize=25'),
      apiFetch<DuplicateGroup[]>('/admin/games/duplicates'),
      apiFetch<SyncFailure[]>('/admin/sync-failures'),
    ]);
  } catch (error) {
    // A non-admin gets a 403 that the guard words as "Not found"; render the
    // 404 page so this surface stays invisible to them.
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) notFound();
    throw error;
  }

  return (
    <>
      <PageHeader
        eyebrow="What matching would not guess"
        title="Data quality"
        subtitle="Resolve what automatic matching would not guess at."
        action={<EnrichButton />}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Canonical games" value={overview.games} index={0} />
        <StatCard
          label="To resolve"
          value={overview.unresolvedPending}
          accent={overview.unresolvedPending > 0}
          index={1}
        />
        <StatCard label="No metadata" value={overview.provisional} index={2} />
        <StatCard label="Duplicates" value={overview.duplicateCandidates} index={3} />
        <StatCard label="Failed syncs" value={overview.failedSyncs} index={4} />
      </div>

      <section className="anim-rise mt-10">
        <SectionHeading>
          Unresolved provider records{' '}
          {unresolved.total > 0 ? (
            <span className="text-ink-600">({unresolved.total})</span>
          ) : null}
        </SectionHeading>

        {unresolved.records.length === 0 ? (
          <p className="card p-6 text-sm text-ink-500">
            Nothing waiting. Every provider record has been matched to a canonical game.
          </p>
        ) : (
          <>
            <SweepQueueButton />
            <UnresolvedQueue records={unresolved.records} />
          </>
        )}
      </section>

      {duplicates.length > 0 ? (
        <section className="anim-rise mt-10">
          <SectionHeading>Possible duplicate games</SectionHeading>
          <p className="mb-4 text-xs text-ink-500">
            These share a normalised title. Editions have already been stripped and version
            markers preserved, so a remake will not appear here as a duplicate of its original.
            Merging is not reversible from this screen.
          </p>
          <MergeDuplicates groups={duplicates} />
        </section>
      ) : null}

      <section className="anim-rise mt-10">
        <SectionHeading>
          Games without metadata{' '}
          {provisional.total > 0 ? (
            <span className="text-ink-600">({provisional.total})</span>
          ) : null}
        </SectionHeading>

        {provisional.games.length === 0 ? (
          <p className="card p-6 text-sm text-ink-500">
            Every canonical game has IGDB metadata.
          </p>
        ) : (
          <div className="card divide-y divide-ink-850">
            {provisional.games.map((game, index) => (
              <div
                key={game.id}
                style={{ '--i': index, '--stagger-step': '35ms' } as CSSProperties}
                className="anim-fade stagger flex flex-wrap items-center justify-between gap-3 p-4 transition-colors hover:bg-ink-850/40"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm text-ink-200">{game.name}</div>
                  <div className="mt-0.5 text-xs text-ink-600">
                    {game._count.ownerships} owner{game._count.ownerships === 1 ? '' : 's'} ·{' '}
                    {game._count.externalIds} store id
                    {game._count.externalIds === 1 ? '' : 's'}
                    {game.metadataSyncedAt
                      ? ` · IGDB found no confident match ${formatRelative(game.metadataSyncedAt)}`
                      : ' · not yet attempted'}
                  </div>
                </div>
                <EnrichButton gameId={game.id} label="Retry IGDB" />
              </div>
            ))}
          </div>
        )}
      </section>

      {failures.length > 0 ? (
        <section className="anim-rise mt-10">
          <SectionHeading>Recent sync problems</SectionHeading>
          <div className="card divide-y divide-ink-850">
            {failures.map((failure, index) => (
              <div
                key={failure.id}
                style={{ '--i': index, '--stagger-step': '40ms' } as CSSProperties}
                className="anim-fade stagger p-4 transition-colors hover:bg-ink-850/40"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm text-ink-200">
                    {providerLabel(failure.provider)}{' '}
                    <span className="text-ink-600">· @{failure.user.username}</span>
                  </span>
                  <span
                    className={`inline-flex items-center gap-1.5 text-xs ${
                      failure.status === 'FAILED' ? 'text-danger' : 'text-warning'
                    }`}
                  >
                    <span
                      className={`size-1.5 rounded-full ${
                        failure.status === 'FAILED' ? 'bg-danger' : 'bg-warning'
                      }`}
                      aria-hidden
                    />
                    {failure.status}
                    {failure.errorKind ? ` · ${failure.errorKind}` : ''}
                  </span>
                </div>
                {failure.error ? (
                  <p className="mt-1 text-xs text-ink-500">{failure.error}</p>
                ) : null}
                <p className="mt-1 text-xs text-ink-600">{formatRelative(failure.createdAt)}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
