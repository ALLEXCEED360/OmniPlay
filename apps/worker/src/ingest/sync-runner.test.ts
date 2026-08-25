import { describe, expect, it } from 'vitest';
import { buildDedupeKey } from './sync-runner.js';

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
