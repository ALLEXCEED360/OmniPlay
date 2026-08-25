import { Module } from '@nestjs/common';
import { createProviderRegistry, ProviderRegistry } from '@omniplay/providers';
import { CONFIG, type AppConfig } from '../common/config.js';
import { ProvidersService } from './providers.service.js';
import { ImportService } from './import.service.js';
import { createImportRecordLoader } from '@omniplay/database';
import { PrismaService } from '../common/prisma.service.js';
import { ProvidersController } from './providers.controller.js';
import { SyncModule } from '../sync/sync.module.js';
import { PROVIDER_REGISTRY } from '../common/tokens.js';

@Module({
  imports: [SyncModule],
  controllers: [ProvidersController],
  providers: [
    ProvidersService,
    ImportService,
    {
      provide: PROVIDER_REGISTRY,
      // Built once at boot from config, so an unconfigured provider simply
      // never appears rather than failing at request time.
      // The loader is what makes the file-backed providers (PlayStation,
      // manual entry) available; without it they are not registered at all.
      useFactory: (config: AppConfig, prisma: PrismaService): ProviderRegistry =>
        createProviderRegistry(config, {
          loadImportRecords: createImportRecordLoader(prisma.client),
        }),
      inject: [CONFIG, PrismaService],
    },
  ],
  exports: [ProvidersService, ImportService, PROVIDER_REGISTRY],
})
export class ProvidersModule {}
