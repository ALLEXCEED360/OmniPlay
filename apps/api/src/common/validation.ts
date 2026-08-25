import { BadRequestException } from '@nestjs/common';
import type { z } from 'zod';

/**
 * Validates a request body against a Zod schema, turning failures into a 400
 * with field-level messages the frontend can render inline.
 *
 * Zod rather than class-validator: the schemas are plain values, so the same
 * shape can be shared with the worker and the web app without dragging
 * decorator metadata across package boundaries.
 */
export function zodBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_';
      fieldErrors[key] ??= issue.message;
    }
    throw new BadRequestException({
      message: 'Some fields need attention.',
      errors: fieldErrors,
    });
  }
  return result.data;
}

/** Same, for query strings and route parameters. */
export function zodQuery<T>(schema: z.ZodType<T>, query: unknown): T {
  return zodBody(schema, query);
}
