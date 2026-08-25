import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { User } from '@omniplay/database';
import { CurrentUser } from '../auth/auth.guard.js';
import { zodBody, zodQuery } from '../common/validation.js';
import { AdminGuard } from './admin.guard.js';
import { AdminService } from './admin.service.js';

const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  state: z.enum(['PENDING', 'RESOLVED', 'IGNORED']).optional(),
});

const mapSchema = z.object({ gameId: z.string().min(1) });
const createSchema = z.object({ name: z.string().trim().min(1).max(200).optional() });
const mergeSchema = z.object({
  loserId: z.string().min(1),
  winnerId: z.string().min(1),
});
const enrichSchema = z.object({
  gameIds: z.array(z.string().min(1)).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('overview')
  overview() {
    return this.admin.overview();
  }

  @Get('unresolved')
  unresolved(@Query() query: unknown) {
    return this.admin.unresolved(zodQuery(pageSchema, query));
  }

  @Post('unresolved/:id/map')
  map(@CurrentUser() user: User, @Param('id') id: string, @Body() body: unknown) {
    return this.admin.resolveToGame(id, zodBody(mapSchema, body).gameId, user.id);
  }

  @Post('unresolved/:id/create')
  create(@CurrentUser() user: User, @Param('id') id: string, @Body() body: unknown) {
    return this.admin.createGameFrom(id, user.id, zodBody(createSchema, body ?? {}).name);
  }

  @Post('unresolved/:id/ignore')
  ignore(@CurrentUser() user: User, @Param('id') id: string) {
    return this.admin.ignore(id, user.id);
  }

  @Post('unresolved/sweep')
  sweep(@CurrentUser() user: User, @Query('dryRun') dryRun?: string) {
    return this.admin.sweepQueue(user.id, dryRun === 'true');
  }

  @Get('games/provisional')
  provisional(@Query() query: unknown) {
    return this.admin.provisionalGames(zodQuery(pageSchema, query));
  }

  @Get('games/duplicates')
  duplicates() {
    return this.admin.duplicateGames();
  }

  @Post('games/merge')
  merge(@CurrentUser() user: User, @Body() body: unknown) {
    return this.admin.merge(zodBody(mergeSchema, body), user.id);
  }

  @Post('enrich')
  enrich(@CurrentUser() user: User, @Body() body: unknown) {
    return this.admin.enqueueEnrichment(zodBody(enrichSchema, body ?? {}), user.id);
  }

  @Get('sync-failures')
  failures() {
    return this.admin.failedSyncs();
  }
}
