/**
 * Sends one test email, so a mail setup can be confirmed in a single command
 * rather than by triggering a password reset and hoping.
 *
 *   pnpm --filter @omniplay/api mail:test you@example.com
 *
 * This exists because of a specific trap. Resend's shared sender,
 * onboarding@resend.dev, only delivers to the address that owns the Resend
 * account — so the first test always works and every later one silently does
 * not. Running this against a second address is the fastest way to find out
 * whether a domain is genuinely verified, and it prints Resend's own reason
 * when it is not.
 *
 * Reads the same RESEND_API_KEY and MAIL_FROM the API does, so a pass here
 * means the running app can send too.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

interface Failure {
  name?: string;
  message?: string;
}

async function main(): Promise<void> {
  const to = process.argv[2];
  const key = process.env['RESEND_API_KEY'];
  const from = process.env['MAIL_FROM'] ?? 'OMNIPLAY <onboarding@resend.dev>';

  if (!to) {
    console.error('Usage: pnpm --filter @omniplay/api mail:test you@example.com');
    process.exitCode = 1;
    return;
  }

  if (!key) {
    console.error(
      'RESEND_API_KEY is not set, so nothing can be sent.\n' +
        'Add it to .env. Until then the app writes reset links to its own log instead.',
    );
    process.exitCode = 1;
    return;
  }

  const shared = /onboarding@resend\.dev/i.test(from);
  console.log(`From: ${from}${shared ? '  (Resend shared sender)' : ''}`);
  console.log(`To:   ${to}`);
  if (shared) {
    console.log(
      '\nNote: the shared sender only delivers to the address that owns the\n' +
        'Resend account. If this send succeeds to your own address it proves the\n' +
        'key works, not that the app can mail anyone else.',
    );
  }
  console.log('');

  let response: Response;
  try {
    response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [to],
        subject: 'OMNIPLAY mail test',
        text:
          'This is a test message from OMNIPLAY.\n\n' +
          'If you are reading it, password reset emails can reach this address.',
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown error';
    console.error(`Could not reach Resend: ${reason}`);
    process.exitCode = 1;
    return;
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const detail = (payload ?? {}) as Failure;
    const reason = detail.message ?? detail.name ?? 'no reason given';
    console.error(`Resend refused it (HTTP ${response.status}): ${reason}\n`);

    // Matched on what Resend actually said rather than on the status, because
    // the statuses overlap: an unverified domain and a bad key are both 403,
    // and a rejected recipient and a malformed sender are both 422. Reading
    // the status first is how this told someone to check MAIL_FROM over a
    // problem with the recipient.
    const verifyDomain =
      'Verify a domain so you can mail anyone:\n' +
      '  1. resend.com/domains -> Add Domain\n' +
      '  2. Publish the DNS records it shows you (DKIM, SPF, return-path)\n' +
      '  3. Wait for it to read Verified\n' +
      '  4. Set MAIL_FROM to an address on that domain, then restart the API';

    if (/only send testing emails|own email address/i.test(reason)) {
      console.error(
        'That is the shared sender refusing to mail anyone but you.\n' +
          'Nothing is wrong with the key — this is the limit it is meant to have.\n\n' +
          verifyDomain,
      );
    } else if (/not verified/i.test(reason)) {
      console.error(`The MAIL_FROM domain is not verified in Resend.\n\n${verifyDomain}`);
    } else if (response.status === 401 && /restricted/i.test(reason)) {
      console.error(
        'That key is restricted to sending, which is fine for the app but means\n' +
          'it cannot read your domain list. Nothing to fix.',
      );
    } else if (/`to`|recipient/i.test(reason)) {
      // Nothing to do with MAIL_FROM, which is what this used to blame.
      console.error(
        'Resend would not accept that recipient. Note that example.com and the\n' +
          'other reserved test domains are rejected outright — use a real address.',
      );
    } else if (response.status === 401 || response.status === 403) {
      console.error('Check RESEND_API_KEY in .env.');
    } else if (response.status === 422) {
      console.error(`Resend could not use those addresses. MAIL_FROM is currently: ${from}`);
    }
    process.exitCode = 1;
    return;
  }

  const id = (payload as { id?: string } | null)?.id;
  console.log(`Sent${id ? ` (id ${id})` : ''}. Check that inbox, including spam.`);
  if (shared) {
    console.log(
      '\nTo mail anyone other than yourself, verify a domain at resend.com/domains,\n' +
        'set MAIL_FROM to an address on it, restart the API, and run this again\n' +
        'against a different address.',
    );
  }
}

void main();
