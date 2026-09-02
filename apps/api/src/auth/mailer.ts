import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { CONFIG, type AppConfig } from '../common/config.js';

/**
 * Outbound email, through Resend.
 *
 * Sent with `fetch` and validated with Zod rather than through the SDK, which
 * is how every other outbound integration here is written — the API is one
 * POST, and a dependency that wraps one POST is a dependency to keep upgraded
 * for no return.
 *
 * Without `RESEND_API_KEY` the class still works: the message goes to this log
 * instead, `canDeliver` reports false, and the reset screen tells the reader
 * no email was sent rather than promising an inbox. That path is the local
 * development experience, not a failure mode.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/** Only the id is used; the rest of the response is not our business. */
const sentSchema = z.object({ id: z.string().min(1) });

/** Resend reports failures as `{ name, message }` with a non-2xx status. */
const errorSchema = z.object({
  name: z.string().optional(),
  message: z.string().optional(),
});

interface Message {
  to: string;
  subject: string;
  text: string;
  html: string;
}

@Injectable()
export class Mailer {
  private readonly logger = new Logger('Mailer');

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  /**
   * Whether this instance can actually put a message in someone's inbox.
   *
   * Key presence is the honest signal. Whether the *domain* is verified is
   * something only Resend can answer, and only when a send is attempted — so
   * that failure surfaces in the log below rather than being guessed at here.
   */
  get canDeliver(): boolean {
    return Boolean(this.config.RESEND_API_KEY);
  }

  async sendPasswordReset(to: string, resetUrl: string, expiresAt: Date): Promise<void> {
    const minutes = Math.round((expiresAt.getTime() - Date.now()) / 60_000);

    await this.deliver({
      to,
      subject: 'Reset your OMNIPLAY password',
      text: [
        'Someone asked to reset the password for this OMNIPLAY account.',
        '',
        `Open this link to choose a new one. It works once and expires in ${minutes} minutes:`,
        resetUrl,
        '',
        'If this was not you, nothing has changed and you can ignore this message.',
      ].join('\n'),
      html: passwordResetHtml(resetUrl, minutes),
    });
  }

  /**
   * The transport.
   *
   * It never throws, and that is a requirement rather than defensiveness: the
   * reset endpoint answers identically whether or not the address belongs to
   * an account, so an exception escaping here would reintroduce exactly the
   * account-enumeration signal that endpoint is written to avoid. Failures are
   * loud in the log, where the operator can act on them, and invisible to the
   * caller, who must not be able to tell.
   */
  private async deliver(message: Message): Promise<void> {
    const key = this.config.RESEND_API_KEY;

    if (!key) {
      // Not an error in development — this is how you read the link locally.
      // In production it is a misconfiguration the operator needs to hear
      // about, because resets are silently not happening.
      const log = this.config.isProduction
        ? this.logger.error.bind(this.logger)
        : this.logger.log.bind(this.logger);

      log(
        `\n─── email (no transport configured, not sent) ───\n` +
          `To: ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n` +
          `────────────────────────────────────────────────`,
      );
      return;
    }

    try {
      const response = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${key}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: this.config.MAIL_FROM,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
        // A hung mail provider must not hold a request open indefinitely.
        signal: AbortSignal.timeout(10_000),
      });

      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        const detail = errorSchema.safeParse(payload);
        const reason = detail.success
          ? (detail.data.message ?? detail.data.name ?? 'no reason given')
          : 'no reason given';

        // The two failures worth naming, because both look like "nothing
        // arrived" and neither is fixed by retrying.
        //
        // What Resend actually says is checked before the status code,
        // because an unverified sending domain also comes back as 403 — so
        // matching on status first sent the operator to look at their API
        // key over a problem that had nothing to do with it.
        const hint = /domain|from address|verif/i.test(reason)
          ? ` Check that the MAIL_FROM domain (${this.config.MAIL_FROM}) is verified in Resend. ` +
            'The shared onboarding@resend.dev sender only delivers to the address that owns the account.'
          : response.status === 401 || response.status === 403
            ? ' Check RESEND_API_KEY.'
            : '';

        this.logger.error(
          `Resend refused the message (HTTP ${response.status}): ${reason}.${hint}`,
        );
        return;
      }

      const sent = sentSchema.safeParse(payload);
      this.logger.log(
        sent.success
          ? `Sent "${message.subject}" via Resend (id ${sent.data.id}).`
          : `Resend accepted "${message.subject}" but returned an unfamiliar body.`,
      );
    } catch (error) {
      const reason =
        error instanceof Error && error.name === 'TimeoutError'
          ? 'Resend did not respond within 10 seconds'
          : error instanceof Error
            ? error.message
            : 'unknown error';
      this.logger.error(`Could not reach Resend: ${reason}.`);
    }
  }
}

/**
 * The HTML half of the reset email.
 *
 * Table-free, inline-styled and dark-on-light. Mail clients are not browsers:
 * external stylesheets are stripped, custom properties do not resolve, and
 * anything relying on the app's palette would arrive unstyled. The link is
 * also printed as plain text underneath, because a client that blocks the
 * button still has to let someone in.
 */
function passwordResetHtml(resetUrl: string, minutes: number): string {
  return `<!doctype html>
<html lang="en"><body style="margin:0;padding:24px;background:#f5f6f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1c22;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e4e6eb;border-radius:12px;padding:28px;">
    <p style="margin:0 0 4px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#6b7280;">OMNIPLAY</p>
    <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;">Reset your password</h1>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#3f434d;">
      Someone asked to reset the password for this OMNIPLAY account.
      The link below works once and expires in ${minutes} minutes.
    </p>
    <p style="margin:0 0 20px;">
      <a href="${resetUrl}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:8px;font-size:14px;font-weight:600;">Choose a new password</a>
    </p>
    <p style="margin:0 0 20px;font-size:12px;line-height:1.6;color:#6b7280;word-break:break-all;">
      If the button does not work, paste this into your browser:<br>${resetUrl}
    </p>
    <p style="margin:0;padding-top:16px;border-top:1px solid #e4e6eb;font-size:12px;line-height:1.6;color:#6b7280;">
      If this was not you, nothing has changed and you can ignore this message.
    </p>
  </div>
</body></html>`;
}
