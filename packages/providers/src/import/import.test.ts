import { describe, expect, it } from 'vitest';
import { detectDelimiter, parseCsv, parseCsvRecords } from './csv.js';
import { parseDate, parseImportFile, parseOwnership, parseStatus } from './import.mapper.js';

describe('parseCsv', () => {
  it('parses a simple table', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps a quoted comma inside its field', () => {
    // The failure this guards: a naive split turns one game into two rows.
    const rows = parseCsv('title,platform\n"Batman: Arkham Asylum, GOTY",PS3');
    expect(rows[1]).toEqual(['Batman: Arkham Asylum, GOTY', 'PS3']);
  });

  it('handles doubled quotes as an escaped quote', () => {
    const rows = parseCsv('title\n"He said ""hello"""');
    expect(rows[1]).toEqual(['He said "hello"']);
  });

  it('handles a newline inside a quoted field', () => {
    const rows = parseCsv('title,note\n"Game","line one\nline two"');
    expect(rows).toHaveLength(2);
    expect(rows[1]?.[1]).toBe('line one\nline two');
  });

  it('normalises CRLF line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('strips a UTF-8 BOM so the first header still matches', () => {
    const rows = parseCsv('﻿title,platform\nGame,PS5');
    expect(rows[0]?.[0]).toBe('title');
  });

  it('skips blank rows from trailing newlines', () => {
    expect(parseCsv('a\n1\n\n\n')).toEqual([['a'], ['1']]);
  });

  it('trims unquoted fields but preserves spacing inside quotes', () => {
    const rows = parseCsv('a,b\n  x  ,"  y  "');
    expect(rows[1]).toEqual(['x', '  y  ']);
  });

  it('returns nothing for empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });
});

describe('detectDelimiter', () => {
  it.each([
    ['title,platform\nGame,PS5', ','],
    ['title\tplatform\nGame\tPS5', '\t'],
    ['title;platform\nGame;PS5', ';'],
  ])('detects the delimiter in %j', (input, expected) => {
    expect(detectDelimiter(input)).toBe(expected);
  });

  it('falls back to a comma for a single-column file', () => {
    expect(detectDelimiter('title\nGame')).toBe(',');
  });
});

describe('parseCsvRecords', () => {
  it('normalises header names so spelling variants agree', () => {
    const records = parseCsvRecords('Game Title,Hours Played\nElden Ring,247');
    expect(records[0]).toEqual({ gametitle: 'Elden Ring', hoursplayed: '247' });
  });
});

describe('parseImportFile', () => {
  it('imports a minimal file with only titles', () => {
    const result = parseImportFile('title\nBloodborne\nGod of War');
    expect(result.imported).toBe(2);
    expect(result.games[0]?.name).toBe('Bloodborne');
  });

  it('marks everything imported as declared, never verified', () => {
    // A file someone typed must not look like data a platform vouched for.
    const result = parseImportFile('title,hours\nBloodborne,60');
    expect(result.games[0]?.confidence).toBe('DECLARED');
  });

  it('reads the columns a real export would carry', () => {
    const csv = [
      'Title,Platform,Hours,Status,Ownership,Acquired',
      'Bloodborne,PS4,62.5,Completed,Physical,2015-03-24',
    ].join('\n');

    const game = parseImportFile(csv).games[0];

    expect(game).toMatchObject({
      name: 'Bloodborne',
      platformHint: 'PS4',
      minutesPlayedTotal: 3750,
    });
    expect(game?.ownership?.type).toBe('PHYSICAL');
    expect(game?.ownership?.acquiredAt?.getUTCFullYear()).toBe(2015);
    expect(game?.raw?.['status']).toBe('COMPLETED');
  });

  describe('playtime parsing', () => {
    it.each([
      ['Hours', '10', 600],
      ['Hours', '1.5', 90],
      // Quoted, because unquoted "1,234" is two CSV fields and correctly
      // parses as 1 — a thousands separator only survives inside quotes.
      ['Hours', '"1,234"', 74040],
      ['Hours', '12h', 720],
      ['Minutes', '90', 90],
      ['Hours', '3:30', 210],
    ])('reads %s "%s" as %i minutes', (column, value, expected) => {
      const result = parseImportFile(`Title,${column}\nGame,${value}`);
      expect(result.games[0]?.minutesPlayedTotal).toBe(expected);
    });

    it('warns and imports without playtime when the value is unreadable', () => {
      const result = parseImportFile('Title,Hours\nGame,lots');
      expect(result.imported).toBe(1);
      expect(result.games[0]?.minutesPlayedTotal).toBeNull();
      expect(result.warnings[0]?.message).toMatch(/playtime/i);
    });
  });

  describe('row handling', () => {
    it('skips a row with no title and reports its spreadsheet line number', () => {
      const result = parseImportFile('Title,Hours\nGood Game,10\n,50');
      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(1);
      // Header is line 1, so the offending row is line 3.
      expect(result.warnings[0]?.row).toBe(3);
    });

    it('keeps the first of a duplicated entry and warns about the rest', () => {
      const result = parseImportFile('Title,Platform\nBloodborne,PS4\nBloodborne,PS4');
      expect(result.imported).toBe(1);
      expect(result.warnings[0]?.message).toMatch(/Duplicate/);
    });

    it('treats the same title on two platforms as two games', () => {
      const result = parseImportFile('Title,Platform\nElden Ring,PS5\nElden Ring,PS4');
      expect(result.imported).toBe(2);
    });

    it('generates stable ids so re-importing updates rather than duplicates', () => {
      const first = parseImportFile('Title,Platform\nBloodborne,PS4');
      const second = parseImportFile('Title,Platform\nBloodborne,PS4');
      expect(first.games[0]?.externalId).toBe(second.games[0]?.externalId);
    });
  });

  describe('JSON input', () => {
    it('accepts a bare array', () => {
      const result = parseImportFile('[{"title":"Bloodborne","hours":62}]');
      expect(result.games[0]?.name).toBe('Bloodborne');
      expect(result.games[0]?.minutesPlayedTotal).toBe(3720);
    });

    it('accepts a wrapper object with a games array', () => {
      const result = parseImportFile('{"games":[{"title":"Bloodborne"}]}');
      expect(result.imported).toBe(1);
    });

    it('explains what is wrong with invalid JSON', () => {
      expect(() => parseImportFile('[{"title":}]')).toThrow(/not valid JSON/);
    });

    it('rejects JSON that is not a list of games', () => {
      expect(() => parseImportFile('{"unexpected":true}')).toThrow(/array of games/);
    });
  });
});

describe('parseStatus', () => {
  it.each([
    ['Completed', 'COMPLETED'],
    ['finished', 'COMPLETED'],
    ['Platinum', 'COMPLETED'],
    ['100%', 'COMPLETED'],
    ['In Progress', 'PLAYING'],
    ['Backlog', 'NOT_STARTED'],
    ['dropped', 'ABANDONED'],
    ['On Hold', 'PAUSED'],
  ])('maps %s to %s', (input, expected) => {
    expect(parseStatus(input)).toBe(expected);
  });

  it('returns null for something it does not recognise', () => {
    expect(parseStatus('mumble')).toBeNull();
    expect(parseStatus(undefined)).toBeNull();
  });
});

describe('parseOwnership', () => {
  it.each([
    ['Physical', 'PHYSICAL'],
    ['disc', 'PHYSICAL'],
    ['Digital', 'DIGITAL'],
    ['PS Plus', 'SUBSCRIPTION'],
    ['Game Pass', 'SUBSCRIPTION'],
  ])('maps %s to %s', (input, expected) => {
    expect(parseOwnership(input)).toBe(expected);
  });

  it('defaults to MANUAL, which is what an unlabelled import is', () => {
    expect(parseOwnership(undefined)).toBe('MANUAL');
    expect(parseOwnership('something else')).toBe('MANUAL');
  });
});

describe('parseDate', () => {
  it('accepts ISO dates', () => {
    expect(parseDate('2024-03-01')?.getUTCFullYear()).toBe(2024);
    expect(parseDate('2024-03-01T10:00:00Z')?.getUTCMonth()).toBe(2);
  });

  it('accepts a year-month and a bare year', () => {
    expect(parseDate('2024-03')?.getUTCMonth()).toBe(2);
    expect(parseDate('2012')?.getUTCFullYear()).toBe(2012);
  });

  it('accepts named months, which are locale-independent', () => {
    expect(parseDate('1 March 2024')?.getUTCFullYear()).toBe(2024);
  });

  it('refuses ambiguous numeric dates rather than guessing', () => {
    // 01/02/2024 is January 2nd or February 1st depending on the reader.
    // Picking one would put wrong dates on the user's timeline.
    expect(parseDate('01/02/2024')).toBeNull();
  });

  it('returns null for empty or unparseable input', () => {
    expect(parseDate('')).toBeNull();
    expect(parseDate(undefined)).toBeNull();
    expect(parseDate('sometime')).toBeNull();
  });
});
