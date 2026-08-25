import { PrismaClient } from '@prisma/client';

/**
 * One PrismaClient per process.
 *
 * The global cache matters in dev: Next.js and Nest both hot-reload modules,
 * and a fresh client per reload exhausts the Postgres connection limit within
 * a few saves.
 */
const globalForPrisma = globalThis as unknown as { omniplayPrisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.omniplayPrisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['warn', 'error']
        : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.omniplayPrisma = prisma;
}

export type { PrismaClient };
export * from '@prisma/client';
