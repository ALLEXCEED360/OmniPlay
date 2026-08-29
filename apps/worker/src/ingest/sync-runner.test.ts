import { describe, expect, it } from 'vitest';
import {
  buildDedupeKey,
  detailStampField,
  kindsToFetch,
  oldestDetailStamp,
  type DetailKind,
} from './sync-runner.js';

/**
 * The dedupe key is the single mechanism preventing playtime inflation across
 * repeated syncs, so its behaviour is pinned here explicitly.
 */
describe('buildDedupeKey', () => {
  it('collapses a lifetime total to one key per provider and game', () => {
    // Three syncs, same fact. All three must produce the same key so the
    // upsert overwrites rather than appends.
    const key = () =>
      buildDedupeKey('steam', { externalGameId: '730', activityType: 'LIFETIME_TOTAL' });

    expect(key()).toBe('steam:LIFETIME_TOTAL:730');
    expect(key()).toBe(key());
  });

  it('separates the same game on different providers', () => {
    // Two providers describe two real playthroughs that should both count.
    const steam = buildDedupeKey('steam', {
      externalGameId: '1245620',
      activityType: 'LIFETIME_TOTAL',
    });
    const psn = buildDedupeKey('psn', {
      externalGameId: 'CUSA-1234',
      activityType: 'LIFETIME_TOTAL',
    });
    expect(steam).not.toBe(psn);
  });

  it('separates different activity types for one game', () => {
    const lifetime = buildDedupeKey('steam', {
      externalGameId: '730',
      activityType: 'LIFETIME_TOTAL',
    });
    const recent = buildDedupeKey('steam', {
      externalGameId: '730',
      activityType: 'RECENT_PLAY',
    });
    expect(lifetime).not.toBe(recent);
  });

  it('keys a session by its start instant, so distinct sessions both persist', () => {
    const first = buildDedupeKey('xbox', {
      externalGameId: 'abc',
      activityType: 'SESSION',
      startedAt: new Date('2026-08-01T10:00:00Z'),
    });
    const second = buildDedupeKey('xbox', {
      externalGameId: 'abc',
      activityType: 'SESSION',
      startedAt: new Date('2026-08-02T10:00:00Z'),
    });

    expect(first).not.toBe(second);
    expect(first).toContain('2026-08-01T10:00:00.000Z');
  });

  it('re-observing the same session produces the same key', () => {
    const build = () =>
      buildDedupeKey('xbox', {
        externalGameId: 'abc',
        activityType: 'SESSION',
        startedAt: new Date('2026-08-01T10:00:00Z'),
      });
    expect(build()).toBe(build());
  });

  it('falls back to the stable base key for a session with no start time', () => {
    const key = buildDedupeKey('xbox', { externalGameId: 'abc', activityType: 'SESSION' });
    expect(key).toBe('xbox:SESSION:abc');
  });
});

/**
 * Sweep ordering under a request budget.
 *
 * These pin a bug that hid real data in production: Xbox playtime was added
 * after the achievement sweep had already run, and because one
 * `achievementsCheckedAt` stamp stood for "this title is done", the nine
 * titles already stamped were never asked for their hours. Forza Horizon 6
 * showed zero while Xbox held 1,825 minutes for it.
 */
describe('oldestDetailStamp', () => {
  const BOTH: DetailKind[] = ['playtime', 'achievements'];
  const t = (iso: string) => Date.parse(iso);

  it('treats a title stamped for one kind but not the other as never asked', () => {
    // The regression itself. Before the fix this returned the achievements
    // stamp, sorting the title to the back of the rotation with its playtime
    // still unfetched.
    const meta = { achievementsCheckedAt: '2026-08-25T04:23:00.000Z' };
    expect(oldestDetailStamp(meta, BOTH)).toBe(-Infinity);
  });

  it('sorts a half-checked title ahead of a fully checked one', () => {
    const halfChecked = { achievementsCheckedAt: '2026-08-25T04:23:00.000Z' };
    const fullyChecked = {
      achievementsCheckedAt: '2020-01-01T00:00:00.000Z',
      playtimeCheckedAt: '2020-01-01T00:00:00.000Z',
    };

    // Even though the half-checked title was asked far more recently, it has
    // outstanding work and must come first.
    expect(oldestDetailStamp(halfChecked, BOTH)).toBeLessThan(
      oldestDetailStamp(fullyChecked, BOTH),
    );
  });

  it('reports the older of the two stamps, not the newer', () => {
    const meta = {
      achievementsCheckedAt: '2026-08-25T05:00:00.000Z',
      playtimeCheckedAt: '2026-08-25T04:00:00.000Z',
    };
    expect(oldestDetailStamp(meta, BOTH)).toBe(t('2026-08-25T04:00:00.000Z'));
  });

  it('only requires the kinds a provider actually fetches', () => {
    // A provider with no playtime endpoint must not have every title held
    // permanently at -Infinity waiting for hours that will never arrive.
    const meta = { achievementsCheckedAt: '2026-08-25T04:23:00.000Z' };
    expect(oldestDetailStamp(meta, ['achievements'])).toBe(t('2026-08-25T04:23:00.000Z'));
  });

  it('treats absent, empty and unparseable metadata as never asked', () => {
    expect(oldestDetailStamp(null, BOTH)).toBe(-Infinity);
    expect(oldestDetailStamp({}, BOTH)).toBe(-Infinity);
    expect(oldestDetailStamp({ playtimeCheckedAt: 'not a date' }, BOTH)).toBe(-Infinity);
    // A non-string stamp is corrupt bookkeeping, not a valid timestamp.
    expect(oldestDetailStamp({ playtimeCheckedAt: 1_724_000_000_000 }, BOTH)).toBe(-Infinity);
  });
});

describe('detailStampField', () => {
  it('keeps the field name already written to production rows', () => {
    // Existing rows carry `achievementsCheckedAt`. A rename would silently
    // re-sweep every library from scratch.
    expect(detailStampField('achievements')).toBe('achievementsCheckedAt');
    expect(detailStampField('playtime')).toBe('playtimeCheckedAt');
  });
});

describe('kindsToFetch', () => {
  const BOTH: DetailKind[] = ['playtime', 'achievements'];

  it('fetches only the missing kind when catching up', () => {
    // The title already has its achievements; spending a second request to
    // re-read them halves how much of the library a budgeted sweep covers.
    const meta = { achievementsCheckedAt: '2026-08-25T04:23:00.000Z' };
    expect(kindsToFetch(meta, BOTH)).toEqual(['playtime']);
  });

  it('fetches everything for a title never asked about', () => {
    expect(kindsToFetch(null, BOTH)).toEqual(BOTH);
  });

  it('refreshes all kinds once none are outstanding', () => {
    // A fully stamped title is only selected when the rotation comes back
    // round to it, and that pass is meant to refresh it, not skip it.
    const meta = {
      achievementsCheckedAt: '2026-08-25T04:23:00.000Z',
      playtimeCheckedAt: '2026-08-25T04:24:00.000Z',
    };
    expect(kindsToFetch(meta, BOTH)).toEqual(BOTH);
  });

  it('never asks for a kind the provider cannot supply', () => {
    expect(kindsToFetch(null, ['achievements'])).toEqual(['achievements']);
  });
});

/**
 * Merging two observations of one activity.
 *
 * A lifetime total is written twice in a single sync: the library pass writes
 * it from the library record, and the playtime pass re-asserts the same key
 * with whatever extra the provider attached. Modelled here as the update
 * payload builder, because the rule is about which fields a later observation
 * is allowed to overwrite.
 */
describe('activity update payload', () => {
  /** Mirrors the spread in upsertActivity's update branch. */
  const updateFor = (event: { minutesPlayed?: number | null; startedAt?: Date | null; endedAt?: Date | null }) => ({
    minutesPlayed: event.minutesPlayed ?? null,
    endedAt: event.endedAt ?? null,
    ...(event.startedAt ? { startedAt: event.startedAt } : {}),
  });

  it('writes a start instant when a later observation supplies one', () => {
    // PlayStation reports a first-played date for every title, and the
    // library pass has already created the row without one.
    const started = new Date('2024-12-08T14:14:43.810Z');
    expect(updateFor({ minutesPlayed: 4606, startedAt: started }).startedAt).toEqual(started);
  });

  it('omits the field entirely when the observation has no start', () => {
    // Assigning null here is what silently erased 168 of 169 PlayStation
    // first-played dates: Steam's library record carries no start instant, so
    // the second write blanked what the first had stored.
    expect('startedAt' in updateFor({ minutesPlayed: 100 })).toBe(false);
    expect('startedAt' in updateFor({ minutesPlayed: 100, startedAt: null })).toBe(false);
  });

  it('still overwrites minutes and the end instant', () => {
    // Those are running totals the provider owns; the newest value wins.
    const payload = updateFor({ minutesPlayed: 0, endedAt: null });
    expect(payload.minutesPlayed).toBe(0);
    expect(payload.endedAt).toBeNull();
  });
});

/**
 * Merging two observations of one achievement.
 *
 * The same rule as activities, and it has now bitten twice. A field left out
 * of the update branch is silently frozen at whatever the first sync wrote:
 * Steam achievements kept null icons through a full re-sync because artwork
 * comes from a different endpoint than the achievements, so the rows already
 * existed by the time that call was added.
 */
describe('achievement update payload', () => {
  /** Mirrors the spread in the achievement upsert's update branch. */
  const updateFor = (achievement: {
    name: string;
    points?: number | null;
    iconUrl?: string | null;
    globalUnlockRate?: number | null;
  }) => ({
    name: achievement.name,
    points: achievement.points ?? null,
    globalUnlockRate: achievement.globalUnlockRate ?? null,
    ...(achievement.iconUrl ? { iconUrl: achievement.iconUrl } : {}),
  });

  it('writes artwork when a later observation supplies it', () => {
    const payload = updateFor({ name: 'First', iconUrl: 'https://cdn/one.jpg' });
    expect(payload.iconUrl).toBe('https://cdn/one.jpg');
  });

  it('omits the field when the observation has none, rather than nulling it', () => {
    // Steam's artwork endpoint is best-effort; a failed call must not wipe
    // icons a previous sync stored.
    expect('iconUrl' in updateFor({ name: 'First' })).toBe(false);
    expect('iconUrl' in updateFor({ name: 'First', iconUrl: null })).toBe(false);
  });

  it('still overwrites rarity, which the provider owns outright', () => {
    expect(updateFor({ name: 'First', globalUnlockRate: 0.045 }).globalUnlockRate).toBe(0.045);
    expect(updateFor({ name: 'First' }).globalUnlockRate).toBeNull();
  });
});
