/**
 * A small, correct CSV reader.
 *
 * Written rather than pulled in because the requirement is narrow and the
 * failure mode of a naive `split(',')` is silent data corruption: a game called
 * "Batman: Arkham Asylum, Game of the Year" would import as two rows, one of
 * them garbage, and nothing downstream would notice.
 *
 * Handles the parts of RFC 4180 that appear in real exports: quoted fields,
 * embedded commas, embedded newlines, and doubled quotes as an escape.
 */

export interface CsvOptions {
  /** Field separator. Tab is common in exports pasted from spreadsheets. */
  delimiter?: string;
}

/** Parses CSV text into rows of raw string cells. */
export function parseCsv(text: string, options: CsvOptions = {}): string[][] {
  const delimiter = options.delimiter ?? ',';
  const rows: string[][] = [];

  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let fieldWasQuoted = false;

  // Strip a UTF-8 BOM: Excel writes one, and it would otherwise become part of
  // the first header name and break column detection.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const endField = (): void => {
    // Only trim unquoted fields; a quoted field's spaces were deliberate.
    row.push(fieldWasQuoted ? field : field.trim());
    field = '';
    fieldWasQuoted = false;
  };

  const endRow = (): void => {
    endField();
    // Skip rows that are entirely empty, which trailing newlines produce.
    if (row.some((cell) => cell !== '')) rows.push(row);
    row = [];
  };

  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;

    if (inQuotes) {
      if (char === '"') {
        // A doubled quote inside a quoted field is a literal quote.
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field === '') {
      inQuotes = true;
      fieldWasQuoted = true;
      continue;
    }

    if (char === delimiter) {
      endField();
      continue;
    }

    if (char === '\r') {
      // Normalise CRLF; a lone CR is treated as a line break too.
      if (input[i + 1] === '\n') i++;
      endRow();
      continue;
    }

    if (char === '\n') {
      endRow();
      continue;
    }

    field += char;
  }

  // Flush whatever the final line left behind.
  if (field !== '' || row.length > 0) endRow();

  return rows;
}

/**
 * Parses CSV into objects keyed by normalised header name.
 *
 * Headers are lowercased and stripped of non-alphanumerics so "Play Time",
 * "playtime" and "play_time" all land on the same key - export formats are
 * inconsistent and users hand-edit them.
 */
export function parseCsvRecords(
  text: string,
  options: CsvOptions = {},
): Array<Record<string, string>> {
  const rows = parseCsv(text, options);
  const headerRow = rows[0];
  if (!headerRow) return [];

  const headers = headerRow.map(normalizeHeader);

  return rows.slice(1).map((row) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (!header) return;
      const value = row[index];
      if (value !== undefined && value !== '') record[header] = value;
    });
    return record;
  });
}

export function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Guesses the delimiter from the header line.
 *
 * Tab- and semicolon-separated files are common enough (European locales
 * export semicolons) that failing on them would be an avoidable support
 * burden.
 */
export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const counts = [',', '\t', ';'].map((delimiter) => ({
    delimiter,
    count: firstLine.split(delimiter).length - 1,
  }));
  const best = counts.sort((a, b) => b.count - a.count)[0];
  return best && best.count > 0 ? best.delimiter : ',';
}
