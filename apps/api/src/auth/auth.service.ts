import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { generateToken, hashToken } from '@omniplay/database';
import type { User } from '@omniplay/database';
import { slugify } from '@omniplay/game-matching';
import { PrismaService } from '../common/prisma.service.js';
import { CONFIG, type AppConfig } from '../common/config.js';
import { hashPassword, verifyPassword } from './password.js';
import { Mailer } from './mailer.js';

/** How long a session cookie stays valid without re-authentication. */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * How long a reset link works. Short, because it is a bearer credential
 * sitting in an inbox, and anyone who can request one can request another.
 */
const RESET_TTL_MS = 60 * 60 * 1000;

/**
 * The shortest gap between reset emails for one address.
 *
 * The endpoint is unauthenticated and anyone can name any address, so without
 * this an attacker can use it to flood someone's inbox. In memory, and so
 * per-process: a multi-instance deployment should move this to Redis, which
 * the stack already runs. Token guessing is not what this defends against —
 * a 32-byte token is not guessable.
 */
const RESET_COOLDOWN_MS = 60 * 1000;
const lastResetRequest = new Map<string, number>();

export interface SessionContext {
  ip?: string | undefined;
  userAgent?: string | undefined;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly mailer: Mailer,
  ) {}

  async register(
    input: { email: string; username: string; password: string },
    context: SessionContext = {},
  ): Promise<{ user: User; token: string; expiresAt: Date }> {
    const email = input.email.trim().toLowerCase();
    const username = slugify(input.username);

    if (username.length < 3) {
      throw new ConflictException('Username must be at least 3 usable characters.');
    }

    const existing = await this.prisma.client.user.findFirst({
      where: { OR: [{ email }, { username }] },
      select: { email: true, username: true },
    });
    if (existing) {
      // Distinguishing which field collided is a minor account-enumeration
      // tradeoff, but the alternative is a sign-up form that cannot tell the
      // user what to change.
      throw new ConflictException(
        existing.email === email
          ? 'An account with that email already exists.'
          : 'That username is taken.',
      );
    }

    const user = await this.prisma.client.user.create({
      data: {
        email,
        username,
        displayName: input.username.trim(),
        passwordHash: await hashPassword(input.password),
      },
    });

    await this.audit(user.id, 'user.register', context);
    const session = await this.createSession(user.id, context);
    return { user, ...session };
  }

  async login(
    input: { email: string; password: string },
    context: SessionContext = {},
  ): Promise<{ user: User; token: string; expiresAt: Date }> {
    const user = await this.prisma.client.user.findUnique({
      where: { email: input.email.trim().toLowerCase() },
    });

    // Verify against a dummy hash when the user does not exist, so the
    // response time does not reveal which emails are registered.
    const storedHash = user?.passwordHash ?? DUMMY_HASH;
    const valid = await verifyPassword(input.password, storedHash);

    if (!user || !user.passwordHash || !valid) {
      throw new UnauthorizedException('Incorrect email or password.');
    }

    await this.audit(user.id, 'user.login', context);
    const session = await this.createSession(user.id, context);
    return { user, ...session };
  }

  /**
   * Begin a password reset.
   *
   * Answers the same way whether or not the address belongs to an account.
   * The caller learns nothing: no status code, no timing worth measuring, no
   * message. That is the whole design of this endpoint — a "no such user"
   * response turns the reset form into a way to test which email addresses
   * are registered here.
   */
  async requestPasswordReset(email: string, context: SessionContext = {}): Promise<void> {
    const address = email.trim().toLowerCase();

    const previous = lastResetRequest.get(address);
    if (previous && Date.now() - previous < RESET_COOLDOWN_MS) return;
    lastResetRequest.set(address, Date.now());

    const user = await this.prisma.client.user.findUnique({
      where: { email: address },
      select: { id: true, email: true },
    });
    if (!user) return;

    // Any link already outstanding stops working. Asking for a new one is the
    // action of someone who does not have the old one.
    await this.prisma.client.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    const token = generateToken(32);
    const expiresAt = new Date(Date.now() + RESET_TTL_MS);

    await this.prisma.client.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt,
        requestedIp: context.ip ?? null,
      },
    });

    await this.audit(user.id, 'user.password_reset_requested', context);
    await this.mailer.sendPasswordReset(
      user.email,
      `${this.config.WEB_URL}/reset-password?token=${encodeURIComponent(token)}`,
      expiresAt,
    );
  }

  /**
   * Finish a password reset.
   *
   * Every other session is destroyed on success. If the reset happened
   * because someone else had the password, leaving their session alive would
   * make the whole exercise pointless.
   */
  async resetPassword(
    token: string,
    password: string,
    context: SessionContext = {},
  ): Promise<{ user: User; token: string; expiresAt: Date }> {
    const row = await this.prisma.client.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });

    // One message for every failure. Distinguishing "expired" from "already
    // used" from "never existed" tells an attacker which tokens once existed.
    const invalid = new BadRequestException(
      'This reset link is no longer valid. Request a new one and try again.',
    );
    if (!row || row.usedAt !== null || row.expiresAt <= new Date()) throw invalid;

    await this.prisma.client.$transaction([
      this.prisma.client.passwordResetToken.update({
        where: { id: row.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.client.user.update({
        where: { id: row.userId },
        data: { passwordHash: await hashPassword(password) },
      }),
      this.prisma.client.session.deleteMany({ where: { userId: row.userId } }),
    ]);

    await this.audit(row.userId, 'user.password_reset', context);
    const session = await this.createSession(row.userId, context);
    return { user: row.user, ...session };
  }

  /** Resolves a cookie value to its user, or null if invalid/expired. */
  async resolveSession(token: string): Promise<User | null> {
    const session = await this.prisma.client.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (!session) return null;

    if (session.expiresAt <= new Date()) {
      await this.prisma.client.session.delete({ where: { id: session.id } }).catch(() => {});
      return null;
    }
    return session.user;
  }

  async logout(token: string): Promise<void> {
    await this.prisma.client.session
      .delete({ where: { tokenHash: hashToken(token) } })
      .catch(() => {
        // Already gone: logging out twice is not an error worth surfacing.
      });
  }

  /**
   * Start a session for a user who has already proved who they are by some
   * route other than a password — currently Google.
   */
  async startSessionFor(
    userId: string,
    context: SessionContext = {},
  ): Promise<{ token: string; expiresAt: Date }> {
    await this.audit(userId, 'user.login.google', context);
    return this.createSession(userId, context);
  }

  /** Whether a reset link can actually reach an inbox from this instance. */
  get emailDelivery(): boolean {
    return this.mailer.canDeliver;
  }

  /** Where the browser lives, for redirects out of API-side callbacks. */
  webUrl(): string {
    return this.config.WEB_URL;
  }

  private async createSession(
    userId: string,
    context: SessionContext,
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = generateToken(32);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    await this.prisma.client.session.create({
      data: {
        userId,
        // Only the hash is stored: a database leak must not yield live
        // session cookies (spec 23).
        tokenHash: hashToken(token),
        expiresAt,
        ip: context.ip ?? null,
        userAgent: context.userAgent ?? null,
      },
    });

    return { token, expiresAt };
  }

  /** Cookie options shared by login, register and logout. */
  cookieOptions(expiresAt?: Date) {
    return {
      httpOnly: true,
      secure: this.config.isProduction,
      sameSite: 'lax' as const,
      path: '/',
      ...(expiresAt ? { expires: expiresAt } : {}),
    };
  }

  private async audit(userId: string, action: string, context: SessionContext): Promise<void> {
    await this.prisma.client.auditLog
      .create({
        data: {
          userId,
          action,
          ip: context.ip ?? null,
          userAgent: context.userAgent ?? null,
        },
      })
      .catch(() => {
        // Audit logging must never block the action it records.
      });
  }
}

export const SESSION_COOKIE = 'omniplay_session';

/**
 * A valid scrypt hash of a value nobody will guess, used to keep login timing
 * uniform for unknown emails.
 */
const DUMMY_HASH =
  'scrypt$65536$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' +
  'ZHVtbXktaGFzaC1ub3QtYS1yZWFsLXBhc3N3b3JkLXZhbHVlLXBhZGRpbmctdG8tNjQtYnl0ZXMh';
