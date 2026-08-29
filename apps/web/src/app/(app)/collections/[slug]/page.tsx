import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/api';
import { EmptyState, PageHeader } from '@/components/ui';
import { staggerStep } from '@/lib/platform';
import type { CSSProperties } from 'react';
import { CollectionControls, RemoveFromCollection } from '@/components/collection-form';

interface CollectionDetail {
  name: string;
  slug: string;
  description: string | null;
  visibility: string;
  games: Array<{
    id: string;
    name: string;
    slug: string;
    coverImage: string | null;
    genres: string[];
  }>;
}

export default async function CollectionPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  let collection: CollectionDetail;
  let me: { user: { username: string } };
  try {
    [collection, me] = await Promise.all([
      apiFetch<CollectionDetail>(`/collections/${encodeURIComponent(slug)}`),
      apiFetch<{ user: { username: string } }>('/auth/me'),
    ]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  return (
    <>
      <PageHeader
        title={collection.name}
        subtitle={
          collection.description ??
          `${collection.games.length} ${collection.games.length === 1 ? 'game' : 'games'}`
        }
        action={
          <CollectionControls
            slug={collection.slug}
            visibility={collection.visibility}
            username={me.user.username}
          />
        }
      />

      {collection.games.length === 0 ? (
        <EmptyState
          title="Nothing in here yet"
          description="Open any game and add it to this collection."
          action={
            <Link
              href="/library"
              className="btn-primary"
            >
              Browse your library
            </Link>
          }
        />
      ) : (
        <div
          className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6"
          style={{ '--stagger-step': staggerStep(collection.games.length) } as CSSProperties}
        >
          {collection.games.map((game, index) => (
            <div
              key={game.id}
              style={{ '--i': index } as CSSProperties}
              className="group anim-rise stagger relative"
            >
              <RemoveFromCollection slug={collection.slug} gameId={game.id} />
              <Link
                href={`/game/${game.slug}`}
                className="lift block overflow-hidden rounded-[var(--radius-card)] border border-ink-800 bg-ink-900"
              >
                <div className="aspect-[3/4] overflow-hidden bg-ink-850">
                  {game.coverImage ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={game.coverImage}
                      alt=""
                      className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.07]"
                    />
                  ) : (
                    <div className="grid size-full place-items-center px-2 text-center text-xs text-ink-600">
                      {game.name}
                    </div>
                  )}
                </div>
                <div className="line-clamp-2 px-2.5 py-2 text-xs text-ink-300">{game.name}</div>
              </Link>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
