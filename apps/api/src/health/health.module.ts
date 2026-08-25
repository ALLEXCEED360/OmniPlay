import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { SyncModule } from '../sync/sync.module.js';

@Module({ imports: [SyncModule], controllers: [HealthController] })
export class HealthModule {}
