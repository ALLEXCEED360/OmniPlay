'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useTransition } from 'react';
import { providerLabel } from '@/lib/format';
import { EVENT_KINDS, type EventKind } from '@/lib/timeline';

/**
 * Timeline filters.
 *
 * State lives in the URL, matching the library's filter bar: a filtered view
 * survives a refresh, is shareable, and the back button behaves. Filtering
 * happens on the already-fetched entries rather than server-side, because the
 * timeline is a bounded list and a round-trip per chip would feel worse than
 * the render it saves.
 */

export function TimelineFilters({
  providers,
  counts,
}: {
  providers: string[];
  counts: Record<EventKind, number>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const update = useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set(key, value);
      else params.delete(key);
      startTransition(() => router.push(`${pathname}?${params.toString()}`, { scroll: false }));
    },
    [pathname, router, searchParams],
  );

  const toggleInList = useCallback(
    (key: string, value: string, all: string[]) => {
      const current = (searchParams.get(key) ?? '').split(',').filter(Boolean);
      // An empty parameter means "everything", so the first click has to start
      // from the full set and remove one — otherwise unticking a box would
      // read as selecting only that box.
      const base = current.length > 0 ? current : all;
      const next = base.includes(value)
        ? base.filter((item) => item !== value)
        : [...base, value];

      // Back to everything selected: drop the parameter rather than listing
      // every value, so the URL stays clean.
      update(key, next.length === 0 || next.length === all.length ? null : next.join(','));
    },
    [searchParams, update],
  );

  // Only kinds this library actually contains.
  //
  // A chip that can never match anything is not a disabled control, it is
  // clutter: "Added" stays empty until a file import supplies acquisition
  // dates, because no platform API reports when a game was bought. Hiding it
  // is honest — the filter reappears the moment the data does.
  const presentKinds = EVENT_KINDS.filter((kind) => counts[kind.id] > 0);
  const allKinds = presentKinds.map((kind) => kind.id);
  const activeKinds = (searchParams.get('kinds') ?? '').split(',').filter(Boolean);
  const activeProviders = (searchParams.get('providers') ?? '').split(',').filter(Boolean);

  const isKindOn = (kind: string) => activeKinds.length === 0 || activeKinds.includes(kind);
  const isProviderOn = (provider: string) =>
    activeProviders.length === 0 || activeProviders.includes(provider);

  const filtered = activeKinds.length > 0 || activeProviders.length > 0;

  return (
    <div className={`mb-8 space-y-3 ${pending ? 'opacity-70' : ''} transition-opacity`}>
      <div className="flex flex-wrap items-center gap-2">
        {presentKinds.map((kind) => {
          const on = isKindOn(kind.id);
          const count = counts[kind.id];

          return (
            <button
              key={kind.id}
              type="button"
              aria-pressed={on}
              onClick={() => toggleInList('kinds', kind.id, allKinds)}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                on
                  ? 'border-ink-600 bg-ink-800 text-ink-100'
                  : 'border-ink-850 text-ink-500 hover:border-ink-700 hover:text-ink-300'
              }`}
            >
              <span
                className={`size-2 rounded-full ${on ? kind.dot : 'bg-ink-700'}`}
                aria-hidden
              />
              {kind.label}
              <span className="stat-figure text-ink-600">{count}</span>
            </button>
          );
        })}
      </div>

      {providers.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2">
          {providers.map((provider) => {
            const on = isProviderOn(provider);
            return (
              <button
                key={provider}
                type="button"
                aria-pressed={on}
                onClick={() => toggleInList('providers', provider, providers)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  on
                    ? 'border-accent/40 bg-accent/15 text-accent'
                    : 'border-ink-850 text-ink-500 hover:border-ink-700 hover:text-ink-300'
                }`}
              >
                {providerLabel(provider)}
              </button>
            );
          })}
        </div>
      ) : null}

      {filtered ? (
        <button
          type="button"
          onClick={() =>
            startTransition(() => router.push(pathname, { scroll: false }))
          }
          className="text-xs text-ink-500 underline underline-offset-2 hover:text-ink-300"
        >
          Show everything
        </button>
      ) : null}
    </div>
  );
}
