import { Module } from '@nestjs/common';
import { AchievementsService } from './achievements.service.js';
import { AchievementsController } from './achievements.controller.js';

@Module({
  controllers: [AchievementsController],
  providers: [AchievementsService],
  exports: [AchievementsService],
})
export class AchievementsModule {}
