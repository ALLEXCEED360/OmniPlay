import { Module } from '@nestjs/common';
import { CommonModule } from './common/common.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ProvidersModule } from './providers/providers.module.js';
import { SyncModule } from './sync/sync.module.js';
import { LibraryModule } from './library/library.module.js';
import { StatsModule } from './stats/stats.module.js';
import { HealthModule } from './health/health.module.js';
import { CollectionsModule } from './collections/collections.module.js';
import { ProfileModule } from './profile/profile.module.js';
import { AdminModule } from './admin/admin.module.js';
import { AchievementsModule } from './achievements/achievements.module.js';

/**
 * Modular monolith (spec 1: "modular monolith + background workers + provider
 * adapter layer"). Every module is independently extractable later, but for
 * now one process keeps deployment and local development simple.
 */
@Module({
  imports: [
    CommonModule,
    AuthModule,
    ProvidersModule,
    SyncModule,
    LibraryModule,
    StatsModule,
    HealthModule,
    CollectionsModule,
    ProfileModule,
    AdminModule,
    AchievementsModule,
  ],
})
export class AppModule {}
