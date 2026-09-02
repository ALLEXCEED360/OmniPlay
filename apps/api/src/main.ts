import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { loadConfig } from './common/config.js';

/**
 * API bootstrap.
 *
 * Configuration is validated before Nest starts, so a missing
 * CREDENTIAL_ENCRYPTION_KEY fails here with a readable message rather than
 * surfacing later as a decryption error inside a sync job.
 */
async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const logger = new Logger('bootstrap');

  const app = await NestFactory.create(AppModule, {
    logger: config.isProduction ? ['log', 'warn', 'error'] : ['debug', 'log', 'warn', 'error'],
  });

  app.use(helmet({
    // The API serves JSON, never HTML, so the default CSP would only get in
    // the way of the OAuth redirect responses.
    contentSecurityPolicy: false,
  }));
  app.use(cookieParser());

  // Library imports arrive as a raw CSV/JSON body. Registered before the JSON
  // parser so a text/csv upload is not rejected as malformed JSON, and capped
  // to match the limit ImportService enforces.
  app.use(express.text({ type: ['text/*', 'application/csv'], limit: '5mb' }));

  // Credentials must be allowed: the session is a cookie, not a bearer token.
  app.enableCors({
    origin: config.WEB_URL,
    credentials: true,
  });

  // No global ValidationPipe: every handler validates through zodBody/zodQuery,
  // and Nest's pipe would pull in class-validator for nothing.

  // Mail configuration that is half-done is worse than mail that is off,
  // because it works exactly once — for whoever owns the Resend account — and
  // then silently fails for every real user. Said at boot rather than left to
  // be discovered by someone who never received their reset link.
  if (config.RESEND_API_KEY && /onboarding@resend\.dev/i.test(config.MAIL_FROM)) {
    logger.warn(
      "MAIL_FROM is Resend's shared sender, which only delivers to the address that " +
        'owns the Resend account. Password resets will fail for everyone else. ' +
        'Verify a domain at resend.com/domains and set MAIL_FROM to an address on it.',
    );
  }

  app.enableShutdownHooks();

  await app.listen(config.PORT, '0.0.0.0');
  logger.log(`OMNIPLAY API listening on ${config.API_URL}`);
}

bootstrap().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start the OMNIPLAY API:\n', error);
  process.exitCode = 1;
});
