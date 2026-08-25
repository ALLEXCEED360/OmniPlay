import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service.js';
import { SyncService } from '../sync/sync.service.js';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: SyncService,
  ) {}

  /** Liveness plus per-provider status for the settings screen (spec 13). */
  @Get()
  async health() {
    let database: 'up' | 'down' = 'up';
    try {
      await this.prisma.client.$queryRaw`SELECT 1`;
    } catch {
      database = 'down';
    }

    return {
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      providers: this.sync.providerHealth(),
      timestamp: new Date().toISOString(),
    };
  }
}
