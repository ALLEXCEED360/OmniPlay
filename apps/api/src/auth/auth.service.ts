import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { generateToken, hashToken } from '@omniplay/database';
import type { User } from '@omniplay/database';
import { slugify } from '@omniplay/game-matching';
import { PrismaService } from '../common/prisma.service.js';
import { CONFIG, type AppConfig } from '../common/config.js';
import { hashPassword, verifyPassword } from './password.js';

/** How long a session cookie stays valid without re-authentication. */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface SessionContext {
  ip?: string | undefined;
  userAgent?: string | undefined;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONFIG) private readonly config: AppConfig,
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
