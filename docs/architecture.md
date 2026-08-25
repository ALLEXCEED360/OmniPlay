# Architecture

Reference for the decisions that are hard to infer from the code, and the
reasoning behind them.

---

## The data model's central distinction

The schema separates four things that a naive library tracker would collapse
into one table:

| Table | Question it answers | Written by |
|---|---|---|
| `Ownership` | Do I have (or did I have) access to this? | Sync, when a provider reports entitlement |
| `PlayActivity` | Is there evidence I played it, and how much? | Sync |
| `UserAchievement` | What have I unlocked? | Sync |
| `UserGameStatus` | What do *I* say about it? | **Only the user, never a sync** |

Collapsing these produces wrong answers immediately. Xbox's title history
proves activity without proving ownership. A Steam library entry proves
ownership without proving the game was ever launched. A game finished on a
friend's console is history with neither.

### Ownership is never deleted

When a provider stops listing a title, the row gets `removedAt` set rather than
being deleted. "I used to own this" is part of the history the product exists to
preserve. Re-appearing in a later sync clears `removedAt` — the user reacquired
it.

This only runs after a *complete* library read. An incremental sync legitimately
returns a subset, and marking the remainder as removed would be wrong.

### Provenance

Every meaningful row carries `source`, `confidence` and an observation time.

| Confidence | Meaning |
|---|---|
| `VERIFIED` | The provider stated it directly |
| `DERIVED` | We inferred it from provider data we trust |
| `DETECTED` | Activity implied, shape unknown (Xbox title history) |
| `DECLARED` | The user asserted it |
| `UNCERTAIN` | Imported or fuzzy-matched |

This is surfaced in the UI, not just stored. A number derived from achievement
history should not look identical to one Steam stated outright.

---

## Playtime: the non-additive problem

**Steam reports a lifetime total that it overwrites on every sync.** It is an
*observation of a running total*, not an event.

Three syncs observing "240, 240, 300 minutes" mean the user has played 300
minutes — not 780. But the same game on Steam *and* PlayStation represents two
genuine playthroughs whose hours should add.

The rule, implemented in `packages/statistics`:

```
per (game, provider): take the MAX of LIFETIME_TOTAL observations
                      or the SUM of SESSION events
then: sum across providers
```

`RECENT_PLAY` (Steam's two-week window) is deliberately excluded — those minutes
are already inside the lifetime total, and counting both double-counts the last
fortnight. `ACHIEVEMENT_HISTORY` carries no duration at all.

Ingestion enforces this with a `dedupeKey` per logical fact:

```
steam:LIFETIME_TOTAL:730                       one row, forever
xbox:SESSION:abc:2026-08-01T10:00:00.000Z      one row per session start
```

Unique on `(userId, dedupeKey)`, so a re-sync upserts rather than appends.

### Time that cannot be dated

A lifetime total has no date. Pinning it to the day we happened to sync would
fabricate the yearly chart. So `playtimeByYear` reports it as
`unattributedMinutes` and the UI says so explicitly.

Same reasoning for `firstPlayedAt`: only `SESSION` and `USER_DECLARED`
activities have a real start instant. `RECENT_PLAY`'s start is a synthetic
window boundary — using it would report a first play *after* the last play.

---

## Provider abstraction

Every data source implements `GamingProvider` (`packages/types/src/provider.ts`).
Three deviations from the spec's sketch, each deliberate:

**Auth is `beginAuth` / `completeAuth`.** A single `authenticate()` cannot
express a browser redirect round-trip, which all three launch providers need.

**Methods take an explicit `ProviderSession`.** Adapters stay singletons and one
worker can run many users concurrently through one instance.

**Collections return `AsyncIterable`.** A 5,000-game library streams and upserts
page by page rather than buffering.

### Capabilities

Adapters declare what they can actually deliver, and the settings screen renders
that matrix instead of branching on provider name:

```ts
readonly capabilities: ProviderCapabilities = {
  library: 'partial',    // Xbox: achievement-derived, not an ownership list
  playtime: 'none',      // Xbox exposes no playtime at all
  achievements: 'full',
  playHistory: 'partial',
  profile: 'full',
  incrementalSync: false,
  importOnly: false,
};
```

`'partial'` is the honest answer where a provider supports a category but does
not promise completeness.

### File-backed providers

PlayStation has no public consumer API, so it is not an API client — but it is
still a `GamingProvider`. `ImportProvider` implements the same interface,
reading from an `ImportBatch` row instead of an HTTP response.

```
upload -> parse -> ImportBatch (PENDING) -> SyncRunner -> resolve -> upsert
                                                 |
                                          mark PROCESSED
```

That indirection is the point. The alternative — a separate import pipeline
writing straight to `Ownership` — would need its own entity resolution, its own
provenance handling and its own dedupe, and those three would drift from the
real ones. Routing imports through the same runner means a PlayStation copy of
a game already owned on Steam resolves onto the same canonical row for free.

`beginAuth` throws a message written for a user rather than a stack trace, and
the UI branches on `capabilities.importOnly` rather than on the provider's
name, so a future Nintendo import needs no frontend change.

Imported records are `DECLARED` confidence and their playtime is
`USER_DECLARED` — a figure someone typed must never be presented with the same
authority as one a platform reported.

### Resilience

All outbound HTTP goes through `ProviderHttpClient`, so no adapter can
accidentally skip the rate limiter or swallow a 429:

- **Token bucket** per provider (IGDB pinned to its documented 4 req/s).
- **Exponential backoff with full jitter** — without jitter, 200 fanned-out
  requests retry in lockstep and reproduce the failure that caused them.
- **Circuit breaker** — opens after repeated 5xx, half-opens with exactly one
  probe. A 404 or a 403 on one private profile does *not* count against health.
- **`Retry-After` outranks our own curve.**

---

## Entity resolution

Five levels, cheapest and surest first, stopping at the first confident answer.
The resolver is pure — it takes a `ResolverPort`, not a database handle — so the
whole matching policy is unit-testable without Postgres.

### Editions versus versions

The distinction the whole normaliser turns on:

- **Edition markers** describe packaging of the same game — `Deluxe`, `GOTY`,
  `Complete`. Stripped, and recorded.
- **Version markers** describe a *different product* sharing a name — `Remake`,
  `Remastered`, `VR`, `Director's Cut`. Preserved, and they **block a merge
  outright** regardless of similarity score.

`Resident Evil 4` and `Resident Evil 4 Remake` are one token and a ~0.95
similarity apart. They are two products with separate stores, achievements and
playtime.

Ambiguous markers (`Anniversary`, `Definitive`) are classed as **versions**,
because a false split is one admin click to fix and a false merge silently pools
two games' history in a way that cannot be undone without re-syncing everything.

Two further guards:
- A near-tie (top two within 0.05) defers to a human rather than coin-flipping.
- A reused title (`Prey` 2006 vs 2017) is disambiguated by release year, or
  deferred.

### Metadata enrichment

A provisional row — created when a sync could not resolve a title — has the
user's ownership and playtime but no cover, genres or release date. Enrichment
backfills it from IGDB later.

Two rules keep it safe:

1. **The resolver's version-marker guard applies here too.** IGDB's own search
   ranking is not trusted; a candidate whose version markers disagree is
   discarded before scoring, which is why "Resident Evil 4 Remake" scores
   0.000 against a catalogue containing only "Resident Evil 4".
2. **The acceptance threshold is higher than the resolver's** (0.90 vs 0.92 on
   a different scale, plus a wider tie margin). Attaching a store id is
   reversible; rewriting a game's name, cover and genres is what users see.

Metadata is applied **in place** rather than by creating a fresh row and
merging into it. The provisional row owns the slug that existing links point
at; creating-then-merging would leave the good slug on the dead row and hand
the survivor an auto-suffixed one. `upsertCanonicalGameFromIgdb` (keyed on
`igdbId`) and `applyIgdbMetadataToGame` (keyed on our own id) share the same
mapper for exactly this reason.

Merging is still the right answer in one case: when the matched IGDB title
*already* exists as a canonical row, usually because another user synced it
from a provider that did resolve. Two rows for one game is the duplicate the
spec warns about.

### Merging canonical games

The most dangerous write in the system. Every row pointing at the loser has to
move, and several destination tables have unique constraints the move can
violate:

| Table | Collision | Resolution |
|---|---|---|
| `ExternalGameIdentity`, `Ownership`, `PlayActivity` | impossible — keys include the provider's own id | straight update |
| `UserGameStatus` | user has a status on both | winner's is kept; it is their own verdict |
| `Achievement` | same `(provider, externalId)` on both | loser's dropped, cascading its unlocks |
| `CollectionGame`, `GameAlias`, `GamePlatform` | both present | loser's dropped |
| `GameRelation` | would become self-referential | dropped |

All in one transaction — a half-merged game with ownership moved but playtime
not would be worse than either outcome.

The loser is **never deleted**. It keeps a `mergedIntoId` pointer so mappings
made before the merge still resolve, lookups by its old slug follow through to
the survivor, and a mistaken merge can be inspected by hand.

### When nothing matches

The game is still created — as a provisional canonical row with no `igdbId` —
and queued in `UnresolvedExternalGame` for review. Dropping it would mean a
user's library silently omits titles, which is the exact failure the product
exists to prevent.

---

## Sync pipeline

```
POST /sync/all
      |
   Redis (BullMQ)
      |
  +---+---+---+
Steam   Xbox   PSN        one job per provider, independent failure
  |       |      |
  +---+---+---+
      |
 load credentials -> refresh if near expiry
      |
 fetch (streamed) -> normalise -> resolve -> upsert -> provenance
      |
 mark missing as removedAt   (full reads only)
      |
 playtime -> achievements -> finalise
```

**Partial success is a real outcome.** A library importing 1,240 of 1,248 games
is far more useful than one that rolls back because eight titles failed to
resolve. Per-game failures increment a counter and the job finishes `PARTIAL`.

**The API never talks to a provider.** It writes a `SyncJob` row and enqueues.
A full Steam sync takes minutes; no user waits on it inside an HTTP request.

**Auth failures are distinguished from outages.** A `ProviderError` carrying
`needsReauth` flags the connection `REAUTH_REQUIRED` and tells the user what to
do; a retryable one backs off and tries again.

---

## Security

- Provider tokens are encrypted at rest with **AES-256-GCM** in a versioned
  envelope (`v1.<iv>.<tag>.<ciphertext>`), so a key rotation can decrypt old
  rows and re-wrap them. Encryption is one file wide
  (`packages/database/src/credentials.ts`); nothing else touches the
  `*Encrypted` columns.
- Session cookies are stored **hashed**. A database leak yields no live
  sessions.
- Passwords use **scrypt** (`N=2^16`), chosen over argon2 for having no native
  dependency across Windows/Linux/CI. Cost parameters live in the hash string so
  they can be raised without invalidating existing hashes.
- OAuth state rows are **single-use and consumed before** the provider exchange,
  so a replayed callback fails even if the first attempt errored partway.
- Steam's OpenID `check_authentication` round-trip is **mandatory** — without
  it, anyone can forge a callback URL naming any SteamID and take over that
  identity. This is the single most security-critical function in the codebase,
  and it is covered by tests including a forged-callback case.
- `returnTo` redirects are validated against our own origin.

### The public profile

`/u/:username` is the only unauthenticated read path, so it is written
defensively:

- Invisible unless the user opted in. A private profile returns **404, not
  403**, so the endpoint cannot be used to enumerate which usernames exist.
- Only `PUBLIC` collections appear. `UNLISTED` ones are reachable by direct
  link but never listed; `PRIVATE` ones never leave the account.
- The response is assembled by explicit `select`, never by spreading a row, so
  a column added to `User` later cannot silently become public.
- Platforms are listed, but not the accounts behind them: making an OMNIPLAY
  profile public is not consent to publish a gamertag.
