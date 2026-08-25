import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import type { User } from '@omniplay/database';
import { CurrentUser, SessionGuard } from '../auth/auth.guard.js';
import { AchievementsService } from './achievements.service.js';

@Controller('achievements')
@UseGuards(SessionGuard)
export class AchievementsController {
  constructor(private readonly achievements: AchievementsService) {}

  @Get()
  overview(@CurrentUser() user: User) {
    return this.achievements.overview(user.id);
  }

  @Get('game/:slug')
  forGame(@CurrentUser() user: User, @Param('slug') slug: string) {
    return this.achievements.forGame(user.id, slug);
  }
}
