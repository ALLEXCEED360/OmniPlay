import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { User } from '@omniplay/database';
import { CurrentUser, SessionGuard } from '../auth/auth.guard.js';
import { zodBody } from '../common/validation.js';
import { SyncService } from './sync.service.js';

const syncOptionsSchema = z
  .object({
    full: z.boolean().optional(),
    includeAchievements: z.boolean().optional(),
  })
  .default({});

@Controller('sync')
@UseGuards(SessionGuard)
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  /** "Sync All" - queues every connected provider. */
  @Post('all')
  all(@CurrentUser() user: User, @Body() body: unknown) {
    return this.sync.enqueueAll(user.id, zodBody(syncOptionsSchema, body ?? {}));
  }

  @Post(':provider')
  one(@CurrentUser() user: User, @Param('provider') provider: string, @Body() body: unknown) {
    return this.sync.enqueue(user.id, provider, zodBody(syncOptionsSchema, body ?? {}));
  }

  /** Polled by the sync progress UI. */
  @Get('jobs')
  jobs(@CurrentUser() user: User) {
    return this.sync.recentJobs(user.id);
  }

  @Get('jobs/:id')
  job(@CurrentUser() user: User, @Param('id') id: string) {
    return this.sync.getJob(user, id);
  }
}
