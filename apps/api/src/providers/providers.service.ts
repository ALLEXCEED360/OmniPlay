import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { generateToken, safeEquals, toCredentialRow } from '@omniplay/database';
import { ProviderError, type ProviderId } from '@omniplay/types';
import { ProviderRegistry } from '@omniplay/providers';
import { PrismaService } from '../common/prisma.service.js';
import { CONFIG, type AppConfig } from '../common/config.js';
import { PROVIDER_REGISTRY } from '../common/tokens.js';

/** OAuth state rows are short-lived; a connect flow that stalls is abandoned. */
const STATE_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class ProvidersService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(PROVIDER_REGISTRY) private readonly registry: ProviderRegistry,
  ) {}

  /** What the connect screen and the privacy matrix render (spec 24). */
  async listForUser(userId: string) {
    const accounts = await this.prisma.client.connectedAccount.findMany({
      where: { userId },
      select: {
        id: true,
        provider: true,
        providerUserId: true,
        displayName: true,
        avatar: true,
        profileUrl: true,
        status: true,
        statusMessage: true,
        connectedAt: true,
        lastSyncAt: true,
      },
    });

    const byProvider = new Map(accounts.map((a) => [a.provider, a]));

    // Built from the catalogue, not from the configured adapters: a provider
    // missing its credentials must still appear, carrying the setup steps.
    return this.registry.catalogue(process.env).map((provider) => ({
      ...provider,
      connected: byProvider.get(provider.id) ?? null,
    }));
  }

  /**
   * Starts a provider connection: creates the CSRF state row and returns the
   * URL to send the browser to.
   */
  async beginConnect(userId: string, providerId: ProviderId, returnTo?: string) {
    const provider = this.registry.find(providerId);
    if (!provider) {
      throw new NotFoundException(`${providerId} is not available on this instance.`);
    }

    // A provider reached through a key the instance holds has no browser
    // round-trip to make — connecting is just discovering whose account the
    // key speaks for. The flow branches on the capability, not the name.
    if (provider.connectDirect) {
      const result = await provider.connectDirect();
      await this.persistConnection(userId, providerId, result);
      return { connected: true as const };
    }

    const redirectUri = this.callbackUrl(providerId);
    const start = await provider.beginAuth({ redirectUri });

    await this.prisma.client.oAuthState.create({
      data: {
        state: start.state,
        userId,
        provider: providerId,
        verifier: start.verifier ?? null,
        redirectUri,
        returnTo: this.safeReturnTo(returnTo),
        expiresAt: new Date(Date.now() + STATE_TTL_MS),
      },
    });

    return { redirectUrl: start.redirectUrl };
  }

  /**
   * Completes a provider connection.
   *
   * The state row is consumed before the provider exchange, so a replayed
   * callback cannot be used twice even if the first attempt failed partway.
   */
  async completeConnect(providerId: ProviderId, params: Record<string, string>) {
    const stateValue = params['state'];
    if (!stateValue) throw new BadRequestException('Missing state parameter.');

    const stateRow = await this.prisma.client.oAuthState.findUnique({
      where: { state: stateValue },
    });
    if (!stateRow || stateRow.provider !== providerId) {
      throw new BadRequestException('This sign-in link is invalid or has already been used.');
    }

    // Single-use, whatever happens next.
    await this.prisma.client.oAuthState.delete({ where: { id: stateRow.id } }).catch(() => {});

    if (stateRow.expiresAt <= new Date()) {
      throw new BadRequestException('This sign-in link expired. Please try connecting again.');
    }
    if (!safeEquals(stateRow.state, stateValue)) {
      throw new BadRequestException('Sign-in state did not match.');
    }

    const provider = this.registry.get(providerId);

    let result;
    try {
      result = await provider.completeAuth({
        params,
        state: stateRow.state,
        ...(stateRow.verifier ? { verifier: stateRow.verifier } : {}),
        redirectUri: stateRow.redirectUri,
      });
    } catch (error) {
      if (error instanceof ProviderError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    const account = await this.persistConnection(stateRow.userId, providerId, result);

    return { account, returnTo: stateRow.returnTo, userId: stateRow.userId };
  }

  /** Writes the connection and its encrypted credentials. */
  private async persistConnection(
    userId: string,
    providerId: ProviderId,
    result: { account: { providerUserId: string; displayName: string | null; avatarUrl: string | null; profileUrl: string | null }; credentials: Parameters<typeof toCredentialRow>[0]; status: 'ACTIVE' | 'REAUTH_REQUIRED' | 'DISABLED' | 'REVOKED' },
  ) {
    // Refuse to let two OMNIPLAY users claim the same provider account.
    const claimedElsewhere = await this.prisma.client.connectedAccount.findUnique({
      where: {
        provider_providerUserId: {
          provider: providerId,
          providerUserId: result.account.providerUserId,
        },
      },
      select: { userId: true },
    });
    if (claimedElsewhere && claimedElsewhere.userId !== userId) {
      throw new BadRequestException(
        `That ${providerId} account is already linked to another OMNIPLAY user.`,
      );
    }

    const account = await this.prisma.client.connectedAccount.upsert({
      where: { userId_provider: { userId, provider: providerId } },
      create: {
        userId,
        provider: providerId,
        providerUserId: result.account.providerUserId,
        displayName: result.account.displayName,
        avatar: result.account.avatarUrl,
        profileUrl: result.account.profileUrl,
        status: result.status,
      },
      update: {
        providerUserId: result.account.providerUserId,
        displayName: result.account.displayName,
        avatar: result.account.avatarUrl,
        profileUrl: result.account.profileUrl,
        status: result.status,
        statusMessage: null,
      },
    });

    // Tokens are encrypted on the way in; nothing else writes this table.
    const credentialFields = toCredentialRow(result.credentials);
    await this.prisma.client.providerCredential.upsert({
      where: { connectedAccountId: account.id },
      create: { connectedAccountId: account.id, ...credentialFields },
      update: credentialFields,
    });

    await this.prisma.client.auditLog.create({
      data: { userId, action: 'provider.connect', target: providerId },
    });

    return account;
  }

  /**
   * Disconnects a provider.
   *
   * `deleteData` distinguishes the two things a user might mean (spec 23):
   * unlinking the account, versus erasing everything that came from it.
   */
  async disconnect(userId: string, providerId: ProviderId, deleteData: boolean) {
    const account = await this.prisma.client.connectedAccount.findUnique({
      where: { userId_provider: { userId, provider: providerId } },
    });
    if (!account) throw new NotFoundException(`No ${providerId} account is connected.`);

    const provider = this.registry.find(providerId);
    if (provider?.disconnect) {
      // Best effort: a provider that will not accept our revocation must not
      // prevent the user from unlinking locally.
      await provider
        .disconnect({ providerUserId: account.providerUserId, credentials: {} })
        .catch(() => {});
    }

    await this.prisma.client.$transaction(async (tx) => {
      if (deleteData) {
        await tx.ownership.deleteMany({ where: { userId, provider: providerId } });
        await tx.playActivity.deleteMany({ where: { userId, provider: providerId } });
        await tx.userAchievement.deleteMany({
          where: { userId, achievement: { provider: providerId } },
        });
        await tx.syncCursor.deleteMany({ where: { userId, provider: providerId } });
      }
      // Cascades to ProviderCredential.
      await tx.connectedAccount.delete({ where: { id: account.id } });
      await tx.auditLog.create({
        data: {
          userId,
          action: deleteData ? 'provider.disconnect_and_purge' : 'provider.disconnect',
          target: providerId,
        },
      });
    });

    return { disconnected: true, dataDeleted: deleteData };
  }

  callbackUrl(providerId: ProviderId): string {
    return new URL(`/auth/providers/${providerId}/callback`, this.config.API_URL).toString();
  }

  /** Only ever redirect back into our own web app. */
  private safeReturnTo(returnTo: string | undefined): string | null {
    if (!returnTo) return null;
    try {
      const target = new URL(returnTo, this.config.WEB_URL);
      const allowed = new URL(this.config.WEB_URL);
      return target.origin === allowed.origin ? target.toString() : null;
    } catch {
      return null;
    }
  }

  /** Fresh CSRF token for flows that need one outside the OAuth dance. */
  static newState(): string {
    return generateToken(32);
  }
}
