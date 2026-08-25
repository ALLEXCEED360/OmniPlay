import { createHash } from 'node:crypto';
import type { ExternalGame, GameStatus, OwnershipType } from '@omniplay/types';
import { detectDelimiter, parseCsvRecords } from './csv.js';

/**
 * Turns a user-supplied file into `ExternalGame` records.
 *
 * This is the path for PlayStation and for physical collections (spec 5.3,
 * 2.4). Two principles govern it:
 *
 *  - **Be generous about input, strict about output.** Users hand-edit these
 *    files. Column names, date formats and hour notations vary. Anything
 *    ambiguous is skipped with a stated reason rather than guessed at.
 *  - **Never claim more confidence than a person typing a file warrants.**
 *    Everything imported is `DECLARED`: the user asserted it and we have no
 *    independent evidence. It must not look like verified provider data.
 */

export interface ImportWarning {
  /** 1-based row number as the user sees it in their spreadsheet. */
  row: number;
  message: string;
}

export interface ImportResult {
  games: ExternalGame[];
  warnings: ImportWarning[];
  /** Rows that produced a game. */
  imported: number;
  /** Rows present in the file but skipped. */
  skipped: number;
}

/** Accepted column names, in priority order, per logical field. */
const COLUMNS = {
  title: ['title', 'name', 'game', 'gamename', 'gametitle'],
  platform: ['platform', 'console', 'system', 'device'],
  hours: ['hours', 'hoursplayed', 'playtimehours', 'timeplayed'],
  minutes: ['minutes', 'minutesplayed', 'playtimeminutes', 'playtime'],
  status: ['status', 'progress', 'state', 'completion'],
  ownership: ['ownership', 'ownershiptype', 'format', 'copy', 'edition'],
  acquired: ['acquired', 'acquiredat', 'purchased', 'purchasedate', 'dateadded', 'added'],
  completed: ['completed', 'completedat', 'finished', 'finishedat', 'datecompleted'],
  externalId: ['id', 'externalid', 'titleid', 'npcommunicationid', 'productid'],
} as const;

/** Free-text status values mapped onto the canonical vocabulary. */
const STATUS_ALIASES: Record<string, GameStatus> = {
  playing: 'PLAYING',
  inprogress: 'PLAYING',
  started: 'PLAYING',
  current: 'PLAYING',
  paused: 'PAUSED',
  onhold: 'PAUSED',
  backlog: 'NOT_STARTED',
  notstarted: 'NOT_STARTED',
  unplayed: 'NOT_STARTED',
  neverplayed: 'NOT_STARTED',
  completed: 'COMPLETED',
  complete: 'COMPLETED',
  finished: 'COMPLETED',
  beaten: 'COMPLETED',
  platinum: 'COMPLETED',
  hundredpercent: 'COMPLETED',
  abandoned: 'ABANDONED',
  dropped: 'ABANDONED',
  quit: 'ABANDONED',
  replaying: 'REPLAYING',
  replay: 'REPLAYING',
};

const OWNERSHIP_ALIASES: Record<string, OwnershipType> = {
  digital: 'DIGITAL',
  download: 'DIGITAL',
  physical: 'PHYSICAL',
  disc: 'PHYSICAL',
  cartridge: 'PHYSICAL',
  cd: 'PHYSICAL',
  subscription: 'SUBSCRIPTION',
  plus: 'SUBSCRIPTION',
  psplus: 'SUBSCRIPTION',
  gamepass: 'SUBSCRIPTION',
  gift: 'GIFT',
  shared: 'FAMILY_SHARE',
  familyshare: 'FAMILY_SHARE',
};

export function parseImportFile(
  content: string,
  options: { format?: 'csv' | 'json'; provider?: string } = {},
): ImportResult {
  const format = options.format ?? detectFormat(content);
  const records = format === 'json' ? parseJsonRecords(content) : parseCsvContent(content);

  const games: ExternalGame[] = [];
  const warnings: ImportWarning[] = [];
  // A title appearing twice in one file is the user's mistake, not two games.
  const seenIds = new Set<string>();

  records.forEach((record, index) => {
    // +2: one for the header row, one to make it 1-based like a spreadsheet.
    const rowNumber = format === 'json' ? index + 1 : index + 2;

    const title = pick(record, COLUMNS.title)?.trim();
    if (!title) {
      warnings.push({ row: rowNumber, message: 'No title column value; row skipped.' });
      return;
    }

    const platform = pick(record, COLUMNS.platform)?.trim() ?? null;

    // A stable id derived from title+platform, so re-importing a corrected
    // file updates the same rows instead of duplicating the library.
    const providedId = pick(record, COLUMNS.externalId)?.trim();
    const externalId = providedId || syntheticId(title, platform);

    if (seenIds.has(externalId)) {
      warnings.push({
        row: rowNumber,
        message: `Duplicate entry for "${title}"${platform ? ` on ${platform}` : ''}; first one kept.`,
      });
      return;
    }
    seenIds.add(externalId);

    const minutes = parseMinutes(record, rowNumber, warnings, title);
    const acquiredAt = parseDate(pick(record, COLUMNS.acquired));
    const completedAt = parseDate(pick(record, COLUMNS.completed));

    games.push({
      externalId,
      name: title,
      platformHint: platform,
      ownership: {
        type: parseOwnership(pick(record, COLUMNS.ownership)),
        acquiredAt,
      },
      minutesPlayedTotal: minutes,
      lastPlayedAt: completedAt,
      // The user told us. That is real evidence, and it is not provider-verified.
      confidence: 'DECLARED',
      raw: {
        status: parseStatus(pick(record, COLUMNS.status)),
        completedAt: completedAt?.toISOString() ?? null,
        importedFrom: options.provider ?? 'manual',
      },
    });
  });

  return {
    games,
    warnings,
    imported: games.length,
    skipped: records.length - games.length,
  };
}

export function detectFormat(content: string): 'csv' | 'json' {
  const trimmed = content.trimStart();
  return trimmed.startsWith('[') || trimmed.startsWith('{') ? 'json' : 'csv';
}

function parseCsvContent(content: string): Array<Record<string, string>> {
  return parseCsvRecords(content, { delimiter: detectDelimiter(content) });
}

function parseJsonRecords(content: string): Array<Record<string, string>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('That file is not valid JSON. Check for a trailing comma or a missing quote.');
  }

  // Accept both a bare array and a wrapper object with a games/items/data key,
  // since exports differ on this and neither is unreasonable.
  const list = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed)
      ? (parsed['games'] ?? parsed['items'] ?? parsed['data'])
      : null;

  if (!Array.isArray(list)) {
    throw new Error('Expected a JSON array of games, or an object with a "games" array.');
  }

  return list.filter(isRecord).map((entry) => {
    const record: Record<string, string> = {};
    for (const [key, value] of Object.entries(entry)) {
      if (value === null || value === undefined) continue;
      if (typeof value === 'object') continue;
      record[key.toLowerCase().replace(/[^a-z0-9]/g, '')] = String(value);
    }
    return record;
  });
}

function pick(record: Record<string, string>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== '') return value;
  }
  return undefined;
}

/**
 * Reads playtime from either an hours or a minutes column.
 *
 * Tolerates "12h", "12 hours", "1,234" and "3:30" (three and a half hours),
 * because all of those appear in files people actually produce.
 */
function parseMinutes(
  record: Record<string, string>,
  row: number,
  warnings: ImportWarning[],
  title: string,
): number | null {
  const rawMinutes = pick(record, COLUMNS.minutes);
  const rawHours = pick(record, COLUMNS.hours);
  const raw = rawHours ?? rawMinutes;
  if (!raw) return null;

  const isHours = rawHours !== undefined;
  const cleaned = raw.replace(/,/g, '').trim();

  // "3:30" means three hours thirty minutes.
  const clock = /^(\d+):([0-5]?\d)$/.exec(cleaned);
  if (clock) {
    return Number(clock[1]) * 60 + Number(clock[2]);
  }

  const numeric = Number.parseFloat(cleaned.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(numeric) || numeric < 0) {
    warnings.push({
      row,
      message: `Could not read playtime "${raw}" for "${title}"; imported without it.`,
    });
    return null;
  }

  return Math.round(isHours ? numeric * 60 : numeric);
}

export function parseStatus(value: string | undefined): GameStatus | null {
  if (!value) return null;

  // Checked before the alias lookup: stripping non-letters reduces "100%" to
  // an empty string, so this has to happen first or it never matches.
  if (/^100\s*%?$/.test(value.trim())) return 'COMPLETED';

  const key = value.toLowerCase().replace(/[^a-z]/g, '');
  if (key === '') return null;
  return STATUS_ALIASES[key] ?? null;
}

export function parseOwnership(value: string | undefined): OwnershipType {
  if (!value) return 'MANUAL';
  const key = value.toLowerCase().replace(/[^a-z]/g, '');
  return OWNERSHIP_ALIASES[key] ?? 'MANUAL';
}

/**
 * Parses a date, accepting ISO and the unambiguous parts of other formats.
 *
 * Deliberately refuses bare numeric forms like "01/02/2024": it is genuinely
 * ambiguous between January 2nd and February 1st, and silently choosing one
 * would put wrong dates on a user's timeline.
 */
export function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // A bare year is useful for "I played this in 2012" and is unambiguous.
  if (/^(19|20)\d{2}$/.test(trimmed)) {
    return new Date(Date.UTC(Number(trimmed), 0, 1));
  }

  // ISO-like: 2024-03-01 or 2024-03-01T10:00:00Z
  if (/^\d{4}-\d{2}(-\d{2})?/.test(trimmed)) {
    const parsed = new Date(trimmed.length === 7 ? `${trimmed}-01` : trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  // Named months are unambiguous regardless of locale: "1 March 2024".
  if (/[a-z]{3}/i.test(trimmed)) {
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

/** Deterministic id so re-importing the same file is idempotent. */
function syntheticId(title: string, platform: string | null): string {
  const key = `${title.toLowerCase().trim()}|${(platform ?? '').toLowerCase().trim()}`;
  return `import:${createHash('sha1').update(key).digest('hex').slice(0, 16)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
