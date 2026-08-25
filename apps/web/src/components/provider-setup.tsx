/**
 * Setup guidance for a provider that is not wired up (or cannot be).
 *
 * Rendered instead of a Connect button. The previous behaviour — omitting
 * unconfigured providers entirely — meant a user with no credentials saw a
 * near-empty connect screen and no explanation, which is how someone ends up
 * looking at demo data wondering why their real library is missing.
 */
export function ProviderSetup({
  provider,
}: {
  provider: {
    id: string;
    displayName: string;
    access: 'api' | 'import';
    missingEnv: string[];
    setupUrl: string | null;
    setupHint: string | null;
    importReason: string | null;
    exportUrl: string | null;
  };
}) {
  // An API provider that is simply missing its key: fixable, so say how.
  if (provider.access === 'api') {
    return (
      <div className="mt-4 rounded-lg border border-warning/30 bg-warning/5 p-4">
        <p className="text-sm text-ink-200">
          {provider.displayName} is not configured on this instance.
        </p>
        {provider.setupHint ? (
          <p className="mt-1.5 text-xs leading-relaxed text-ink-500">{provider.setupHint}</p>
        ) : null}

        {provider.missingEnv.length > 0 ? (
          <p className="mt-3 text-xs text-ink-500">
            Missing:{' '}
            {provider.missingEnv.map((name, index) => (
              <span key={name}>
                {index > 0 ? ', ' : ''}
                <code className="rounded bg-ink-850 px-1.5 py-0.5 text-ink-300">{name}</code>
              </span>
            ))}
            {' — add to your .env and restart the API.'}
          </p>
        ) : null}

        {provider.setupUrl ? (
          <a
            href={provider.setupUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-3 inline-block text-xs text-accent underline underline-offset-2"
          >
            Get credentials →
          </a>
        ) : null}
      </div>
    );
  }

  // An import provider: nothing to configure, but the user deserves to know
  // *why* there is no sign-in button rather than assuming it is unfinished.
  return provider.importReason ? (
    <p className="mt-3 text-xs leading-relaxed text-ink-500">
      {provider.importReason}
      {provider.exportUrl ? (
        <>
          {' '}
          <a
            href={provider.exportUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="text-accent underline underline-offset-2"
          >
            Request your data from {provider.displayName} →
          </a>
        </>
      ) : null}
    </p>
  ) : null;
}
