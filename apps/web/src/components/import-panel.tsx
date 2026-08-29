'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

interface ImportWarning {
  row: number;
  message: string;
}

interface ImportResult {
  imported: number;
  skipped: number;
  warnings: ImportWarning[];
}

/**
 * File import for providers with no API (spec 5.3).
 *
 * The design goal is that a partial success reads as a success. Real files
 * have bad rows; reporting "7 imported, 1 skipped" with the reasons is far
 * more useful than refusing the whole file over one blank title.
 */
export function ImportPanel({
  provider,
  displayName,
}: {
  provider: string;
  displayName: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    setResult(null);

    try {
      const content = await file.text();
      const response = await fetch(
        `${API_URL}/providers/${provider}/import?filename=${encodeURIComponent(file.name)}`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'text/csv' },
          body: content,
        },
      );

      const body = (await response.json().catch(() => null)) as
        | (ImportResult & { message?: string })
        | null;

      if (!response.ok) {
        setError(body?.message ?? 'That file could not be imported.');
        return;
      }

      setResult(body);
      // The sync runs in the background; refresh so counts update once it lands.
      setTimeout(() => router.refresh(), 1500);
    } catch {
      setError('Could not read that file. Make sure it is a CSV or JSON text file.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-ink-800 bg-ink-950/40 p-4">
      <p className="text-sm text-ink-200">Import a library file</p>
      <p className="mt-1 text-xs leading-relaxed text-ink-500">
        {displayName} does not offer a sign-in for third-party apps, so OMNIPLAY reads a file you
        provide. A CSV or JSON file with a <code className="text-ink-400">title</code> column is
        enough — <code className="text-ink-400">platform</code>,{' '}
        <code className="text-ink-400">hours</code>, <code className="text-ink-400">status</code>,{' '}
        <code className="text-ink-400">ownership</code> and{' '}
        <code className="text-ink-400">acquired</code> are used if present.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="btn-primary btn-sm cursor-pointer">
          {busy ? 'Importing…' : 'Choose a file'}
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.json,.tsv,.txt,text/csv,application/json"
            disabled={busy}
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
          />
        </label>
        <a
          href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`}
          download={`omniplay-${provider}-template.csv`}
          className="text-xs text-ink-400 underline underline-offset-2 hover:text-ink-200"
        >
          Download a template
        </a>
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-xs text-danger">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="mt-3 rounded-lg border border-positive/30 bg-positive/10 p-3" role="status">
          <p className="text-xs text-ink-200">
            Imported {result.imported} {result.imported === 1 ? 'game' : 'games'}
            {result.skipped > 0 ? `, skipped ${result.skipped}` : ''}. Syncing now.
          </p>

          {result.warnings.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {result.warnings.slice(0, 6).map((warning, index) => (
                <li key={index} className="text-xs text-ink-500">
                  Row {warning.row}: {warning.message}
                </li>
              ))}
              {result.warnings.length > 6 ? (
                <li className="text-xs text-ink-600">
                  and {result.warnings.length - 6} more
                </li>
              ) : null}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** A starter file that documents the accepted columns by example. */
const TEMPLATE = [
  'Title,Platform,Hours,Status,Ownership,Acquired',
  'Bloodborne,PS4,62.5,Completed,Physical,2015-03-24',
  'Ghost of Tsushima,PS4,55,Playing,Digital,2020-07-17',
  'The Last of Us Part II,PS4,,Backlog,Physical,2020-06-19',
].join('\n');
