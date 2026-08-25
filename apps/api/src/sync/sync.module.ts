import { Module, forwardRef } from '@nestjs/common';
import { Queue } from 'bullmq';
import { SYNC_QUEUE, type SyncJobPayload } from '@omniplay/types';
import { CONFIG, type AppConfig } from '../common/config.js';
import { SyncService } from './sync.service.js';
import { SyncController } from './sync.controller.js';
import { ProvidersModule } from '../providers/providers.module.js';
import { SYNC_QUEUE_TOKEN } from '../common/tokens.js';

@Module({
  imports: [forwardRef(() => ProvidersModule)],
  controllers: [SyncController],
  providers: [
    SyncService,
    {
      provide: SYNC_QUEUE_TOKEN,
      useFactory: (config: AppConfig) =>
        new Queue<SyncJobPayload>(SYNC_QUEUE, {
          connection: { url: config.REDIS_URL },
        }),
      inject: [CONFIG],
    },
  ],
  exports: [SyncService, SYNC_QUEUE_TOKEN],
})
export class SyncModule {}
