import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { ConfidenceNote, EmptyState, PageHeader, StatCard } from '@/components/ui';
import { TimelineFilters } from '@/components/timeline-filters';
import { TimelineYear } from '@/components/timeline-year';
import {
  dayKeyToDate,
  EVENT_KINDS,
  groupByDay,
  kindsOf,
  type EventKind,
  type TimelineEntry,
} from '@/lib/timeline';

/**
 * The gaming timeline (spec 4.3).
 *
 * Shown as a calendar of days rather than a feed of rows. The feed could only
 * render its first sixty entries per year, so a decade of history arrived
 * pre-truncated — and a list answers "what is the 47th thing I did", which is
 * not a question anyone has. A year of days answers the real one: when was I
 * playing, and when did I stop.
 *
 * Only events that can honestly be placed in time appear at all. A Steam
 * lifetime total has no date, and pinning it to the day we happened to sync
 * would fabricate history, so it is absent and the page says so. PlayStation
 * changed the character of this page entirely: it dates every trophy, which is
 * why the grid has ten years in it rather than a handful of Xbox unlocks.
 */

interface TimelineYearData {
  year: number;
  entries: TimelineEntry[];
}

export default async function TimelinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const years = await apiFetch<TimelineYearData[]>('/stats/timeline');

  const asList = (value: string | string[] | undefined): string[] =>
    typeof value === 'string' ? value.split(',').filter(Boolean) : [];

  const activeKinds = asList(params.kinds);
  const activeProviders = asList(params.providers);

  // Counts come from the unfiltered set so a chip always shows how much it
  // would bring back, not how much is currently visible.
  // Built from EVENT_KINDS rather than written out, so adding a kind cannot
  // leave it silently uncounted: a hand-written initialiser missed the new
  // "Started" key, every increment produced NaN, and the chip hid itself
  // because NaN > 0 is false — with 144 events behind it.
  const counts = Object.fromEntries(EVENT_KINDS.map((kind) => [kind.id, 0])) as Record<
    EventKind,
    number
  >;
  const providers = new Set<string>();

  for (const year of years) {
    for (const entry of year.entries) {
      for (const kind of kindsOf(entry)) counts[kind] += 1;
      if (entry.provider) providers.add(entry.provider);
    }
  }

  const visible = years
    .map((year) => ({
      year: year.year,
      entries: year.entries.filter((entry) => {
        const kinds = kindsOf(entry);
        const kindOk =
          activeKinds.length === 0 || kinds.some((kind) => activeKinds.includes(kind));
        const providerOk =
          activeProviders.length === 0 ||
          (entry.provider !== null && activeProviders.includes(entry.provider));
        return kindOk && providerOk;
      }),
    }))
    .filter((year) => year.entries.length > 0)
    .sort((a, b) => b.year - a.year);

  const isFiltered = activeKinds.length > 0 || activeProviders.length > 0;

  if (years.length === 0) {
    return (
      <>
        <PageHeader title="Timeline" subtitle="Your gaming life, in order." />
        <EmptyState
          title="No dated history yet"
          description="Your connected platforms report total playtime without saying when those hours happened. Achievement unlocks are dated, so they will appear here as you earn them."
          action={
            <Link
              href="/settings"
              className="btn-ghost"
            >
              Connect another account
            </Link>
          }
        />
      </>
    );
  }

  const allVisible = visible.flatMap((year) => year.entries);
  const days = groupByDay(allVisible);

  // Shading is scaled to the busiest day in the whole history, not per year,
  // so a quiet year reads as quiet instead of being stretched to look full.
  const busiest = days.reduce(
    (top, day) => Math.max(top, day.achievements, day.games),
    0,
  );
  const busiestDay = days.reduce<(typeof days)[number] | null>(
    (top, day) =>
      !top || Math.max(day.achievements, day.games) > Math.max(top.achievements, top.games)
        ? day
        : top,
    null,
  );

  const totalEvents = allVisible.reduce(
    (sum, entry) => sum + Math.max(1, entry.achievements),
    0,
  );

  const span =
    visible.length > 0
      ? `${visible[visible.length - 1]?.year}–${visible[0]?.year}`
      : '—';

  return (
    <>
      <PageHeader
        eyebrow="Ten years, day by day"
        title="Timeline"
        subtitle={
          isFiltered
            ? `${days.length} active days match`
            : 'Every day your platforms could actually date'
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Active days" value={days.length.toLocaleString()} accent index={0} />
        <StatCard label="Years" value={visible.length} hint={span} index={1} />
        <StatCard label="Dated events" value={totalEvents.toLocaleString()} index={2} />
        <StatCard
          label="Busiest day"
          value={busiestDay ? String(Math.max(busiestDay.achievements, busiestDay.games)) : '—'}
          hint={busiestDay ? formatDate(dayKeyToDate(busiestDay.key)) : undefined}
          index={3}
        />
      </div>

      <div className="mt-6">
        <TimelineFilters providers={[...providers].sort()} counts={counts} />
      </div>

      {days.length === 0 ? (
        <EmptyState
          title="Nothing matches those filters"
          description="Try turning another kind of event back on."
        />
      ) : (
        <div className="mt-8 space-y-12">
          {visible.map((year, index) => (
            <TimelineYear
              key={year.year}
              year={year.year}
              entries={year.entries}
              busiestOverall={busiest}
              defaultOpen={index === 0}
            />
          ))}
        </div>
      )}

      <p className="mt-10">
        <ConfidenceNote>
          Only events a platform put a date on appear here. Steam reports playtime as an
          undated lifetime total, so its hours cannot be placed on any particular day — the
          grid would be inventing them. PlayStation dates every trophy, and Xbox dates most
          of its achievements.
        </ConfidenceNote>
      </p>
    </>
  );
}
