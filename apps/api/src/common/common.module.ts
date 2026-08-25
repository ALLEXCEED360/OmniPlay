import { Global, Module } from '@nestjs/common';
import { CONFIG, loadConfig } from './config.js';
import { PrismaService } from './prisma.service.js';

/**
 * Config and the database handle are needed by nearly every module, so they
 * are global rather than re-imported everywhere. Both are single instances for
 * the life of the process.
 */
@Global()
@Module({
  providers: [PrismaService, { provide: CONFIG, useFactory: () => loadConfig() }],
  exports: [PrismaService, CONFIG],
})
export class CommonModule {}
