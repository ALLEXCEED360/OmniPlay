import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import type { User } from '@omniplay/database';
import { CurrentUser, SessionGuard } from '../auth/auth.guard.js';
import { zodBody, zodQuery } from '../common/validation.js';
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

/**
 * The user's own verdict. Both fields are nullable and both are optional: a
 * status with no score, a score with no status, or neither, are all things a
 * person can mean. Sending both as null withdraws the verdict entirely.
 */
const verdictSchema = z.object({
  status: z
    .enum(['NOT_STARTED', 'PLAYING', 'PAUSED', 'COMPLETED', 'ABANDONED', 'REPLAYING'])
    .nullable()
    .optional(),
  // Half-steps, matching the column's documented 0-10 range.
  rating: z.number().min(0).max(10).multipleOf(0.5).nullable().optional(),
});

/**
 * A note's whole content. Capped because it is stored and re-rendered on every
 * game page load, not because anyone has written 4,000 words about Bloodborne.
 */
const noteSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Write something first.')
    .max(4000, 'Notes are limited to 4000 characters.'),
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

  @Post('game/:slug/notes')
  addNote(@CurrentUser() user: User, @Param('slug') slug: string, @Body() body: unknown) {
    return this.library.addNote(user.id, slug, zodBody(noteSchema, body).body);
  }

  /** Scoped by user in the query itself, not by a check the caller could skip. */
  @Patch('notes/:id')
  editNote(@CurrentUser() user: User, @Param('id') id: string, @Body() body: unknown) {
    return this.library.editNote(user.id, id, zodBody(noteSchema, body).body);
  }

  @Delete('notes/:id')
  deleteNote(@CurrentUser() user: User, @Param('id') id: string) {
    return this.library.deleteNote(user.id, id);
  }

  /** The one route that writes a status; no sync job may ever touch it. */
  @Put('game/:slug/verdict')
  setVerdict(
    @CurrentUser() user: User,
    @Param('slug') slug: string,
    @Body() body: unknown,
  ) {
    return this.library.setVerdict(user.id, slug, zodBody(verdictSchema, body));
  }
}
