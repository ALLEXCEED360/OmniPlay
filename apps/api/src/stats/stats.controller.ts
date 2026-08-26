import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { User } from '@omniplay/database';
import { CurrentUser, SessionGuard } from '../auth/auth.guard.js';
import { zodQuery } from '../common/validation.js';
import { StatsService } from './stats.service.js';

const yearSchema = z.coerce.number().int().min(1970).max(2100);

@Controller('stats')
@UseGuards(SessionGuard)
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  @Get('overview')
  overview(@CurrentUser() user: User) {
    return this.stats.overview(user.id);
  }

  @Get('timeline')
  timeline(@CurrentUser() user: User) {
    return this.stats.timeline(user.id);
  }

  @Get('playtime')
  playtime(@CurrentUser() user: User) {
    return this.stats.playtimeRanking(user.id);
  }

  @Get('year/:year')
  year(@CurrentUser() user: User, @Param('year') year: string) {
    return this.stats.year(user.id, zodQuery(yearSchema, year));
  }
}
