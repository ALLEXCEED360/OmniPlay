import { z } from 'zod';

/**
 * Environment validation.
 *
 * Fail at boot, loudly, with the name of the missing variable - never at 2am
 * inside a sync job with a `undefined is not a string`.
 *
 * Provider credentials are optional so a contributor can run OMNIPLAY with
 * only Steam configured, or with none at all; the registry simply will not
 * offer the unconfigured ones.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required.'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required.'),

  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters.'),
  CREDENTIAL_ENCRYPTION_KEY: z
    .string()
    .min(32, 'CREDENTIAL_ENCRYPTION_KEY must be at least 32 characters.'),

  API_URL: z.string().url().default('http://localhost:4000'),
  WEB_URL: z.string().url().default('http://localhost:3000'),

  STEAM_API_KEY: z.string().optional(),
  STEAM_REALM: z.string().optional(),

  XBOX_CLIENT_ID: z.string().optional(),
  XBOX_CLIENT_SECRET: z.string().optional(),

  IGDB_CLIENT_ID: z.string().optional(),
  IGDB_CLIENT_SECRET: z.string().optional(),
});

export type AppConfig = z.infer<typeof schema> & {
  isProduction: boolean;
};

let cached: AppConfig | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (cached) return cached;

  const result = schema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  cached = { ...result.data, isProduction: result.data.NODE_ENV === 'production' };
  return cached;
}

/** Test seam. */
export function resetConfigCache(): void {
  cached = null;
}

export const CONFIG = Symbol('OMNIPLAY_CONFIG');
