import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { User } from '@omniplay/database';
import { CurrentUser, SessionGuard } from '../auth/auth.guard.js';
import { ProvidersService } from './providers.service.js';
import { SyncService } from '../sync/sync.service.js';
import { ImportService } from './import.service.js';

@Controller()
export class ProvidersController {
  constructor(
    private readonly providers: ProvidersService,
    private readonly sync: SyncService,
    private readonly importer: ImportService,
  ) {}

  /** Connect screen: every configured provider plus the user's connections. */
  @Get('providers')
  @UseGuards(SessionGuard)
  list(@CurrentUser() user: User) {
    return this.providers.listForUser(user.id);
  }

  /**
   * Starts a connection.
   *
   * Returns the URL rather than issuing a 302 so the frontend controls the
   * navigation and can show its own "redirecting to Steam" state.
   */
  @Post('providers/:provider/connect')
  @UseGuards(SessionGuard)
  async connect(
    @CurrentUser() user: User,
    @Param('provider') provider: string,
    @Query('returnTo') returnTo?: string,
  ) {
    return this.providers.beginConnect(user.id, provider, returnTo);
  }

  /**
   * Provider callback.
   *
   * Unauthenticated by design: the browser arrives here from Steam or
   * Microsoft, and identity comes from the single-use state row rather than
   * from a session cookie.
   */
  @Get('auth/providers/:provider/callback')
  async callback(
    @Param('provider') provider: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const params = Object.fromEntries(
      Object.entries(req.query).map(([key, value]) => [
        key,
        Array.isArray(value) ? String(value[0]) : String(value),
      ]),
    );

    try {
      const result = await this.providers.completeConnect(provider, params);

      // A newly connected account is useless until it has data, so kick off
      // the first sync immediately rather than making the user press Sync.
      await this.sync.enqueue(result.userId, provider).catch(() => {
        // A queue outage must not make the connection itself look failed.
      });

      return res.redirect(
        result.returnTo ?? this.webUrl(`/settings?connected=${encodeURIComponent(provider)}`),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed.';
      return res.redirect(
        this.webUrl(
          `/settings?error=${encodeURIComponent(message)}&provider=${encodeURIComponent(provider)}`,
        ),
      );
    }
  }

  /**
   * Uploads a library file for an import-backed provider (spec 5.3).
   *
   * The body is the raw file text rather than multipart: the accepted formats
   * are CSV and JSON, both of which are text, and this keeps the endpoint
   * free of a file-upload dependency.
   */
  @Post('providers/:provider/import')
  @UseGuards(SessionGuard)
  async import(
    @CurrentUser() user: User,
    @Param('provider') provider: string,
    @Req() req: Request,
    @Query('filename') filename?: string,
  ) {
    const content = typeof req.body === 'string' ? req.body : String(req.body ?? '');
    const result = await this.importer.createBatch({
      userId: user.id,
      provider,
      content,
      filename,
    });

    // Ingest immediately: an import the user cannot see the effect of feels
    // like it failed.
    const job = await this.sync.enqueue(user.id, provider, { full: true });

    return { ...result, syncJobId: job.id };
  }

  /** Import history, for the settings screen. */
  @Get('providers/imports')
  @UseGuards(SessionGuard)
  imports(@CurrentUser() user: User) {
    return this.importer.listBatches(user.id);
  }

  @Delete('providers/:provider')
  @UseGuards(SessionGuard)
  async disconnect(
    @CurrentUser() user: User,
    @Param('provider') provider: string,
    @Query('deleteData') deleteData?: string,
  ) {
    return this.providers.disconnect(user.id, provider, deleteData === 'true');
  }

  private webUrl(path: string): string {
    return new URL(path, process.env.WEB_URL ?? 'http://localhost:3000').toString();
  }
}
