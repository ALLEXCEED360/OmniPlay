import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { User } from '@omniplay/database';
import { CurrentUser, SessionGuard } from '../auth/auth.guard.js';
import { zodQuery } from '../common/validation.js';
import { LibraryService } from './library.service.js';

/** Comma-separated query params: ?providers=steam,xbox */
const csv = z
  .string()
  .optional()
  .transform((value) => (value ? value.split(',').filter(Boolean) : undefined));

const listQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  providers: csv,
  statuses: csv,
  ownership: z.enum(['owned', 'previously-owned', 'all']).optional(),
  sort: z.enum(['name', 'release', 'rating', 'recent']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  // Capped so a crafted request cannot ask for the entire library at once.
  pageSize: z.coerce.number().int().min(1).max(100).default(48),
});

@Controller('library')
@UseGuards(SessionGuard)
export class LibraryController {
  constructor(private readonly library: LibraryService) {}

  @Get()
  list(@CurrentUser() user: User, @Query() query: unknown) {
    return this.library.list(user.id, zodQuery(listQuerySchema, query));
  }

  @Get('game/:slug')
  detail(@CurrentUser() user: User, @Param('slug') slug: string) {
    return this.library.detail(user.id, slug);
  }
}
