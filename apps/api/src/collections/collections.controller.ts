import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { User } from '@omniplay/database';
import { CurrentUser, SessionGuard } from '../auth/auth.guard.js';
import { zodBody } from '../common/validation.js';
import { CollectionsService } from './collections.service.js';

const visibility = z.enum(['PRIVATE', 'UNLISTED', 'PUBLIC']);

const createSchema = z.object({
  name: z.string().trim().min(1, 'Give the collection a name.').max(80),
  description: z.string().trim().max(500).optional(),
  visibility: visibility.optional(),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  visibility: visibility.optional(),
});

const gameSchema = z.object({ gameId: z.string().min(1) });
const reorderSchema = z.object({ gameIds: z.array(z.string().min(1)).max(1000) });

@Controller('collections')
@UseGuards(SessionGuard)
export class CollectionsController {
  constructor(private readonly collections: CollectionsService) {}

  @Get()
  list(@CurrentUser() user: User) {
    return this.collections.list(user.id);
  }

  @Post()
  create(@CurrentUser() user: User, @Body() body: unknown) {
    return this.collections.create(user.id, zodBody(createSchema, body));
  }

  @Get(':slug')
  detail(@CurrentUser() user: User, @Param('slug') slug: string) {
    return this.collections.detail(user.id, slug);
  }

  @Patch(':slug')
  update(@CurrentUser() user: User, @Param('slug') slug: string, @Body() body: unknown) {
    return this.collections.update(user.id, slug, zodBody(updateSchema, body));
  }

  @Delete(':slug')
  remove(@CurrentUser() user: User, @Param('slug') slug: string) {
    return this.collections.remove(user.id, slug);
  }

  @Post(':slug/games')
  addGame(@CurrentUser() user: User, @Param('slug') slug: string, @Body() body: unknown) {
    return this.collections.addGame(user.id, slug, zodBody(gameSchema, body).gameId);
  }

  @Delete(':slug/games/:gameId')
  removeGame(
    @CurrentUser() user: User,
    @Param('slug') slug: string,
    @Param('gameId') gameId: string,
  ) {
    return this.collections.removeGame(user.id, slug, gameId);
  }

  @Patch(':slug/order')
  reorder(@CurrentUser() user: User, @Param('slug') slug: string, @Body() body: unknown) {
    return this.collections.reorder(user.id, slug, zodBody(reorderSchema, body).gameIds);
  }
}
