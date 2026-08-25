# OMNIPLAY

**One identity. Every game. Your entire gaming history.**

A personal gaming identity platform that unifies what you own, have owned,
played and finished across Steam, Xbox and PlayStation into a single canonical
record — one you control, with every fact traceable to its source.

```
                +-------------------+
                |     OMNIPLAY      |
                | Gaming Identity   |
                +---------+---------+
                          |
                  +-------+--------+
                  | Provider Layer |
                  +-------+--------+
                          |
          +---------------+---------------+
          |               |               |
        Steam           Xbox             PSN
          |               |               |
          +---------------+---------------+
                          |
                   Normalization
                          |
                  Game Resolution
                          |
                 Canonical Database
                          |
        +---------+-------+--------+---------+
        |         |       |        |         |
     Library   Timeline  Stats  Achievements Profile
```

---

## Quick start

**Requires** Node 22+, pnpm 11+, Docker.

```bash
pnpm install
cp .env.example .env          # then fill in the secrets below
pnpm infra:up                 # Postgres + Redis
pnpm db:push && pnpm db:seed  # schema, extensions, trigram indexes, platforms
```

Generate the two required secrets:

```bash
openssl rand -base64 32   # SESSION_SECRET
openssl rand -base64 32   # CREDENTIAL_ENCRYPTION_KEY
```

Then run the three processes:

```bash
pnpm --filter @omniplay/api dev
pnpm --filter @omniplay/worker dev
pnpm --filter @omniplay/web dev
```

Open <http://localhost:3000>, create an account, and connect a provider from
Settings.

### Seeing your real library

**Nothing appears until you connect a real account.** Settings lists every
platform with exactly what it needs — Steam and Xbox want credentials, the rest
take a file. Whatever is missing is named there, so you never have to guess.

**Demo data.** These seed a fixture library through the real ingestion
pipeline, so the app can be exercised with no credentials at all:

```bash
pnpm --filter @omniplay/worker demo your@email.com     # a fake Steam library
pnpm --filter @omniplay/worker demo:enrich             # fake IGDB metadata
```

That data is deliberately indistinguishable from real data once stored — it
goes through the same pipeline — so clear it before connecting real accounts:

```bash
pnpm --filter @omniplay/worker reset your@email.com --connections
```

---

## Provider credentials

None are required to boot. A provider is offered only when configured, so a
Steam-only instance works fine.

Two platforms have a real API. The rest do not, and no amount of engineering
changes that — see [docs/feasibility.md](docs/feasibility.md).

| Platform | How it connects | What you need |
|---|---|---|
| **Steam** | Real API | [Web API key](https://steamcommunity.com/dev/apikey) → `STEAM_API_KEY`. Your profile *and* "Game details" must be Public |
| **Xbox** | Real API | [OpenXBL key](https://xbl.io) → `OPENXBL_API_KEY` (no Azure needed), *or* an Azure app → `XBOX_CLIENT_ID` |
| **PlayStation** | File import | No public consumer API exists |
| **Ubisoft Connect** | File import | No public API; community endpoints need your password, which we will not ask for |
| **EA** | File import | No public API for the EA app |
| **Manual entry** | File import | Physical copies, retro consoles, anything else |
| **IGDB** *(metadata)* | Real API | [Twitch app](https://dev.twitch.tv/console/apps) → `IGDB_CLIENT_ID`/`SECRET`. Optional but strongly recommended |

For the import platforms, request a personal-data export from the platform
itself (Settings links to each), or write the CSV by hand. Note that Ubisoft
and EA titles bought *through Steam* already arrive with your Steam library.

Games that arrive before IGDB is configured are not stranded: the **Data
quality** screen backfills their metadata afterwards.

> Steam will not return your library unless **Game details** is set to Public in
> your Steam privacy settings. OMNIPLAY detects this and says so rather than
> silently reporting zero games.

---

## Architecture

Modular monolith, background workers, provider adapter layer.

```
apps/
  web/       Next.js 15 — dark-first UI, server components
  api/       NestJS 11 — REST, sessions, provider connect flows
  worker/    BullMQ — sync jobs, ingestion, entity resolution
packages/
  database/       Prisma schema + credential encryption
  types/          Provider contract, domain vocabulary, queue contract
  providers/      Steam, Xbox, IGDB adapters + rate limiting/retry/circuit breaker
  game-matching/  Title normalisation + 5-level canonical resolution
  statistics/     Playtime and library aggregation
```

### Three ideas the rest follows from

**1. Providers are data sources, not the database.** Every adapter implements
one `GamingProvider` interface. Nothing downstream — matching, statistics, UI —
knows whether a record came from Steam or Xbox. `provider` is a `String`
column, never an enum, so adding Epic is a row rather than a migration.

**2. Ownership, activity and achievements are separate facts.** A game you own
but never launched, a game you played at a friend's house, and a game you have
achievements in but never bought are three different things. Xbox's title
history proves *activity*, not entitlement — so it creates no ownership rows.

**3. Provenance travels with the data.** Every meaningful row carries a source,
a confidence level, and an observation time. The UI surfaces it: a figure
derived from achievement history does not look identical to one Steam stated
outright.

### Entity resolution

The piece most likely to quietly corrupt everything, so it is layered:

| Level | Method | Confidence |
|---|---|---|
| 1 | Known provider id → canonical game | `VERIFIED` |
| 2 | IGDB store-id mapping | `VERIFIED` |
| 3 | Exact normalised title | `DERIVED` |
| 4 | Trigram-ranked fuzzy match | `DERIVED` |
| 5 | Queued for human review | — |

The normaliser draws a hard line between **edition** markers (packaging of the
same game — "Deluxe", "GOTY") which are stripped, and **version** markers
(a different product — "Remake", "Remastered", "VR") which are preserved and
block a merge outright. `Resident Evil 4` and `Resident Evil 4 Remake` are one
token and a very high similarity score apart, and must never collapse.

Ambiguous markers are classed as versions, because a false split is one admin
click to fix and a false merge silently pools two games' history forever.

### Playtime arithmetic

Steam reports a **lifetime total it overwrites on every sync**, not an event.
Summing observations would inflate your hours every time you press Sync. But
the same game on Steam and PlayStation is two real playthroughs that *should*
add.

The rule: **max per `(game, provider)`, then sum across providers.** It lives in
`packages/statistics` with tests covering both directions, and the ingestion
layer enforces it with an idempotency key per logical fact.

---

## Testing

```bash
pnpm test        # all packages
pnpm typecheck
```

Provider parsers run against sanitized contract fixtures
(`packages/providers/fixtures/`) on every CI run, so a changed upstream
response shape surfaces there rather than in someone's playtime total.

---

## Importing PlayStation and physical copies

PlayStation has no public consumer API, so it works by file import rather than
sign-in (see [docs/feasibility.md](docs/feasibility.md)). Settings → PlayStation
takes a CSV or JSON file:

```csv
Title,Platform,Hours,Status,Ownership,Acquired
Bloodborne,PS4,62.5,Completed,Physical,2015-03-24
Ghost of Tsushima,PS4,55,Playing,Digital,2020-07-17
```

Only `Title` is required. The parser is forgiving about column naming and
hour notation (`12h`, `1.5`, `3:30`), reports bad rows rather than rejecting
the file, and refuses ambiguous dates like `01/02/2024` instead of guessing.
Everything imported is marked `DECLARED` so it never looks like verified
provider data. The same path backs **Manual entry**, for physical and retro
collections.

Crucially, imports run through the *same* pipeline as API-backed providers —
same entity resolution, same provenance, same dedupe. A PlayStation copy of a
game you also own on Steam lands on one canonical game page with both
platforms' hours shown separately.

---

## Data quality

Automatic matching is deliberately tuned to **defer rather than guess**, so a
queue of decisions accumulates by design. `/admin` is what drains it — without
it, the resolver's caution would just be a permanent backlog.

Grant yourself access:

```sql
UPDATE "User" SET "isAdmin" = true WHERE email = 'you@example.com';
```

The screen covers four jobs:

- **Unresolved provider records** — the mapping UI from spec §26. Candidates
  are re-scored against the live catalogue on every load, and the three
  outcomes (map / create / ignore) are given equal prominence on purpose:
  making "map" the visual default would encourage clicking the top suggestion,
  which is precisely the reflex that produces false merges.
- **Games without metadata** — queue an IGDB backfill for one game or the
  whole provisional backlog.
- **Possible duplicates** — grouped by normalised title, merged into a survivor
  you pick explicitly.
- **Recent sync problems** — failed and partial syncs with their error kind.

Metadata enrichment runs on its own BullMQ queue, so an admin backfilling 500
games never delays a user pressing Sync.

Enrichment reuses the resolver's version-marker guard rather than trusting
IGDB's ranking: IGDB returns "Resident Evil 4" as the top hit for "Resident
Evil 4 Remake", and applying that metadata would relabel one product as
another. Its acceptance threshold is *higher* than the resolver's, because it
rewrites a game's identity rather than just attaching a store id.

**Try it without Twitch credentials** — this runs the real enrichment path
against a stubbed IGDB:

```bash
pnpm --filter @omniplay/worker demo:enrich
```

---

## Status

Implemented: canonical model, provider abstraction, Steam (OpenID + library +
playtime + achievements), Xbox (full token chain, title history, achievements),
PlayStation and manual entry via file import, IGDB metadata, entity resolution,
sync pipeline with rate limiting and circuit breaking, dashboard, library, game
pages, timeline, statistics, collections, public profiles, settings.

Also implemented: IGDB metadata enrichment, the admin mapping queue, canonical
game merging, duplicate detection, an achievements screen, and Xbox through
either OpenXBL or a direct Azure registration.

### A note on Xbox

Two adapters satisfy the same `GamingProvider` interface. **OpenXBL** needs only
an API key; the **direct** route needs an Azure app registration, which a
personal Microsoft account cannot create — the portal places such accounts in a
restricted tenant where registration is refused. The registry prefers OpenXBL
when its key is present, and nothing downstream can tell which one answered.

Xbox gives **achievements and evidence of play, not a library**: title history
is achievement-derived. The one genuine entitlement signal is `isGamePass`,
recorded as `SUBSCRIPTION`.

Playtime *is* available, but not with the library — Xbox keeps `MinutesPlayed`
in a per-title stats collection, one request per game. So hours arrive a few
titles at a time rather than all at once.

OpenXBL's free tier allows **150 requests an hour** — about one every 24
seconds. Per-game detail (playtime *and* achievements) is therefore fetched for
a bounded number of titles per sync (`achievementSweepBudget`), ordered by when
each was last asked rather than by whether it returned anything. Selecting on
"has no achievements" stalled: titles that genuinely have none stayed eligible
forever and consumed the budget on every run.

Run a sync a few times to fill a library in; each pass covers the next several
games and a re-sync of covered ones costs almost nothing.

Not yet: Gaming Wrapped, additional platforms (Epic, GOG), achievement detail
pages.

See [docs/feasibility.md](docs/feasibility.md) for what each platform will
actually tell you, and what that means for the product promise.

## Windows note

`prisma generate` cannot replace its query-engine DLL while a Node process has
it loaded. If a build fails with `EPERM ... query_engine-windows.dll.node`,
stop the API and worker first.

## Licence

MIT
