import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { prisma } from '@omniplay/database';
import type { PrismaClient } from '@omniplay/database';

/**
 * Wraps the shared Prisma singleton in a Nest provider so controllers and
 * services can inject it, while dev hot-reload still reuses one connection
 * pool rather than opening a new one per rebuild.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly client: PrismaClient = prisma;

  async onModuleInit(): Promise<void> {
    await this.client.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
