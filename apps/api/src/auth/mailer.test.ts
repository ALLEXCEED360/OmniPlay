import { afterEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { Mailer } from './mailer.js';
import type { AppConfig } from '../common/config.js';

/**
 * The transport's contract.
 *
 * The property that matters most here is the one that looks like sloppiness:
 * `deliver` swallows every failure. It has to. The reset endpoint answers
 * identically whether or not an address belongs to an account, so an
 * exception escaping the mailer would let a caller time or trigger their way
 * to knowing which addresses are registered.
 */

const config = (over: Partial<AppConfig> = {}): AppConfig =>
  ({
    RESEND_API_KEY: 're_test_key',
    MAIL_FROM: 'OMNIPLAY <test@example.com>',
    isProduction: false,
    ...over,
  }) as AppConfig;

const expires = () => new Date(Date.now() + 60 * 60 * 1000);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Mailer', () => {
  describe('canDeliver', () => {
    it('is false without a key, so the interface can stop promising an inbox', () => {
      expect(new Mailer(config({ RESEND_API_KEY: undefined })).canDeliver).toBe(false);
    });

    it('is true once a key is present', () => {
      expect(new Mailer(config()).canDeliver).toBe(true);
    });
  });

  describe('with no key configured', () => {
    it('does not call Resend at all', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const mailer = new Mailer(config({ RESEND_API_KEY: undefined }));

      await mailer.sendPasswordReset('someone@example.com', 'https://x/reset', expires());

      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('with a key configured', () => {
    it('posts the message to Resend', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ id: 'abc-123' }), { status: 200 }),
      );

      await new Mailer(config()).sendPasswordReset(
        'someone@example.com',
        'https://omniplay.test/reset-password?token=xyz',
        expires(),
      );

      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, init] = fetchSpy.mock.calls[0]!;
      expect(url).toBe('https://api.resend.com/emails');

      const body = JSON.parse(String((init as RequestInit).body));
      expect(body.from).toBe('OMNIPLAY <test@example.com>');
      expect(body.to).toEqual(['someone@example.com']);
      // Both parts, because a client that blocks HTML still has to let
      // someone in.
      expect(body.text).toContain('https://omniplay.test/reset-password?token=xyz');
      expect(body.html).toContain('https://omniplay.test/reset-password?token=xyz');
    });

    it('sends the key as a bearer token and nowhere else', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ id: 'abc' }), { status: 200 }),
      );

      await new Mailer(config()).sendPasswordReset('a@b.com', 'https://x/r', expires());

      const [, init] = fetchSpy.mock.calls[0]!;
      const headers = (init as RequestInit).headers as Record<string, string>;
      expect(headers.authorization).toBe('Bearer re_test_key');
      expect(String((init as RequestInit).body)).not.toContain('re_test_key');
    });
  });

  describe('says which thing is broken', () => {
    const capture = () => {
      const lines: string[] = [];
      vi.spyOn(Logger.prototype, 'error').mockImplementation((m: unknown) => {
        lines.push(String(m));
      });
      return lines;
    };

    it('blames the key when the key is rejected', async () => {
      const lines = capture();
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ message: 'API key is invalid' }), { status: 401 }),
      );

      await new Mailer(config()).sendPasswordReset('a@b.com', 'https://x/r', expires());

      expect(lines.join(' ')).toContain('RESEND_API_KEY');
    });

    // Resend answers 403 for an unverified sending domain too, so matching on
    // the status before the message sent the operator to check their API key
    // over a problem that had nothing to do with it.
    it('blames the domain when the domain is unverified, despite the 403', async () => {
      const lines = capture();
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ message: 'The example.com domain is not verified' }), {
          status: 403,
        }),
      );

      await new Mailer(config()).sendPasswordReset('a@b.com', 'https://x/r', expires());

      const output = lines.join(' ');
      expect(output).toContain('MAIL_FROM');
      expect(output).not.toContain('RESEND_API_KEY');
    });
  });

  describe('never throws, whatever Resend does', () => {
    // Each of these is a real failure an operator will hit — a wrong key, an
    // unverified sending domain, a network fault — and none of them may reach
    // the caller, because the caller is an endpoint that must not reveal
    // whether the address exists.
    it('survives a rejected key', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ message: 'API key is invalid' }), { status: 401 }),
      );
      await expect(
        new Mailer(config()).sendPasswordReset('a@b.com', 'https://x/r', expires()),
      ).resolves.toBeUndefined();
    });

    it('survives an unverified sending domain', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ message: 'The domain is not verified' }), { status: 403 }),
      );
      await expect(
        new Mailer(config()).sendPasswordReset('a@b.com', 'https://x/r', expires()),
      ).resolves.toBeUndefined();
    });

    it('survives a network failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(
        new Mailer(config()).sendPasswordReset('a@b.com', 'https://x/r', expires()),
      ).resolves.toBeUndefined();
    });

    it('survives a body that is not JSON', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('<html>502 Bad Gateway</html>', { status: 502 }),
      );
      await expect(
        new Mailer(config()).sendPasswordReset('a@b.com', 'https://x/r', expires()),
      ).resolves.toBeUndefined();
    });

    it('survives a 200 whose shape it does not recognise', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ unexpected: true }), { status: 200 }),
      );
      await expect(
        new Mailer(config()).sendPasswordReset('a@b.com', 'https://x/r', expires()),
      ).resolves.toBeUndefined();
    });
  });
});
