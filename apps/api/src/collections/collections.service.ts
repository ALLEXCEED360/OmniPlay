import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { slugify } from '@omniplay/game-matching';
import type { CollectionVisibility } from '@omniplay/database';
import { PrismaService } from '../common/prisma.service.js';

/**
 * User-curated collections (spec 4.6).
 *
 * Collections are the one part of the library the user authors entirely. A
 * sync never creates, modifies or removes one — which is why they can be
 * shared publicly without leaking anything imported that the user did not
 * choose to show.
 */
@Injectable()
export class CollectionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const collections = await this.prisma.client.collection.findMany({
      where: { userId },
      include: {
        // Just enough for a cover mosaic on the index page.
        games: {
          take: 4,
          orderBy: { position: 'asc' },
          include: { game: { select: { coverImage: true, name: true } } },
        },
        _count: { select: { games: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return collections.map((collection) => ({
      id: collection.id,
      name: collection.name,
      slug: collection.slug,
      description: collection.description,
      visibility: collection.visibility,
      gameCount: collection._count.games,
      covers: collection.games.map((entry) => entry.game.coverImage).filter(Boolean),
      updatedAt: collection.updatedAt,
    }));
  }

  async create(userId: string, input: { name: string; description?: string; visibility?: CollectionVisibility }) {
    const slug = await this.uniqueSlug(userId, slugify(input.name));

    return this.prisma.client.collection.create({
      data: {
        userId,
        name: input.name.trim(),
        slug,
        description: input.description?.trim() || null,
        visibility: input.visibility ?? 'PRIVATE',
      },
    });
  }

  async detail(userId: string, slug: string) {
    const collection = await this.prisma.client.collection.findUnique({
      where: { userId_slug: { userId, slug } },
      include: {
        games: {
          orderBy: { position: 'asc' },
          include: {
            game: {
              select: {
                id: true,
                name: true,
                slug: true,
                coverImage: true,
                genres: true,
                firstReleaseDate: true,
              },
            },
          },
        },
      },
    });
    if (!collection) throw new NotFoundException('Collection not found.');

    return {
      ...collection,
      games: collection.games.map((entry) => ({ ...entry.game, position: entry.position })),
    };
  }

  async update(
    userId: string,
    slug: string,
    input: { name?: string; description?: string | null; visibility?: CollectionVisibility },
  ) {
    const collection = await this.requireOwned(userId, slug);

    return this.prisma.client.collection.update({
      where: { id: collection.id },
      data: {
        ...(input.name ? { name: input.name.trim() } : {}),
        ...(input.description !== undefined
          ? { description: input.description?.trim() || null }
          : {}),
        ...(input.visibility ? { visibility: input.visibility } : {}),
      },
    });
  }

  async remove(userId: string, slug: string) {
    const collection = await this.requireOwned(userId, slug);
    // Cascades to CollectionGame. The games themselves are untouched.
    await this.prisma.client.collection.delete({ where: { id: collection.id } });
    return { deleted: true };
  }

  async addGame(userId: string, slug: string, gameId: string) {
    const collection = await this.requireOwned(userId, slug);

    const game = await this.prisma.client.game.findUnique({
      where: { id: gameId },
      select: { id: true },
    });
    if (!game) throw new NotFoundException('Game not found.');

    const existing = await this.prisma.client.collectionGame.findUnique({
      where: { collectionId_gameId: { collectionId: collection.id, gameId } },
    });
    if (existing) throw new ConflictException('That game is already in this collection.');

    // Append to the end rather than reordering everything.
    const last = await this.prisma.client.collectionGame.findFirst({
      where: { collectionId: collection.id },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    await this.prisma.client.collectionGame.create({
      data: {
        collectionId: collection.id,
        gameId,
        position: (last?.position ?? -1) + 1,
      },
    });

    // Keeps the index page's "recently updated" ordering meaningful.
    await this.touch(collection.id);
    return { added: true };
  }

  async removeGame(userId: string, slug: string, gameId: string) {
    const collection = await this.requireOwned(userId, slug);

    await this.prisma.client.collectionGame
      .delete({ where: { collectionId_gameId: { collectionId: collection.id, gameId } } })
      .catch(() => {
        throw new NotFoundException('That game is not in this collection.');
      });

    await this.touch(collection.id);
    return { removed: true };
  }

  /** Applies an explicit ordering, for drag-and-drop reordering. */
  async reorder(userId: string, slug: string, gameIds: string[]) {
    const collection = await this.requireOwned(userId, slug);

    await this.prisma.client.$transaction(
      gameIds.map((gameId, index) =>
        this.prisma.client.collectionGame.updateMany({
          where: { collectionId: collection.id, gameId },
          data: { position: index },
        }),
      ),
    );

    await this.touch(collection.id);
    return { reordered: true };
  }

  private async requireOwned(userId: string, slug: string) {
    const collection = await this.prisma.client.collection.findUnique({
      where: { userId_slug: { userId, slug } },
      select: { id: true, userId: true },
    });
    if (!collection) throw new NotFoundException('Collection not found.');
    // Belt and braces: the unique key is already user-scoped, but an
    // ownership check here means a future lookup-by-id cannot skip it.
    if (collection.userId !== userId) throw new ForbiddenException('Not your collection.');
    return collection;
  }

  private async touch(collectionId: string): Promise<void> {
    await this.prisma.client.collection.update({
      where: { id: collectionId },
      data: { updatedAt: new Date() },
    });
  }

  private async uniqueSlug(userId: string, base: string): Promise<string> {
    const candidate = base || 'collection';
    for (let suffix = 0; suffix < 100; suffix++) {
      const slug = suffix === 0 ? candidate : `${candidate}-${suffix}`;
      const taken = await this.prisma.client.collection.findUnique({
        where: { userId_slug: { userId, slug } },
        select: { id: true },
      });
      if (!taken) return slug;
    }
    return `${candidate}-${Date.now()}`;
  }
}
