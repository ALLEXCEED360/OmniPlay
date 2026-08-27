import { formatDate, formatHours, providerLabel } from '@/lib/format';
import { PlatformBadge } from '@/components/ui';

/**
 * What each platform knows about one game.
 *
 * The panel exists because a blank cell is ambiguous and the ambiguity matters.
 * "No playtime" means one thing on Steam, which reports hours for every game it
 * sells you, and something entirely different on Xbox, which reports them only
 * for titles that answer a separate stats call. Without saying which, the page
 * leaves the reader to assume — and the assumption is usually "I never played
 * this", which is the wrong one.
 *
 * So every row is answered in two parts: what we hold, and where we hold
 * nothing, whether the platform could have told us.
 */

type Level = 'none' | 'partial' | 'full';
type PlaytimeState = 'REPORTED' | 'ZERO' | 'NOT_REPORTED' | 'PENDING';

export interface PlatformReportRow {
  provider: string;
  capabilities: {
    library: Level;
    playtime: Level;
    achievements: Level;
    playHistory: Level;
  } | null;
  ownership: { type: string; confidence: string; removed: boolean; removedAt: string | null } | null;
  minutes: number;
  playtime: PlaytimeState;
  firstPlayedAt: string | null;
  lastPlayedAt: string | null;
  achievements: { unlocked: number; total: number } | null;
}

/** One line's worth of answer: a value, and why it reads the way it does. */
interface Cell {
  value: string;
  /** Muted when the value is an absence rather than a figure. */
  known: boolean;
  note?: string | undefined;
}

/**
 * How an entitlement reads to a person.
 *
 * "Digital" and "physical" describe *delivery*, which is the least interesting
 * thing about owning a game — on a Steam row it is trivially true and tells
 * the reader nothing. What matters is whether the game is yours permanently or
 * only while a subscription lasts, so both purchase routes read as
 * "Purchased" and the disc, where we know it, moves to the note.
 */
function ownershipLabel(type: string): string {
  switch (type) {
    case 'DIGITAL':
    case 'PHYSICAL':
      return 'Purchased';
    case 'SUBSCRIPTION':
      return 'Subscription';
    case 'FAMILY_SHARE':
      return 'Family share';
    case 'MANUAL':
      return 'Added by you';
    case 'GIFT':
      return 'Gift';
    default:
      return type.toLowerCase().replace('_', ' ');
  }
}

function ownershipCell(row: PlatformReportRow): Cell {
  if (row.ownership) {
    // "Previously owned" is part of the history this app exists to keep, so
    // the date it left is worth as much as the fact that it did.
    const removed = row.ownership.removedAt
      ? `Left your library ${formatDate(row.ownership.removedAt)}`
      : row.ownership.removed
        ? 'No longer in your library'
        : null;

    // Provenance belongs here: PlayStation's entitlement is inferred from an
    // undocumented field, and the page should not pass that off as fact.
    const provenance =
      row.ownership.confidence === 'VERIFIED'
        ? 'Stated by the platform'
        : 'Inferred from provider data';

    // The disc is not thrown away, only demoted — it is a genuine fact about
    // how this copy was acquired, just not the headline one.
    const onDisc = row.ownership.type === 'PHYSICAL' ? 'On disc' : null;

    return {
      value: ownershipLabel(row.ownership.type),
      known: !row.ownership.removed,
      note: removed ?? [onDisc, provenance].filter(Boolean).join(' · '),
    };
  }

  // Xbox declares `library: partial` precisely because its title history says
  // what was played, not what was bought.
  if (row.capabilities?.library === 'partial') {
    return { value: 'Not reported', known: false, note: 'This platform reports play, not purchases' };
  }
  return { value: 'Not owned here', known: false };
}

function playtimeCell(row: PlatformReportRow): Cell {
  switch (row.playtime) {
    case 'REPORTED':
      return { value: formatHours(row.minutes), known: true };
    case 'ZERO':
      return { value: '0h', known: true, note: 'This platform reports hours for every game' };
    case 'NOT_REPORTED':
      return { value: 'Not reported', known: false, note: 'Asked, and the platform held nothing' };
    default:
      return { value: 'Not fetched', known: false, note: 'Run a sync to fetch it' };
  }
}

function datedPlayCell(row: PlatformReportRow): Cell {
  if (row.firstPlayedAt || row.lastPlayedAt) {
    const first = row.firstPlayedAt ? formatDate(row.firstPlayedAt) : null;
    const last = row.lastPlayedAt ? formatDate(row.lastPlayedAt) : null;
    if (first && last && first !== last) return { value: `${first} → ${last}`, known: true };
    return { value: (first ?? last) as string, known: true };
  }

  // Steam is the honest example: it reports hours for everything and dates
  // none of them, so the absence here is permanent rather than pending.
  if (row.capabilities?.playHistory === 'none' || row.capabilities?.playtime === 'full') {
    return { value: 'Never dated', known: false, note: 'This platform reports totals without dates' };
  }
  return { value: 'None recorded', known: false };
}

function achievementCell(row: PlatformReportRow): Cell {
  if (row.achievements) {
    return {
      value: `${row.achievements.unlocked} / ${row.achievements.total}`,
      known: true,
    };
  }
  if (row.capabilities?.achievements === 'none') {
    return { value: 'Not supported', known: false };
  }
  return { value: 'None held', known: false, note: 'Either this game has none, or the sweep has not reached it' };
}

export function PlatformReport({ rows }: { rows: PlatformReportRow[] }) {
  if (rows.length === 0) return null;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {rows.map((row) => {
        const cells: Array<[string, Cell]> = [
          ['Ownership', ownershipCell(row)],
          ['Playtime', playtimeCell(row)],
          ['Dated play', datedPlayCell(row)],
          // PlayStation calls them trophies, and calling them anything else on
          // a PlayStation panel reads as a translation layer.
          [row.provider === 'psn' ? 'Trophies' : 'Achievements', achievementCell(row)],
        ];

        return (
          <div key={row.provider} className="card p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <PlatformBadge provider={row.provider} small />
              <span className="text-[11px] uppercase tracking-wider text-ink-600">
                {providerLabel(row.provider)}
              </span>
            </div>

            <dl className="space-y-2.5">
              {cells.map(([label, cell]) => (
                <div key={label}>
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="shrink-0 text-xs text-ink-500">{label}</dt>
                    <dd
                      className={`stat-figure truncate text-right text-sm ${
                        cell.known ? 'text-ink-100' : 'text-ink-600'
                      }`}
                    >
                      {cell.value}
                    </dd>
                  </div>
                  {cell.note ? (
                    <p className="mt-0.5 text-right text-[11px] leading-snug text-ink-700">
                      {cell.note}
                    </p>
                  ) : null}
                </div>
              ))}
            </dl>
          </div>
        );
      })}
    </div>
  );
}
