import { Module } from '@nestjs/common';
import { Queue } from 'bullmq';
import { METADATA_QUEUE, type MetadataJobPayload } from '@omniplay/types';
import { CONFIG, type AppConfig } from '../common/config.js';
import { METADATA_QUEUE_TOKEN } from '../common/tokens.js';
import { AdminService } from './admin.service.js';
import { AdminController } from './admin.controller.js';
import { AdminGuard } from './admin.guard.js';

@Module({
  controllers: [AdminController],
  providers: [
    AdminService,
    AdminGuard,
    {
      provide: METADATA_QUEUE_TOKEN,
      useFactory: (config: AppConfig) =>
        new Queue<MetadataJobPayload>(METADATA_QUEUE, { connection: { url: config.REDIS_URL } }),
      inject: [CONFIG],
    },
  ],
})
export class AdminModule {}
