import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { EmptyState, PageHeader, SectionHeading } from '@/components/ui';
import { CreateCollectionButton } from '@/components/collection-form';
import { staggerStep } from '@/lib/platform';
import type { CSSProperties } from 'react';

/**
 * Collections index (spec 4.6).
 *
 * The one part of the library the user authors entirely — no sync ever writes
 * here, which is what makes a collection safe to publish.
 */

interface CollectionSummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  visibility: 'PRIVATE' | 'UNLISTED' | 'PUBLIC';
  gameCount: number;
  covers: string[];
  updatedAt: string;
}

const VISIBILITY_LABELS: Record<string, string> = {
  PRIVATE: 'Private',
  UNLISTED: 'Unlisted',
  PUBLIC: 'Public',
};

export default async function CollectionsPage() {
  const collections = await apiFetch<CollectionSummary[]>('/collections');

  return (
    <>
      <PageHeader
        eyebrow="The part you author"
        title="Collections"
        subtitle="Your own way of organising your catalogue. Nothing syncs into these — you write them."
        action={<CreateCollectionButton />}
      />

      {collections.length === 0 ? (
        <EmptyState
          title="No collections yet"
          description="Group games however you like — all-time favourites, childhood games, things to replay. Collections can stay private or be shared on your profile."
          action={<CreateCollectionButton />}
        />
      ) : (
        <div
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          style={{ '--stagger-step': staggerStep(collections.length) } as CSSProperties}
        >
          {collections.map((collection, index) => (
            <Link
              key={collection.id}
              href={`/collections/${collection.slug}`}
              style={{ '--i': index } as CSSProperties}
              className="card group anim-rise stagger lift overflow-hidden"
            >
              {/* A 2x2 mosaic of covers gives each collection a face. */}
              <div className="grid aspect-[16/9] grid-cols-2 grid-rows-2 gap-px bg-ink-850">
                {Array.from({ length: 4 }).map((_, index) => {
                  const cover = collection.covers[index];
                  return cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={index}
                      src={cover}
                      alt=""
                      className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.08]"
                    />
                  ) : (
                    <div key={index} className="bg-ink-900" />
                  );
                })}
              </div>

              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-medium text-ink-100 transition-colors group-hover:text-accent">
                    {collection.name}
                  </h2>
                  {collection.visibility !== 'PRIVATE' ? (
                    <span className="shrink-0 rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] text-accent">
                      {VISIBILITY_LABELS[collection.visibility]}
                    </span>
                  ) : null}
                </div>
                {collection.description ? (
                  <p className="mt-1 line-clamp-2 text-xs text-ink-500">{collection.description}</p>
                ) : null}
                <p className="mt-2 text-xs text-ink-600">
                  {collection.gameCount} {collection.gameCount === 1 ? 'game' : 'games'}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}

      <section className="anim-rise mt-12">
        <SectionHeading>Ideas</SectionHeading>
        <p className="text-sm leading-relaxed text-ink-500">
          All-Time Favourites · Childhood Games · 100% Completed · Games I Want to Replay ·
          Soulslikes · Games With Friends · Game of the Year Candidates
        </p>
      </section>
    </>
  );
}
