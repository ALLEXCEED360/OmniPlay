import { Module } from '@nestjs/common';
import { ProfileService } from './profile.service.js';
import { ProfileController } from './profile.controller.js';
import { AchievementsModule } from '../achievements/achievements.module.js';
import { StatsModule } from '../stats/stats.module.js';

@Module({
  imports: [AchievementsModule, StatsModule],
  controllers: [ProfileController],
  providers: [ProfileService],
})
export class ProfileModule {}
