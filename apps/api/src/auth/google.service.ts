import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { generateToken, safeEquals } from '@omniplay/database';
import type { User } from '@omniplay/database';
import { slugify } from '@omniplay/game-matching';
import { PrismaService } from '../common/prisma.service.js';
import { CONFIG, type AppConfig } from '../common/config.js';

/**
 * Sign in with Google.
 *
 * Kept apart from the gaming providers on purpose. ConnectedAccount answers
 * "what do you play on", and folding an identity provider into it would mean
 * disconnecting a platform could cost you your way back in. This writes
 * UserIdentity instead, which answers "how do you prove you are you".
 *
 * Matching is on Google's `sub` and never on the email address. An address
 * can be reassigned — a company can hand a leaver's mailbox to someone new —
 * and treating it as identity would hand that person the account.
 */

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';

/** Ten minutes is longer than any honest sign-in takes. */
const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Only the fields that are actually used, and each checked rather than
 * trusted. `sub` is the one that matters and is the only one required.
 */
const userInfoSchema = z.object({
  sub: z.string().min(1),
  email: z.string().email().optional(),
  email_verified: z.boolean().optional(),
  name: z.string().optional(),
  picture: z.string().url().optional(),
});

const tokenSchema = z.object({
  access_token: z.string().min(1),
});

@Injectable()
export class GoogleAuthService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /** False when the instance has no Google credentials, which is allowed. */
  get configured(): boolean {
    return Boolean(this.config.GOOGLE_CLIENT_ID && this.config.GOOGLE_CLIENT_SECRET);
  }

  private get redirectUri(): string {
    return `${this.config.API_URL}/auth/google/callback`;
  }

  private assertConfigured(): { id: string; secret: string } {
    const id = this.config.GOOGLE_CLIENT_ID;
    const secret = this.config.GOOGLE_CLIENT_SECRET;
    if (!id || !secret) {
      throw new BadRequestException('Google sign-in is not configured on this instance.');
    }
    return { id, secret };
  }

  /** Where to send the browser to begin. */
  async beginSignIn(returnTo?: string): Promise<string> {
    const { id } = this.assertConfigured();
    const state = generateToken(32);

    await this.prisma.client.oAuthState.create({
      data: {
        state,
        // No user yet: this is a sign-in, not a platform connection.
        userId: null,
        provider: 'google',
        redirectUri: this.redirectUri,
        returnTo: returnTo ?? null,
        expiresAt: new Date(Date.now() + STATE_TTL_MS),
      },
    });

    const params = new URLSearchParams({
      client_id: id,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      // Google returns a refresh token only when asked, and this flow has no
      // use for one: the session is ours, not Google's, and we never call
      // Google again on the user's behalf.
      prompt: 'select_account',
    });
    return `${AUTH_ENDPOINT}?${params.toString()}`;
  }

  /**
   * Finish the round trip: verify state, exchange the code, then find or
   * create the account.
   */
  async completeSignIn(params: Record<string, string>): Promise<{
    user: User;
    returnTo: string | null;
  }> {
    const { id, secret } = this.assertConfigured();

    if (params['error']) {
      // The usual value here is `access_denied`, meaning the person pressed
      // cancel on Google's screen. Not an error worth a stack trace.
      throw new BadRequestException('Google sign-in was cancelled.');
    }

    const stateValue = params['state'];
    const code = params['code'];
    if (!stateValue || !code) throw new BadRequestException('Missing sign-in parameters.');

    const stateRow = await this.prisma.client.oAuthState.findUnique({
      where: { state: stateValue },
    });
    if (!stateRow || stateRow.provider !== 'google') {
      throw new BadRequestException('This sign-in link is invalid or has already been used.');
    }

    // Single use, whatever happens next.
    await this.prisma.client.oAuthState.delete({ where: { id: stateRow.id } }).catch(() => {});

    if (stateRow.expiresAt <= new Date()) {
      throw new BadRequestException('This sign-in link expired. Please try again.');
    }
    if (!safeEquals(stateRow.state, stateValue)) {
      throw new BadRequestException('Sign-in state did not match.');
    }

    const tokenResponse = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: id,
        client_secret: secret,
        redirect_uri: stateRow.redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenResponse.ok) {
      throw new BadRequestException('Google would not confirm that sign-in.');
    }
    const { access_token } = tokenSchema.parse(await tokenResponse.json());

    const profileResponse = await fetch(USERINFO_ENDPOINT, {
      headers: { authorization: `Bearer ${access_token}` },
    });
    if (!profileResponse.ok) {
      throw new BadRequestException('Could not read your Google profile.');
    }
    const profile = userInfoSchema.parse(await profileResponse.json());

    const user = await this.findOrCreate(profile);
    return { user, returnTo: stateRow.returnTo };
  }

  /**
   * Three cases, in order of how much they are trusted.
   *
   * 1. We have seen this Google account before — sign that user in.
   * 2. We have not, but the address matches an existing account *and* Google
   *    says it verified that address — link them. Without the verified flag
   *    this step would let anyone who can set an unverified email on a Google
   *    account claim someone else's OMNIPLAY account.
   * 3. Otherwise, a new account with no password. `passwordHash` is nullable
   *    precisely so an account can exist that has never had one.
   */
  private async findOrCreate(profile: z.infer<typeof userInfoSchema>): Promise<User> {
    const existing = await this.prisma.client.userIdentity.findUnique({
      where: { provider_subject: { provider: 'google', subject: profile.sub } },
      include: { user: true },
    });
    if (existing) {
      await this.prisma.client.userIdentity.update({
        where: { id: existing.id },
        data: { lastUsedAt: new Date(), email: profile.email ?? null },
      });
      return existing.user;
    }

    const email = profile.email?.trim().toLowerCase();
    if (email && profile.email_verified) {
      const byEmail = await this.prisma.client.user.findUnique({ where: { email } });
      if (byEmail) {
        await this.prisma.client.userIdentity.create({
          data: { userId: byEmail.id, provider: 'google', subject: profile.sub, email },
        });
        return byEmail;
      }
    }

    if (!email) {
      // Every account here is keyed by email. Google can withhold it if the
      // scope was declined, and there is nothing sensible to do with that.
      throw new BadRequestException(
        'Google did not share an email address, which OMNIPLAY needs to create an account.',
      );
    }

    const user = await this.prisma.client.user.create({
      data: {
        email,
        username: await this.availableUsername(profile.name ?? email.split('@')[0] ?? 'player'),
        displayName: profile.name ?? null,
        avatar: profile.picture ?? null,
        // No password, and none is invented. The account signs in with Google
        // until its owner sets one through the reset flow.
        passwordHash: null,
        identities: {
          create: { provider: 'google', subject: profile.sub, email },
        },
      },
    });
    return user;
  }

  /**
   * A username nobody else holds.
   *
   * Google display names collide constantly, and the username is a public URL
   * segment with a uniqueness constraint behind it, so a collision here would
   * surface as a failed sign-in rather than anything the user could act on.
   */
  private async availableUsername(seed: string): Promise<string> {
    const base = slugify(seed).slice(0, 24) || 'player';
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
      const taken = await this.prisma.client.user.findUnique({
        where: { username: candidate },
        select: { id: true },
      });
      if (!taken) return candidate;
    }
    // Falls back to something that cannot collide rather than looping forever.
    return `${base}-${generateToken(4).toLowerCase()}`;
  }
}
