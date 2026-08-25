import { describe, expect, it } from 'vitest';
import { normalizeName, normalizeTitle, slugify } from './normalize.js';

describe('normalizeTitle', () => {
  it('collapses trademark glyphs and casing', () => {
    // The spec's own example of two spellings that must resolve together.
    expect(normalizeName('Cyberpunk 2077')).toBe(normalizeName('Cyberpunk 2077™'));
    expect(normalizeName('CYBERPUNK 2077®')).toBe('cyberpunk 2077');
  });

  it('folds accents so provider spellings agree', () => {
    expect(normalizeName('Pokémon')).toBe(normalizeName('Pokemon'));
  });

  it('normalises separators, ampersands and apostrophes', () => {
    expect(normalizeName('Rock & Roll')).toBe(normalizeName('Rock and Roll'));
    expect(normalizeName("Assassin's Creed")).toBe(normalizeName('Assassins Creed'));
    expect(normalizeName('Half-Life: Alyx')).toBe('half life alyx');
  });

  describe('editions versus versions', () => {
    it('strips edition markers so packaging variants merge', () => {
      const deluxe = normalizeTitle('Cyberpunk 2077 - Deluxe Edition');
      expect(deluxe.normalized).toBe('cyberpunk 2077');
      expect(deluxe.edition).toBe('deluxe edition');
    });

    it.each([
      'The Witcher 3: Wild Hunt Game of the Year Edition',
      'The Witcher 3: Wild Hunt GOTY',
      'The Witcher 3: Wild Hunt - Complete Edition',
    ])('treats %s as the base game', (title) => {
      expect(normalizeName(title)).toBe(normalizeName('The Witcher 3: Wild Hunt'));
    });

    it('keeps version markers so distinct products never merge', () => {
      // This is the case the spec calls out explicitly (section 9, level 4).
      const original = normalizeTitle('Resident Evil 4');
      const remake = normalizeTitle('Resident Evil 4 Remake');
      const vr = normalizeTitle('Resident Evil 4 VR');

      expect(original.normalized).not.toBe(remake.normalized);
      expect(original.normalized).not.toBe(vr.normalized);
      expect(remake.normalized).not.toBe(vr.normalized);
      expect(remake.versionMarkers).toContain('remake');
    });

    it('classes ambiguous markers as versions rather than risk a false merge', () => {
      expect(normalizeName('Dark Souls Remastered')).not.toBe(normalizeName('Dark Souls'));
      expect(normalizeName('Skyrim Anniversary Edition')).not.toBe(normalizeName('Skyrim'));
    });

    it('does not strip an edition word that is the entire title', () => {
      expect(normalizeName('Ultimate')).toBe('ultimate');
    });
  });

  it('captures a parenthesised year as a distinguishing token', () => {
    const remake = normalizeTitle('Resident Evil 4 (2023)');
    expect(remake.year).toBe(2023);
    expect(remake.normalized).not.toBe(normalizeName('Resident Evil 4'));
  });

  it('removes platform noise that carries no product meaning', () => {
    expect(normalizeName('Minecraft for Windows 10')).toBe('minecraft');
    expect(normalizeName('Forza Horizon 5 (Xbox Series X|S)')).toBe('forza horizon 5');
  });

  describe('roman numerals', () => {
    it('canonicalises numerals in a trailing position', () => {
      expect(normalizeName('Final Fantasy VII')).toBe(normalizeName('Final Fantasy 7'));
      expect(normalizeName('Grand Theft Auto V')).toBe(normalizeName('Grand Theft Auto 5'));
    });

    it('leaves a leading token alone, where it is probably a word', () => {
      // "X" is a real title; converting it to "10" would be wrong.
      expect(normalizeName('X')).toBe('x');
    });

    it('does not merge a numbered entry with its subtitled remake', () => {
      expect(normalizeName('Final Fantasy VII')).not.toBe(normalizeName('Final Fantasy VII Remake'));
    });
  });

  it('returns an empty result for empty input rather than throwing', () => {
    expect(normalizeTitle('').normalized).toBe('');
    expect(normalizeTitle('™®').normalized).toBe('');
  });
});

describe('slugify', () => {
  it('produces url-safe slugs', () => {
    expect(slugify('Cyberpunk 2077™')).toBe('cyberpunk-2077');
    expect(slugify("Assassin's Creed: Odyssey")).toBe('assassins-creed-odyssey');
    expect(slugify('Rock & Roll')).toBe('rock-and-roll');
  });

  it('never returns an empty slug', () => {
    expect(slugify('™®©')).toBe('untitled');
  });

  it('does not leave a trailing hyphen after truncation', () => {
    const slug = slugify(`${'a'.repeat(78)} bcdef`);
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith('-')).toBe(false);
  });
});
