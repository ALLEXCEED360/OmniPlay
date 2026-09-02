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

Everything else in `.env` is optional and named in `.env.example`: provider
credentials, IGDB metadata, Google sign-in, and a Resend key for password-reset
email. `pnpm doctor` reports which are set and what each missing one costs
you.

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

## Running it day to day

Once the setup above has been done once, starting the app is two commands:

```bash
pnpm infra:up   # Postgres + Redis, if they are not already running
pnpm dev        # API, worker and web together
```

Then open <http://localhost:3000> and sign in. Everything that was synced
before is still there — the database lives in a Docker volume, not in the
processes.

`pnpm dev` runs all three via Turborepo. To watch one of them closely, run it
on its own instead:

```bash
pnpm --filter @omniplay/api dev      # http://localhost:4000
pnpm --filter @omniplay/worker dev   # no port; processes the sync queue
pnpm --filter @omniplay/web dev      # http://localhost:3000
```

Stop everything with Ctrl-C. `pnpm infra:up` can be left running between
sessions; `pnpm infra:down` stops the containers without deleting data.

Check the setup at any time with:

```bash
pnpm doctor
```

It reports the database, Redis, both secrets, and every provider credential —
including whether the PlayStation session token has expired, which it will do
roughly every two months.

### When something does not work

**The page loads but the library is empty, or a sync never finishes.**
The worker is not running. It has no port and prints little, so it is the easy
one to miss — the API and the site both work fine without it, they just never
process a job. Check for a queued job that nobody picked up:

```bash
docker exec omniplay-postgres psql -U omniplay -d omniplay   -c 'SELECT provider, status, phase FROM "SyncJob" ORDER BY "createdAt" DESC LIMIT 5;'
```

A row stuck at `QUEUED` means exactly that.

**Port 3000 is already in use.** Another project is on it. Either stop that
one, or run the site on a different port:

```bash
pnpm --filter @omniplay/web exec next dev -p 3007
```

The API URL is read from `NEXT_PUBLIC_API_URL`, so the site still finds it.

**A sync behaves as though your code changes did nothing.** Two causes, both
seen in practice:

- *A second worker is still running.* Both consume the same queue and jobs land
  on whichever grabs them first, so an old build appears to answer at random.
  Closing a terminal does not always kill the process it started. On Windows:
  `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*OmniPlay*' }`
- *A workspace package needs rebuilding.* The API and worker import
  `@omniplay/providers` from its compiled `dist/`, so editing its source alone
  changes nothing until `pnpm --filter @omniplay/providers build` runs. The
  `dev` scripts watch their own app, not their dependencies.

**A change to `.env` seems to be ignored.** The API reads that file once, when
the process starts — `node --watch` restarts it for compiled-output changes,
not for `.env`. Restart the API after editing it. `pnpm doctor` reads `.env`
directly, so it can disagree with a running process, which is itself the
clue.

**A sync is stuck on "running" and never finishes.** A worker killed mid-sync
cannot come back to the job, and the `SyncJob` row is our own bookkeeping
rather than BullMQ's, so nothing else settles it. The worker reconciles those
at startup: anything still marked running two hours on is failed with
`INTERRUPTED` and an explanation. The threshold is deliberately generous —
these rows have no heartbeat, so a live-but-slow sweep and a dead worker look
identical, and only one of those mistakes is recoverable.

**PlayStation stops working after a couple of months.** The npsso is a browser
session token, not an API key, and Sony expires it. `pnpm doctor` says so
plainly. Sign in at playstation.com, reopen
<https://ca.account.sony.com/api/v1/ssocookie>, and replace `PSN_NPSSO` in
`.env`.

## Accounts

Sign in with a password or with Google. Neither is required to boot: password
sign-in always works, and the Google button renders only when the instance has
credentials for it — the sign-in page asks the API what it supports rather than
assuming, so an unconfigured instance shows no button instead of one that dead
ends.

| | What you need | Without it |
|---|---|---|
| **Password** | Nothing | — |
| **Google** | OAuth client from [Google Cloud](https://console.cloud.google.com) → `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, with `<API_URL>/auth/google/callback` as an authorised redirect URI | Button is hidden |
| **Email** *(password reset)* | [Resend](https://resend.com) key → `RESEND_API_KEY`, and `MAIL_FROM` on a domain you have verified | Reset links go to the API log, and the reset screen says so |

Google accounts are matched on Google's `sub`, never on the email address: an
address can be reassigned, and treating it as identity would hand the new owner
someone else's account. An address Google will not vouch for
(`email_verified: false`) is used for nothing — neither linking to an existing
account nor opening a new one.

### Password reset

Reset links are single use, expire in an hour, and destroy every other session
when consumed — if the reset happened because someone else had the password,
leaving their session alive defeats the point. The endpoint answers identically
whether or not the address has an account, so it cannot be used to test which
emails are registered.

**Mail is the part that needs attention.** Resend's default sender,
`onboarding@resend.dev`, only delivers to the address that owns the Resend
account, so the first test always works and every later one silently does not.
Both `pnpm doctor` and the API's startup log warn about exactly that. Verify a
domain and point `MAIL_FROM` at it to reach anyone else.

Check the whole path in one command, rather than by triggering a reset and
hoping:

```bash
pnpm --filter @omniplay/api mail:test you@example.com
```

It reads the same configuration the API does and interprets the failure —
unverified domain, wrong key, rejected recipient — instead of printing a status
code.

There is also a local escape hatch for a password nobody can recover. It never
stores or echoes what you type:

```bash
pnpm --filter @omniplay/api password set you@example.com
```

---

## Provider credentials

None are required to boot. A provider is offered only when configured, so a
Steam-only instance works fine.

Two platforms have a supported API. PlayStation has an unofficial route, taken
deliberately and described below. The rest have neither — see
[docs/feasibility.md](docs/feasibility.md).

| Platform | How it connects | What you need |
|---|---|---|
| **Steam** | Real API | [Web API key](https://steamcommunity.com/dev/apikey) → `STEAM_API_KEY`. Your profile *and* "Game details" must be Public |
| **Xbox** | Real API | [OpenXBL key](https://xbl.io) → `OPENXBL_API_KEY` (no Azure needed), *or* an Azure app → `XBOX_CLIENT_ID` |
| **PlayStation** | Unofficial API, *or* file import | Session token from [ssocookie](https://ca.account.sony.com/api/v1/ssocookie) → `PSN_NPSSO`. Expires every ~60 days |
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
  providers/      Steam, Xbox, PlayStation, IGDB adapters + rate limiting/retry/circuit breaker
  game-matching/  Title normalisation + 5-level canonical resolution
  statistics/     Playtime and library aggregation
  config/         Shared TypeScript configuration
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

## PlayStation

Sony publishes no consumer API. PlayStation is therefore the one provider here
that talks to endpoints Sony never offered — the ones behind the PlayStation
mobile app — authenticated with an `npsso` session token you paste in yourself.

That is a deliberate exception to the rule the other adapters follow, and it is
worth being clear about what it costs:

- It is unofficial, and Sony can change or close those endpoints at any time.
- The `npsso` is a **session credential, not an API key**. Anyone holding it can
  act as you on PSN. It is stored only in `.env`, which is gitignored.
- It expires roughly every 60 days and has to be replaced by hand.

What it buys is the richest data in the app. PlayStation reports per-title
durations *with* first and last played dates, play counts, and individually
dated trophy unlocks. Steam, by comparison, reports a lifetime total with no
dates at all — so PlayStation is the only provider that can say *when* a game
was played rather than merely how long.

Ownership is inferred from Sony's `service` field, which distinguishes titles
that came through the store from those that did not (discs, pre-installed).
Because Sony never states entitlement outright, those rows are recorded as
DERIVED rather than VERIFIED.

Leave `PSN_NPSSO` unset and PlayStation falls back to file import, below.

### Importing PlayStation and physical copies

Settings → PlayStation also takes a CSV or JSON file, which is the route for
physical copies, retro consoles, and anything else no API knows about:

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
PlayStation (live API via npsso, with file import as the fallback), manual
entry via file import, IGDB metadata, entity resolution, sync pipeline with
rate limiting and circuit breaking, dashboard, library, game pages, timeline,
statistics, collections, public profiles, settings.

Also implemented: IGDB metadata enrichment, the admin mapping queue, canonical
game merging, duplicate detection, an achievements screen, Xbox through either
OpenXBL or a direct Azure registration, and the accounts layer below.

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
pages, per-game notes (the table exists and the API returns it, but nothing
writes one yet), and sign-in by phone — which needs a paid SMS provider and
is a poor fit for a product already anchored on email and platform accounts.

Two documents go deeper than this one:

- [docs/architecture.md](docs/architecture.md) — the decisions that are hard to
  infer from the code, and the reasoning behind them.
- [docs/feasibility.md](docs/feasibility.md) — what each platform will actually
  tell you, and what that means for the product promise.

## Windows note

`prisma generate` cannot replace its query-engine DLL while a Node process has
it loaded. If a build fails with `EPERM ... query_engine-windows.dll.node`,
stop the API and worker first.

## Licence

MIT
