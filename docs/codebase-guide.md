# OMNIPLAY — the codebase, explained

A guide to every file in the repository, written for someone who understands
basic programming but has not worked with this stack before. Read Part 1 first;
it gives you the vocabulary the rest relies on. Parts 2–5 then walk every
directory, file by file, saying what each one does, what its important
functions are, and why it is written the way it is.

---

## Part 1 — The shape of the thing

### What OMNIPLAY does

Every gaming platform keeps its own record of you. Steam knows what you own on
Steam and how many hours you have played. PlayStation knows your trophies.
Xbox knows your gamerscore. None of them talk to each other, and none will
tell you that you have played Apex Legends for 633 hours in total, because 400
were on PlayStation and 233 on Steam.

OMNIPLAY pulls all three records into one place, works out where they overlap,
and turns them into one history that belongs to you: a library, a timeline,
statistics, achievements and a shareable profile.

### Three programs, not one

The repository holds three applications that run at the same time, plus a set
of shared libraries. This arrangement is called a **monorepo**.

```
D:\OmniPlay
├── apps/
│   ├── web/      the website you see             (Next.js + React)
│   ├── api/      the server the website talks to (NestJS)
│   └── worker/   the background process that fetches from Steam/Xbox/PSN
└── packages/     code shared by all three
    ├── types/          shared TypeScript definitions (the vocabulary)
    ├── database/       the database schema and client (Prisma)
    ├── providers/      the adapters that speak Steam, Xbox, PSN, IGDB
    ├── game-matching/  "is Steam's 'Devil May Cry 5' the same as PSN's?"
    ├── statistics/     the arithmetic (hours, completion, status)
    └── config/         shared compiler settings
```

An analogy that holds up well:

- **web** is the waiter. It shows you the menu (pages) and takes your orders
  (clicks). It never cooks.
- **api** is the kitchen. The waiter asks it for things; it decides what you
  are allowed to have and prepares it from what is in the pantry.
- **worker** is the delivery driver. It goes out to the suppliers (Steam, Xbox,
  PlayStation, IGDB) and restocks the pantry. It works in the background so
  nobody waits at the table.
- The **pantry** is a PostgreSQL database. The kitchen only ever cooks from the
  pantry; it never phones a supplier while you wait.
- **Redis** is the kitchen's to-do board: the kitchen writes "sync Aryan's
  Xbox" on it and the driver reads it. The library that manages that board is
  called BullMQ.

Postgres and Redis run in Docker containers locally (`pnpm infra:up`).

### The languages and tools

- **TypeScript** everywhere — JavaScript with types. `pnpm typecheck` runs the
  compiler over every file and catches "you passed a string where a number was
  expected" before the code ever runs.
- **pnpm** installs packages and runs commands across the monorepo.
- **Turborepo** runs those commands in dependency order (build `packages/*`
  before typechecking the apps that use them) and caches results.
- **Vitest** runs the tests — 414 of them across seven packages.
- **Prisma** is the bridge between TypeScript and Postgres.
- **Zod** validates data shapes at runtime (request bodies, environment
  variables, API responses from providers).
- **Docker** runs Postgres and Redis.

### Three ideas the whole codebase follows

1. **Ownership is never deleted.** When a game leaves your library the row
   stays, with a `removedAt` date. Your history is the product; forgetting is
   a bug.
2. **Provenance.** Every fact records where it came from and how sure we are:
   `VERIFIED` (the platform said so), `DERIVED` (worked out from other data),
   `DETECTED` (activity seen, details unknown), `DECLARED` (you told us). The
   interface shows this rather than presenting a guess as a fact.
3. **Playtime is not additive.** Steam gives one lifetime total with no dates,
   PlayStation gives dated sessions, Xbox sometimes gives nothing. The maths
   only adds what can honestly be added, and the interface refuses to show a
   number it cannot stand behind (that is why the year table has no hours
   column).

### Following one click end to end

You click *Batman: Arkham Knight* in the Library.

1. The browser navigates to `/game/batman-arkham-knight`; the page wipe plays.
2. Next.js runs `apps/web/src/app/(app)/game/[slug]/page.tsx` **on the server**.
   It calls `apiFetch('/library/games/batman-arkham-knight')`, forwarding your
   session cookie.
3. In the API, `SessionGuard` turns the cookie into your user record.
   `LibraryController` validates the slug and calls `LibraryService.detail()`,
   which asks Prisma for the game, your ownership on each platform, playtime
   rows, achievements, notes and status, and assembles the *platform report*.
4. The API returns JSON. Next.js renders the finished HTML — art, figures,
   panels — and sends it. Nothing in that path touched Steam or PlayStation;
   the pantry was already stocked by the worker.
5. In the browser, the client-side pieces wake up: the count-up numbers, the
   "← Library" tab, the gold cursor.

---

## Part 2 — The root of the repository

| File | What it is |
|---|---|
| `package.json` | The root recipe card: scripts (`pnpm dev`, `typecheck`, `test`, `db:push`, `db:seed`, `infra:up`, `doctor`, `reset`) and the few tools every package shares (TypeScript, Turborepo). |
| `pnpm-workspace.yaml` | Declares that the projects live in `apps/*` and `packages/*`. This is what makes it a monorepo. |
| `pnpm-lock.yaml` | The exact version of every installed package so every machine gets identical installs. Generated; never edited by hand. |
| `turbo.json` | Which command depends on which (`build` before `typecheck`, etc.), and what to cache. |
| `.npmrc` | pnpm settings. |
| `.gitignore` | What Git must never track: `node_modules`, build output (`dist`, `.next`), and — critically — `.env`. |
| `.env.example` | A template of every environment variable with comments: database URL, Redis URL, the encryption key, Steam/Xbox/PSN/IGDB credentials, Google OAuth, Resend. Copy to `.env` and fill in. |
| `.github/workflows/ci.yml` | GitHub Actions. On every push: start Postgres, install with the frozen lockfile, generate the Prisma client, push the schema and seed, build, typecheck, test. |
| `README.md` | The manual: quick start, seeing your real library, day-to-day commands, troubleshooting, accounts and password reset, provider credentials, an architecture summary, PlayStation caveats, data quality, status. |
| `docs/architecture.md` | The design document proper: the data model's central distinction, provenance, the non-additive playtime problem, the provider abstraction and capabilities, entity resolution, the sync pipeline, security. |
| `docs/feasibility.md` | The original honest assessment of what each platform can and cannot provide. |
| `docs/codebase-guide.md` | This file. |
| `infrastructure/docker/docker-compose.yml` | The two containers the project needs locally: `postgres:17-alpine` and `redis:7-alpine`, with their ports and volumes. |

---

## Part 3 — `packages/` (shared code)

Each package is a small library with its own `package.json` (name, scripts,
dependencies) and `tsconfig.json` (extends the shared compiler settings). Those
two files are the same in every package and are not described again below.

### 3.1 `packages/config`

| File | What it is |
|---|---|
| `tsconfig.base.json` | The strict TypeScript settings everything extends: `strict`, `noUncheckedIndexedAccess` (indexing an array gives `T \| undefined`, so you must handle the miss), `exactOptionalPropertyTypes`, ES2022 modules. |
| `tsconfig.lib.json` | The variant for packages that emit `dist/` with declaration files. |

### 3.2 `packages/types` — the vocabulary

Nothing in here may mention a specific platform's wire format. Providers
translate *into* these types; the rest of the system never translates back.

**`src/domain.ts`** — the core nouns.

- `ProviderId` — `'steam' | 'xbox' | 'psn' | 'psn-import' | 'physical'` and so on.
- `Confidence` — `VERIFIED | DERIVED | DETECTED | DECLARED | UNCERTAIN`.
- `OwnershipType` — `DIGITAL | PHYSICAL | SUBSCRIPTION | FAMILY_SHARE | GIFT | MANUAL`.
- `ExternalGame` — what a provider says about one game: its external id, name,
  ownership type, playtime, achievement counts, first/last played, plus a
  `dedupeKey` so two editions of one game are not collapsed.
- `ActivityType` — `LIFETIME_TOTAL | SESSION | RECENT_PLAY | ACHIEVEMENT_HISTORY | USER_DECLARED`.
  This distinction is what makes the playtime arithmetic possible.
- `AchievementRecord`, `Capability`, `ProviderCapabilities` — the last two
  declare what a platform can report (`full | partial | none`) for library,
  playtime, achievements and play history.

**`src/provider.ts`** — the contract every adapter implements.

`GamingProvider` has an `id`, `capabilities`, and methods: `beginAuth`,
`completeAuth`, `refreshSession`, `fetchLibrary`, `fetchPlaytime`,
`fetchAchievements`, `describe`. `ProviderSession` is "who this user is on that
platform" (the tokens plus the platform's id for the user). Because every
adapter fits this one shape, the sync runner is written once.

**`src/jobs.ts`** — the queue contract. `SYNC_QUEUE` (the queue's name),
`SyncJobPayload` (`{ syncJobId, userId, providerId, connectedAccountId, full }`)
and the metadata-enrichment job's payload. Kept here so the API (which
enqueues) and the worker (which consumes) cannot silently disagree about a
field.

**`src/index.ts`** — re-exports.

### 3.3 `packages/database` — the pantry

**`prisma/schema.prisma`** — the single most important file in the project.
Prisma reads it and generates a typed client, so `prisma.game.findMany({...})`
knows every column. The tables, in groups:

*Games (the catalogue, shared by all users)*
- `Game` — one canonical row per game: name, slug, `normalizedName`, cover and
  hero image, genres, platforms, release date, developers/publishers, critic
  rating and review count, `igdbId`, `mergedIntoId` (set when a duplicate was
  merged), `resolutionState` and metadata-attempt bookkeeping.
- `GameAlias` — other names a game is known by (normalised) for matching.
- `GameRelation` — edition/port/remaster links between games.
- `Platform`, `GamePlatform` — the reference list of hardware platforms and
  which games are on which.
- `ExternalGameIdentity` — "on provider X, external id Y is canonical game Z".
  The unique index on `(provider, externalId)` is level 1 of matching.

*People*
- `User` — email, username, display name, avatar, bio, `passwordHash`
  (nullable: a Google-only account has none), `profilePublic`, `isAdmin`.
- `Session` — `tokenHash` (never the token), expiry, ip, user agent.
- `UserIdentity` — "this user proves who they are with Google `sub` = …".
- `PasswordResetToken` — hashed reset tokens with expiry and `usedAt`.
- `OAuthState` — short-lived rows protecting OAuth round trips.

*Connections to platforms*
- `ConnectedAccount` — a user's link to one platform (status, external user
  id, last sync).
- `ProviderCredential` — the encrypted tokens for that link.

*What the user has and did*
- `Ownership` — user × game × provider, with `ownershipType`, `confidence`,
  `acquiredAt`, and `removedAt` (never deleted).
- `PlayActivity` — every observation of play: `activityType`, minutes,
  start/end, provider, confidence, `dedupeKey`.
- `Achievement` — the catalogue of achievements per game and provider (with
  `globalUnlockRate` and `points` where the platform publishes them);
  `UserAchievement` — which the user has unlocked and when;
  `GameAchievementSummary` — per-game counts when the platform gives only a
  total.
- `UserGameStatus` — a status the user set by hand (Playing, Completed…) and a
  1–10 rating; `UserGameNote` — dated notes.
- `Collection`, `CollectionGame` — user-curated lists with visibility.

*Operations*
- `SyncJob` — one sync run: status, phase, counters, error, timestamps;
  `SyncCursor` — per-provider "where we got to" for incremental syncs.
- `UnresolvedExternalGame` — the review queue: records a sync could not place
  confidently, with candidate matches.
- `ImportBatch` — an uploaded file waiting to be consumed.
- `AuditLog` — who did what, when, from where.

**`src/client.ts`** — creates one `PrismaClient` per process and caches it on
`globalThis`. In development both Next.js and Nest hot-reload modules; a fresh
client per reload would exhaust Postgres's connection limit within a few saves.

**`src/crypto.ts`** — envelope encryption for provider tokens using AES-256-GCM
with a key from `CREDENTIAL_ENCRYPTION_KEY`. Output format is
`v1.<iv>.<tag>.<ciphertext>` so the format can change later. Also
`generateToken(bytes)` (random, URL-safe), `hashToken` (SHA-256, used for
sessions and reset links so a database leak never yields a live credential)
and `safeEquals` (constant-time comparison).

**`src/credentials.ts`** — the only sanctioned translation between a
`ProviderCredential` row and the plaintext tokens an adapter uses, in both
directions. Nothing else in the codebase touches `accessTokenEncrypted`.

**`src/import-records.ts`** — the storage side of file-based providers: writes
an `ImportBatch` with its parsed records, and hands pending batches to the
worker. In this package because both the API (writer) and worker (reader) need
identical behaviour and neither may import from the other.

**`src/merge.ts`** — `mergeGames(loserId, winnerId)`: the most dangerous write
in the system. Every row pointing at the losing game (ownerships, activities,
achievements, statuses, notes, collection entries, identities, aliases) is
moved to the winner inside one transaction, and each unique constraint that
the move could violate (a user with both games in one collection, a status on
each) is handled explicitly. The loser is kept with `mergedIntoId` set so old
links still resolve.

**`src/resolution-sweep.ts`** — closes review-queue entries that metadata
enrichment has since answered (the provisional game got a real IGDB identity),
so the admin queue does not fill with questions that already have answers.

**`src/resolver-port.ts`** — the database-backed half of game matching. The
pure resolver (in `game-matching`) asks an interface for candidates; this file
implements it with the real indexes: `ExternalGameIdentity` for level 1, a
b-tree on `normalizedName` for level 3, a `pg_trgm` GIN index for fuzzy level 4.

**`src/seed.ts`** — bootstrap that is safe to run repeatedly: enables the
`pg_trgm` extension, creates the trigram indexes Prisma cannot express, seeds
the `Platform` table.

**`src/index.ts`** — re-exports. **`src/crypto.test.ts`** — round trips,
tamper detection, token unpredictability.

### 3.4 `packages/game-matching` — is this the same game?

**`src/normalize.ts`** — `normalizeTitle()`. Lower-cases, strips punctuation,
trademark symbols and platform suffixes, expands roman numerals consistently,
and — the important part — separates two kinds of marker:

- *Edition* markers ("Deluxe Edition", "Game of the Year", "Definitive
  Edition") describe packaging of the same game and are **removed**.
- *Version* markers ("Remastered", "II", "2077", "HD") describe a different
  game that shares a name and are **kept**.

It returns the normalised string plus the version markers found, so the
resolver can refuse to match "Devil May Cry" to "Devil May Cry 5".

**`src/similarity.ts`** — dependency-free string similarity (token overlap plus
a trigram measure) used to rank fuzzy candidates. Predictable cost matters
because it runs inside a sync against every unmatched title.

**`src/resolver.ts`** — `resolveGame(input, port, thresholds)`. Cheapest and
surest first, stopping at the first confident answer:

1. Exact external id already mapped → `VERIFIED`.
2. The provider id known to the metadata layer (IGDB's store mappings) → `VERIFIED`.
3. Exact normalised-name match (game or alias) → `DERIVED`.
4. Fuzzy candidates, ranked; accepted only above a threshold, only when version
   markers agree, and disambiguated by release year when two remain →
   `DERIVED` or `UNCERTAIN`.
5. Otherwise "unresolved", with the candidates attached for a human to decide.

Every result carries the method, confidence and score. The thresholds are a
value you can pass in, so tests can tighten or loosen them.

**`src/index.ts`** — re-exports, including `slugify` (used for usernames and
game slugs). **`normalize.test.ts`, `resolver.test.ts`** — tests with the
awkward titles that motivated the rules.

### 3.5 `packages/statistics` — the arithmetic

**`src/playtime.ts`**

- `isCountable(record)` — only `LIFETIME_TOTAL`, `SESSION` and `USER_DECLARED`
  rows with positive minutes count. `RECENT_PLAY` is a window already inside
  the lifetime total (counting it double-counts two weeks) and
  `ACHIEVEMENT_HISTORY` carries no duration.
- `aggregatePlaytime(records)` — the rule that shapes the file: **lifetime
  totals are not additive**. Steam reports "247 hours" and overwrites it every
  sync; if each observation were summed, your total would climb every time you
  pressed Sync. So per (game, provider, dedupeKey) the code takes the
  *maximum* lifetime figure seen and the *sum* of discrete sessions, prefers
  the lifetime figure where both exist, then adds across providers and games.
  Returns `{ totalMinutes, byProvider, byGame }`.
- `playtimeByYear(records)` — attributes only `SESSION` rows to years, because
  a lifetime total cannot honestly be split across time. Reports the
  unattributed remainder so the interface can say so.
- `computeLibraryStats({ ownerships, statuses, playtimeByGame, fullyUnlockedGames })`
  — totals, currently/previously owned, games played, completed (hand-set
  status or every achievement unlocked), backlog, completion rate, games by
  provider.
- `formatPlaytime` — minutes to "247h" / "35m".

**`src/status.ts`** — `resolveGameStatus()`: a hand-set status wins; otherwise
every achievement unlocked ⇒ `COMPLETED`, recent play ⇒ `PLAYING`, some play
⇒ `PAUSED`, none ⇒ `NOT_STARTED`. Returns `{ status, derived }` so the
interface can show whether it was inferred (dashed border) or declared.

**`src/index.ts`** — re-exports. **Tests** for both.

### 3.6 `packages/providers` — the adapters

**`src/http/client.ts`** — `ProviderHttpClient`, the single outbound HTTP path
for every adapter: applies the provider's rate limiter, circuit breaker and
retry policy, parses JSON, and turns a non-2xx into a typed error. An adapter
cannot accidentally skip the rate limiter because it never calls `fetch`
directly.

**`src/http/resilience.ts`**

- `RateLimiter` — a token bucket (`acquire()` waits for a token; `refill()` on
  an interval). One per provider.
- `CircuitBreaker` — `closed → open` after N failures, `half-open` after a
  cool-down to probe once, back to `closed` on success. `assertClosed()` throws
  fast while open, so a dead Xbox costs nothing.
- `withRetry(fn, options)` — retries retryable failures (429, 5xx, network)
  with exponential `backoffDelay` and jitter, honouring `Retry-After`.

**`src/registry.ts`** — `ProviderRegistry`: `register`, `find`, `get`, `has`,
`list`, `describe` (capabilities for the settings screen) and `catalogue`
(every known platform, configured or not, with setup hints).
`createProviderRegistry(env, deps)` registers only the adapters whose
credentials are present, so a developer with just a Steam key gets a working
Steam-only instance. The API and worker ask the registry for "xbox" and never
import an adapter directly — adding a platform is a new adapter plus one line.

**`src/catalogue.ts`** — the full list of platforms with names, what
credentials each needs, and where to get them. Exists because an earlier
version omitted unconfigured platforms entirely, leaving a new user with an
empty library and no clue that a key was missing.

**Steam** (`src/steam/`)
- `steam.auth.ts` — sign-in via OpenID 2.0. Steam never issues a token; the
  entire result is a verified SteamID64. All data access then uses OMNIPLAY's
  own Web API key, so there is nothing user-specific to refresh or encrypt.
- `steam.mapper.ts` — Zod schemas for `GetOwnedGames`, `GetPlayerSummaries`,
  `GetPlayerAchievements`, `GetSchemaForGame`, and the translation into
  `ExternalGame` / `AchievementRecord`. Strict about the fields used,
  permissive about the rest, because Steam changes shapes without notice and a
  validation error is easier to diagnose than a `NaN` three tables later.
- `steam.provider.ts` — the adapter: `fetchLibrary` (owned games with lifetime
  minutes), `fetchPlaytime` (the same totals as `LIFETIME_TOTAL` rows, plus
  `RECENT_PLAY` for the last two weeks), `fetchAchievements` (per game, with
  unlock timestamps). Capabilities: library `full`, playtime `full`,
  achievements `full`, play history `none`.
- `steam.provider.test.ts` — contract tests against `fixtures/steam/*.json`,
  including a private profile.

**Xbox** (`src/xbox/`)
- `xbox.tokens.ts` — the four-stage chain to reach Xbox Live from a website:
  Microsoft OAuth (scope `XboxLive.signin`) → `user.authenticate` (the `d=`
  prefix matters) → `xsts.authorize` (relying party `xboxlive.com`) → an XSTS
  token plus user hash that form the `Authorization: XBL3.0 x=…;…` header.
- `xbox.provider.ts` — the first-party adapter. Its honesty rule: Xbox's
  title-history endpoint is *achievement-derived* — it lists titles you have
  earned achievements in plus recent activity — so it is neither a full launch
  history nor an ownership list. Everything from it is recorded as
  `DETECTED` activity, and the capabilities say library `partial`.
- `openxbl.provider.ts` — Xbox through OpenXBL (xbl.io), a proxy over the real
  services, used because a personal Microsoft account cannot register an Azure
  app. Same shapes in a `{ content, code }` envelope; same honesty rules.
- `openxbl.test.ts` — against `fixtures/xbox/*.json`.

**PlayStation** (`src/psn/`)
- `psn.client.ts` — authentication through the endpoints the PlayStation
  mobile app uses, with that app's client credentials. Three credentials with
  three lifetimes: the `npsso` cookie the user pastes in (~60 days), a refresh
  token, and a short-lived access token. Confusing them produces errors that
  look like outages, so each is named and handled separately.
- `psn.provider.ts` — the richest source and the only unofficial one: real
  per-title durations *with* first/last played, play counts, individually
  dated trophies with global earn rates and tier weights.
- `psn.test.ts` — against `fixtures/psn/*.json`.

**IGDB** (`src/igdb/`)
- `igdb.client.ts` — the catalogue, never a source of ownership. Twitch
  client-credentials auth with the token cached until expiry; `searchGames`,
  `gameById`, `gamesByExternalId` (store mappings — Steam appids are
  authoritative), cover/artwork URL building, genres, release dates, critic
  `aggregated_rating` with its count, and `IGDB_EXTERNAL_CATEGORY` constants
  verified against IGDB's own endpoint.
- `critic-rating.test.ts`, `igdb.test.ts` — against `fixtures/igdb/*.json`.

**File import** (`src/import/`)
- `csv.ts` — a small, correct CSV reader (quoted fields, escaped quotes,
  CRLF). Written rather than pulled in because a naive `split(',')` would turn
  "Batman: Arkham Asylum, Game of the Year" into two rows and nothing
  downstream would notice.
- `import.mapper.ts` — turns a user-supplied spreadsheet into `ExternalGame`
  records. Generous about input (column-name aliases, several date formats,
  "12h 30m" hours), strict about output: anything ambiguous is skipped with a
  stated reason rather than guessed.
- `import.provider.ts` — a provider whose data arrives by file, implementing
  the *same* `GamingProvider` contract. This is the real test of the
  abstraction: PlayStation-by-spreadsheet and physical collections go through
  the same runner, resolution, provenance and screens as Steam does.
- `import.test.ts`.

**`src/index.ts`** — re-exports. **`fixtures/`** — saved real responses from
each service so the tests run with no network and no credentials.

---

## Part 4 — `apps/api` (the kitchen, NestJS)

NestJS organises a server into **modules**. Each feature has a *controller*
(URLs → handler methods, kept thin) and a *service* (the logic). Dependencies
are injected through constructors, which is what makes the services testable.

**`src/main.ts`** — bootstrap. Validates configuration before Nest starts (a
missing `CREDENTIAL_ENCRYPTION_KEY` fails here with a readable message rather
than inside a sync job at 2am), enables cookie parsing and CORS for the web
origin with credentials, starts listening on `PORT`.

**`src/app.module.ts`** — the list of feature modules the server is made of:
Common, Auth, Providers, Sync, Library, Stats, Health, Collections, Profile,
Admin, Achievements.

### 4.1 `src/common/`

- `config.ts` — a Zod schema for every environment variable, parsed once and
  cached. Required: database and Redis URLs, the encryption key, `API_URL`,
  `WEB_URL`. Optional: every provider credential, Google, Resend, `MAIL_FROM`.
  Exposes `isProduction`. Missing required variables fail at boot by name.
- `prisma.service.ts` — wraps the shared Prisma singleton as something Nest can
  inject.
- `common.module.ts` — marks config and Prisma global so every module gets them
  without importing.
- `tokens.ts` — dependency-injection tokens (`CONFIG`, `PROVIDER_REGISTRY`,
  `SYNC_QUEUE_TOKEN`). In a file with no imports of its own, because defining
  a token next to the module that consumes it creates an import cycle that
  fails at runtime with "cannot access before initialization".
- `validation.ts` — `zodBody(schema, body)`: validates and, on failure, throws
  a 400 whose body has `{ message, errors: { field: message } }` so forms can
  render errors inline.
- `completion.ts` — `fullyUnlockedGameIds(prisma, userId)`: games where every
  achievement is unlocked. Shared by the library and dashboard so "completed"
  means one thing.

### 4.2 `src/auth/`

- `auth.controller.ts` — routes:
  `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`,
  `POST /auth/password/forgot`, `POST /auth/password/reset`,
  `GET /auth/methods` (which sign-in methods this instance offers),
  `GET /auth/google` (redirects to Google), `GET /auth/google/callback`,
  `GET /auth/me`. Sets and clears the `omniplay_session` cookie. `publicUser()`
  is the allow-list of user fields that may reach the browser.
- `auth.service.ts` — the logic. `register` (lower-cases the email, slugifies
  the username, hashes the password), `login` (verifies against a dummy hash
  when the user does not exist so timing does not reveal registered emails;
  tells a Google-only account how it signs in), `createSession` (random
  32-byte token, only its hash stored, 30-day expiry), `resolveSession`,
  `logout`, `requestPasswordReset` (per-caller meter of ten per fifteen
  minutes, per-address cooldown of one minute that only starts when a message
  actually left, returns an outcome the controller turns into 200/404/429/503),
  `resetPassword` (single use, expiry, destroys every other session), `audit`
  (never blocks the action it records).
- `auth.guard.ts` — `SessionGuard`: reads the cookie, resolves the session,
  attaches the user to the request or throws 401. `@CurrentUser()` injects it
  into handlers.
- `google.service.ts` — Google OAuth. `beginSignIn` writes an `OAuthState` row
  and builds the Google URL; `completeSignIn` verifies the state (single use,
  ten-minute expiry, constant-time compare), exchanges the code, fetches the
  profile. `decideGoogleAccount()` is a pure function — the security boundary
  of the flow — deciding sign-in / link / create / refuse: matching is on
  Google's `sub`, never the email alone; an unverified email is used for
  nothing. `availableUsername` avoids collisions on display names.
- `password.ts` — scrypt hashing (`hashPassword`, `verifyPassword`) with a
  self-describing hash format so parameters can change later.
- `mailer.ts` — sends the reset email through Resend with one `fetch` and Zod
  on the response. Without a key it logs the message instead. Never throws;
  returns `'sent' | 'logged' | 'failed'` so the endpoint can say plainly when
  nothing was sent, and names the two failures worth naming (bad key,
  unverified sending domain).
- `auth.module.ts` — global, because `SessionGuard` is used by every module.
- Tests: `password.test.ts`, `google-account.test.ts` (every branch of the
  decision), `password-reset.test.ts` (what is stored, what a link is worth,
  what a stranger can learn), `mailer.test.ts` (the transport's contract).

### 4.3 `src/library/`

- `library.controller.ts` — `GET /library` with Zod-validated query
  (`search`, `platform`, `status`, `ownership: purchased|subscription|all`,
  `sort`, `page`), `GET /library/facets`, `GET /library/games/:slug`, and the
  note endpoints.
- `library.service.ts` (900 lines; the heart of the shelf and the game page):
  - `list()` — builds the `where` from the query (`buildWhere`), orders it
    (`libraryOrderBy`, or `sortByLastPlayed` for the sort Prisma cannot express
    — a MAX over a relation — resolved in two indexed queries), pages it, and
    decorates each game with hours, status, critic score and platforms.
  - `detail()` — everything the game page shows: game, ownership per platform,
    playtime rows, achievements summary, notes, status, and the **platform
    report**: for each platform, ownership (with provenance), playtime
    (`REPORTED | ZERO | NOT_REPORTED | PENDING`), dated play and achievements.
    "Zero is a claim": Steam reports hours for everything so a missing row
    really is unplayed; Xbox answers a separate stats call that many titles
    ignore, so a missing row is "not reported", not "0h".
  - `playtimeProvenanceFor()` — the pure rule behind that, tested in
    `playtime-provenance.test.ts`.
  - `facets()` — counts per platform, status and ownership for the filter deck.
  - `addNote`, `editNote`, `deleteNote`.
- `library-sort.test.ts` — the last-played ordering.

### 4.4 `src/stats/`

- `stats.controller.ts` — `GET /stats/overview`, `/stats/ranking`,
  `/stats/timeline`, `/stats/year/:year`.
- `stats.service.ts`:
  - `overview()` — library stats, playtime by provider and by year, accounts,
    activity by year, cross-platform games, unlock summary, genres, currently
    playing, most played, last sync.
  - `playtimeRanking()` — every game by hours.
  - `activityByYear()` — active days, games, unlocks, started, finished per
    year (only what can honestly be dated).
  - `crossPlatformGames()` — games with ownership or play on more than one
    platform, with combined minutes (raw SQL).
  - `unlockSummary()`, `genreBreakdown()` (genres weighted by hours across the
    whole library, raw SQL with `unnest`), `year()` (a year in review),
    `timeline()` (every datable event — sessions, unlocks, acquisitions —
    grouped into `TimelineEntry` rows by day and year), `currentlyPlaying()`,
    `mostPlayed()`.

### 4.5 `src/achievements/`

- `achievements.controller.ts` — `GET /achievements` (the overview) and per-game.
- `achievements.service.ts` — `rarestUnlocks` (lowest global rate; PlayStation
  and Steam publish one, Xbox does not), `trophyTiers` (platinum/gold/silver/
  bronze from the point weights), `byProvider` (unlocked, tracked, games,
  perfect, points per platform — never added across platforms), 
  `unlocksByYearAndProvider`, `platformHighlights` (top four per platform by
  rarity where it exists, gamerscore where it does not), `overview`
  (assembles all of it), `recentUnlocks`, `perGame` (progress per game, using
  the platform's own count where individual achievements have not been
  fetched yet), `forGame`.

### 4.6 `src/profile/`

- `profile.controller.ts` — `GET /u/:username` (unguarded; resolves a session
  if one is sent so the owner can see their own page) and `PATCH /profile`.
- `profile.service.ts` — `publicProfile()`: invisible unless `profilePublic` or
  the viewer is the owner; a private profile is a 404, not "private", so the
  endpoint cannot enumerate usernames; built by explicit `select`, never by
  spreading a row; publishes which platforms, never which accounts. Returns
  stats, platforms, favourites, rarest unlocks, trophy tiers, genres, earliest
  dated play, public collections, `isPublic`, `isOwner`. `updateOwn()` for
  display name, bio, visibility.
- `profile.module.ts` — imports Achievements and Stats to reuse their services.

### 4.7 `src/collections/`

- `collections.controller.ts` — CRUD routes plus add/remove/reorder games.
- `collections.service.ts` — `list`, `create` (unique slug per user), `detail`,
  `remove`, `addGame`, `removeGame`, `reorder`, with `requireOwned` guarding
  every write. Collections are the one part of the library the user authors
  entirely — no sync ever writes here — which is what makes them safe to share.

### 4.8 `src/providers/`

- `providers.controller.ts` — the connect screen's data, OAuth start and
  callback for each platform, disconnect, CSV upload.
- `providers.service.ts` — `listForUser` (catalogue merged with the user's
  connections), `beginConnect` (writes an `OAuthState`, asks the adapter for
  its auth URL), `completeConnect` (verifies state, finishes auth, encrypts and
  stores credentials, creates the `ConnectedAccount`), `disconnect(deleteData)`
  (unlink, or unlink and erase everything imported from it), `safeReturnTo`
  (only same-origin return paths).
- `import.service.ts` — accepts an uploaded file, parses it with the import
  mapper, creates a `ConnectedAccount` for the file-backed provider and a
  pending `ImportBatch` the worker will consume through the ordinary pipeline.
- `providers.module.ts` — builds the registry from config and provides it.

### 4.9 `src/sync/`

- `sync.controller.ts` — `POST /sync` (one provider), `POST /sync/all`,
  `GET /sync/jobs`, `GET /sync/jobs/:id`, `GET /sync/health`.
- `sync.service.ts` — the API's only jobs are to write a `SyncJob` row and push
  a job onto the BullMQ queue; it never talks to a provider, because a full
  library sync takes minutes and the user must never wait on it inside an HTTP
  request. `recentJobs`, `getJob` (owner only), `providerHealth` (circuit
  states).

### 4.10 `src/admin/`

- `admin.guard.ts` — extends `SessionGuard` with an `isAdmin` check, so the
  admin check can never be applied without a resolved session.
- `admin.controller.ts` — the data-quality routes.
- `admin.service.ts` — `overview` (queue sizes), `unresolved` (the review
  queue, paged), `resolveToGame` / `createGameFrom` / `ignore` (the three
  outcomes for a queued record), `provisionalGames`, `duplicateGames` (by
  normalised title and by identical achievement sets), `merge` (calls
  `mergeGames`), `sweepQueue`, `enqueueEnrichment`, `failedSyncs`.

### 4.11 `src/health/`

- `health.controller.ts` — liveness plus per-provider status (rate limiter and
  circuit breaker state) for the settings screen.

### 4.12 `src/dev/` — terminal tools

- `mail-test.ts` — `pnpm --filter @omniplay/api mail:test you@example.com`:
  sends one email and interprets the failure (Resend's shared sender only
  delivers to the address that owns the Resend account).
- `password.ts` — `password check` / `password set` for a user, without
  storing or echoing anything.

---

## Part 5 — `apps/worker` (the delivery driver)

**`src/main.ts`** — starts a BullMQ `Worker` on the sync queue and, when IGDB
is configured, a second worker for metadata jobs; wires the provider registry,
the `SyncRunner` and the enrichment; reconciles interrupted jobs on start;
handles failures by kind (auth expired, provider down, unexpected) so the
`SyncJob` row says something a person can act on; shuts down gracefully on
`SIGTERM`/`SIGINT`, finishing in-flight jobs.

**`src/ingest/sync-runner.ts`** — `SyncRunner.run(provider, request)`: one
provider sync, end to end.

1. Mark the job `RUNNING`, phase `authenticating`; load credentials, refresh if
   needed.
2. Phase `library`: `fetchLibrary`; for each `ExternalGame`, `ingestGame` —
   resolve to a canonical game (see below), upsert `Ownership` with
   provenance, remember the external id. One unparseable title is logged and
   skipped, never fatal. Progress is flushed every 20 games.
3. After a *full* read, `markMissingAsRemoved` sets `removedAt` on ownerships
   the platform no longer lists (an incremental sync legitimately returns a
   subset, so it skips this).
4. Phase `playtime` / `achievements`: `planDetailSweep` picks a budgeted set of
   titles, split by which kind of detail each still needs (a title with
   achievements but no playtime spends its request on playtime).
   `oldestDetailStamp` is what makes "half-checked" sort as urgently as
   "never checked". Activities are written as `PlayActivity` rows with a
   `buildDedupeKey`; achievements upsert the catalogue and the user's unlocks.
5. Counters and phase are written to the `SyncJob` row throughout
   (`flushProgress`), and the job ends `SUCCEEDED`, `PARTIAL` or `FAILED` with
   a message. Partial success is a real outcome: 1,240 of 1,241 games is a
   success with one warning, not a failure.

`sync-runner.test.ts` — the decisions: which kinds to fetch, stamps, dedupe
keys, partial outcomes.

**`src/ingest/game-resolution.ts`** — `resolveExternalGame()`: the matcher's
levels 1–4 against local data; then a live IGDB lookup by store id
(authoritative, and it brings metadata plus the mappings for every other store
the game is on); then a provisional `Game` row queued for review. Helpers
`upsertCanonicalGameFromIgdb`, `applyIgdbMetadataToGame`, `linkGameMetadata`,
`linkPlatforms`, `createProvisionalGame`, `queueForReview`, `uniqueSlug`.

**`src/ingest/metadata-enrichment.ts`** — `enrichProvisionalGames()`: for games
with no IGDB identity, `searchWithFallback` (exact, then normalised, then
loosened), `scoreCandidates` (name similarity, version markers, year,
platforms), apply metadata above a threshold, or merge into an existing
canonical game if the IGDB id is already known, else `markAttempted` so the
same game is not retried every run.

**`src/ingest/interrupted-jobs.ts`** — on start, `SyncJob` rows still
`RUNNING` from a worker that no longer exists are marked interrupted with a
reason, so the interface never shows a dead sync as live.

**`src/dev/`** — terminal tools (`pnpm --filter @omniplay/worker <name>`):

| Script | Does |
|---|---|
| `doctor.ts` | Checks every credential, the database, Redis, IGDB and mail; says what to fix. Never prints secrets. |
| `sync-now.ts` | Queues a sync for a user (optionally one provider) and watches it finish. |
| `demo-sync.ts` | Runs the *real* pipeline with a stubbed Steam serving the fixtures — a demo library without credentials. |
| `demo-enrich.ts` / `enrich-now.ts` | Metadata enrichment against a stubbed / the live IGDB. |
| `connect-psn.ts` / `link-steam.ts` | Attach the instance's PSN account / a SteamID64 to a user. Kept off HTTP because either would let any signed-in user claim the account. |
| `probe-psn.ts` / `probe-openxbl.ts` | Capture real responses into `fixtures/` so adapters are written against fact. |
| `remap-igdb.ts` | Point a game at a different IGDB entry (preview, then `--apply`). |
| `backfill-critic.ts` | Fill critic scores IGDB attaches to a port's parent entry, recording review counts. |
| `sweep-queue.ts` | Close review-queue entries enrichment already answered. |
| `reset-data.ts` | Wipe imported data for one user or the whole instance. |

---

## Part 6 — `apps/web` (the waiter, Next.js)

### How Next.js pages work here

A file at `src/app/<path>/page.tsx` is the page at `/<path>`. A folder in
parentheses like `(app)` groups routes without appearing in the URL. Square
brackets like `[slug]` are dynamic segments.

Most pages are **server components**: they run on the server, call the API
with `apiFetch`, and send finished HTML. Files that begin with `'use client'`
are **client components**: they run in the browser because they need
interactivity (filters, keyboard navigation, animations).

### Config

| File | What it is |
|---|---|
| `next.config.mjs` | Allowed remote image hosts (IGDB, Steam, Xbox CDNs); the dev-tools badge switched off. |
| `postcss.config.mjs` | Wires Tailwind into the CSS build. |
| `next-env.d.ts` | Generated type declarations; do not edit. |

### `src/app/` — pages

**`layout.tsx`** — the root HTML for every page: loads the fonts (Barlow,
Barlow Condensed for display, JetBrains Mono for figures) as CSS variables,
renders the children, and mounts the `Curtain` and `Cursor` once.

**`globals.css`** — the design system. Read it top to bottom once:
- `@theme` — the colour tokens: the ink ramp (a dark violet-grey scale from
  `ink-950` to `ink-100`), true `ink` black, `paper` off-white, the gold
  `accent` and its darker `accent-strong` for paper, the three platform colours
  (PlayStation cyan, Steam violet, Xbox green), `positive`, `warning`, `danger`.
- Typography utilities: `display` (condensed, heavy, italic, uppercase),
  `eyebrow` (small tracked caps), `stat-figure` (mono).
- Shapes: `cut` / `cut-sm` (clipped corners), `slant` (parallelogram),
  `paper` (off-white panel with ink text), `hard-shadow` (a solid gold offset
  shadow, applied on a wrapper because clip-path clips shadows), `card`,
  `glass`, `hud-corners`, `halftone`, `hatch`, `slash`, buttons.
- Motion: the keyframes and `anim-*` utilities for arrivals (`rise`, `fade`,
  `pop`, `grow`, `word`, `page`), the page wipe, staggering via `--i`, the
  reduced-motion overrides.
- The inverted `.auth-paper` token set, and the custom cursor rules.

**`page.tsx`** — `/`: signed in → `/menu`, otherwise → `/register`.

**`not-found.tsx`** — the 404 screen. Deliberately vague ("does not exist, or
is not public") so a private profile is indistinguishable from a missing one.

**Signed-out screens** — `login/`, `register/`, `forgot-password/`,
`reset-password/`. Each asks the API `/auth/methods` (falling back gracefully
if the API is down), redirects to `/boot` when already signed in, and renders
its form inside `AuthShell`.

**`boot/page.tsx`** — after sign-in: fetches `/auth/me` and shows the
"press any key" title screen.

**`menu/page.tsx`** — the main menu: the nine entries (Overview, Library,
Collections, Timeline, Achievements, Statistics, Profile, Settings, and Admin
for admins) with their art, handed to `MainMenu`.

**`u/[username]/page.tsx`** — the public player card. Fetches the profile
directly (forwarding the cookie only so the owner can see a private page),
renders the HUD for a signed-in viewer or a public bar with the way in, the
header with the profile art, the paper tally, and a three-column board:
platforms and genres, the most played shelf and collections, the rarest trophy
and "on record".

**`(app)/layout.tsx`** — the signed-in shell: resolves the session (redirects
to `/login` if none), renders the city `Backdrop`, the `Hud` and the page
container.

**`(app)/template.tsx`** — wraps every page in `PageWipe`. A template remounts
on each navigation, which is what makes the wipe replay.

| Page | What it shows |
|---|---|
| `(app)/dashboard/page.tsx` | Overview: a three-column board — hours by platform and days played by year; currently playing and games played on more than one platform (the ribbon); counts and most played. |
| `(app)/library/page.tsx` | The shelf: the filter deck beside the cover grid or list, paged, with every filter in the URL. |
| `(app)/game/[slug]/page.tsx` | One game: its art graded to one intensity behind everything, the hero with cover, title, badges and the outlined release year, the paper figure strip, About on paper, playtime per platform, verdict, notes, collections, details. |
| `(app)/collections/page.tsx`, `[slug]/page.tsx` | Collections index and one collection with its games. |
| `(app)/timeline/page.tsx` | GitHub-style calendars of dated events, one per year, the filter panel and four figure tiles. |
| `(app)/achievements/page.tsx` | The trophy room: tally strip, the rarest podium, platform panels, standouts beside the trophy case, the decade grid, recent unlocks, progress bands. |
| `(app)/stats/page.tsx` | The status screen: the player card with hours and five ranked stats, Gaming DNA, the year ledger, platforms, cross-platform games. |
| `(app)/most-played/page.tsx` | Every game ranked by hours. |
| `(app)/settings/page.tsx` | Connections and their capability matrix, file import, profile settings, sync. |
| `(app)/admin/page.tsx` | The review queue and data-quality tools (admins only). |

### `src/components/` — reusable pieces

**Frame and shell**
- `ui.tsx` — the shared building blocks: `StatCard`, `PlatformBadge` (slanted
  chip in the platform colour), `ConfidenceNote` (the small slash-marked
  caveat), `PageHeader` (eyebrow, word-by-word title, subtitle, action slot,
  optional full-bleed art banner), `SectionHeading`, `EmptyState`.
- `platform-panel.tsx` — `PlatformPanel`: a card that is unmistakably one
  platform's — colour left edge, header band, the platform's name ghosted in
  outline (sized to the card with `cqw`). Used on the game page, achievements,
  stats and profile.
- `platform-report.tsx` — the game page's per-platform playtime cards:
  ownership with provenance, hours as the lead figure, dated play,
  achievements, and a note under every absence saying what it means.
- `backdrop.tsx` — the fixed footage layer behind every screen; a still or a
  video; `veil` for the shell's dimming, `grade` to pull game art to one
  intensity.
- `hud.tsx` — the sticky top bar: ← Menu (and the Esc key), the wordmark,
  your name and initials linking to your profile, Sign out through the curtain.
- `wordmark.tsx` — the mark: three slanted platform-coloured bars beside the
  name.
- `motion.tsx` — `Motion` (honours reduced motion), `PageWipe`, `Headline`
  (each word rises out of its own clip), `TiltLink` (a link that leans into
  the pointer with a spring). Arrivals are CSS so content never waits for
  JavaScript.
- `curtain.tsx` — the slab wipe between the menu and pages: `raiseCurtain(word)`
  covers the screen with paper/gold/ink slabs and a word, the page changes
  underneath, and it reveals itself when the path changes (or after a timeout).
- `cursor.tsx` — the gold arrowhead cursor with sparks on interactive elements;
  only on devices with a pointer; sparks off under reduced motion.
- `boot-screen.tsx` — the title screen: OMNI/PLAY huge, the paper "press any
  key" prompt breathing, into the menu through the curtain.
- `main-menu.tsx` — the hand of cards: keyboard (arrows, 1–9, Enter, Esc) and
  pointer focus (on move, not enter), spring layout, images, the blurred art
  wash behind, leaving through the curtain, a stacked phone layout.
- `counter.tsx` — a number that counts up when it scrolls into view. The
  server renders the final value so it is correct without JavaScript, and the
  width is reserved so the row never reflows.

**Signed-out**
- `auth-shell.tsx` — the two-column frame: the pitch and the three
  platform-coloured proof points left, the paper card right.
- `auth-form.tsx` — sign-in / sign-up: Google first (greyed with a note when
  unconfigured), then email, username (sign-up) and password, with the API's
  field errors rendered inline. Lands on `/boot`.
- `auth-ui.tsx` — the parts: `AuthField`, `AuthNotice`, `SubmitButton` (a
  sweep while in flight), `OrRule`, `GoogleButton`.
- `password-reset-form.tsx` — `RequestReset` (says exactly what the API did:
  sent to the named address, no account, asked too soon with a countdown, mail
  failed, or logged when no transport) and `ChooseNewPassword` (confirm field
  checked before the request, since success signs you in immediately; a bad
  token gives way to "request a new link").
- `sign-out.tsx` — `requestSignOut()`.

**Library and game**
- `library-filters.tsx` — the filter deck: search (`/` focuses it, debounced),
  sort and view, platform and status tick boxes, ownership, Clear, a phone
  drawer. All state lives in the URL, and the shelf's URL is remembered in
  `sessionStorage` for the game page's back button.
- `library-view.tsx` — `LibraryGrid` (art-first cover cards with the platform
  bar along the foot, the score band-coloured, a caption below) and
  `LibraryList`.
- `back-to-library.tsx` — the fixed "← Library" tab on the game page; returns
  to the remembered shelf URL.
- `game-verdict.tsx` — set the game's status and your 1–10 score.
- `game-notes.tsx` — dated notes, the only text on the page that can only come
  from you.
- `add-to-collection.tsx` — adds the game to a collection (fetched on open).
- `collection-form.tsx` — create a collection and go straight into it.

**Timeline, achievements, statistics**
- `timeline-year.tsx` — one year's calendar grid: arrow-key navigation that
  skips empty days, glow selection, a day-detail panel.
- `timeline-filters.tsx` — the filter panel with tick rows and the "on the
  board" readout (split by kind and platform); URL state; `none` means nothing
  ticked.
- `achievement-band.tsx` — one completion band of poster tiles, collapsed to a
  row by default with a paper heading tag.

**Settings and admin**
- `provider-card.tsx` — one connection: connect, or disconnect with the second
  question (unlink, or unlink and erase).
- `provider-setup.tsx` — setup instructions for an unconfigured platform,
  shown instead of a dead Connect button.
- `import-panel.tsx` — CSV upload reporting "7 imported, 1 skipped" with reasons.
- `sync-button.tsx` — Sync All with progress polled only while a sync is in
  flight.
- `profile-settings.tsx` — display name, bio and the Public profile toggle,
  with plain copy about what becomes visible.
- `admin-tools.tsx` — the mapping screen: map to an existing game, create a
  new one, or ignore — deliberately equal in prominence.
- `share-link.tsx` — "Share" copies the page's address.

### `src/lib/` — helpers

- `api.ts` — `apiFetch` (server-side, forwards the session cookie, throws
  `ApiError`), `apiFetchOptional` (null on 401), `apiFetchOrNull` (null on any
  failure, for reads a page can do without).
- `format.ts` — `formatHours`, `formatCount`, `formatDate`, `formatRelative`,
  `providerLabel`, `STATUS_LABELS`. Centralised so "247h" means the same thing
  on every screen.
- `platform.ts` — `platformStyle(provider)` returns the platform's colour as
  Tailwind classes (`bar`, `text`, `ring`, `border`, `edge`, `bloom`) — one
  colour per platform everywhere. `staggerStep(count)` keeps a long list's
  entrance under a time budget.
- `critic.ts` — `isThinlyReviewed`, `criticProvenance`: a 92 off two reviews
  is not a 92, and the interface marks it.
- `timeline.ts` — the timeline's event kinds and labels in a plain module so
  both server and client components can import them.
- `ranks.ts` — the statistics page's five ranked stats: fixed thresholds and
  titles, each shown over the figure it was read from.
- `critic.test.ts`, `timeline.test.ts`.

---

## Part 7 — Where to go next

- To change how a number is computed, start in `packages/statistics`.
- To add a platform, write an adapter in `packages/providers`, register it in
  `registry.ts`, add it to `catalogue.ts`, and add its credentials to
  `config.ts` and `.env.example`.
- To add a page, add a folder under `apps/web/src/app/(app)/`, fetch with
  `apiFetch`, and build from `ui.tsx`, `platform-panel.tsx` and the utilities
  in `globals.css`.
- To add an API endpoint, add a method to the relevant controller and service,
  validating input with `zodBody`.
- Run `pnpm typecheck` and `pnpm test` before every commit; CI runs the same.
