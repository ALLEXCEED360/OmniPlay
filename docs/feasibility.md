# OMNIPLAY — Feasibility Assessment

Assessed 23 August 2026, against the project spec.

**Verdict: buildable as specified, with one scope correction and three risks
that need managing.** The architecture in the spec is sound — notably the
insistence that the canonical model and provider abstraction exist before the
second integration, which is the decision that usually sinks projects like this.
The correction concerns what "unify your gaming history" can honestly mean given
what the platforms actually expose.

---

## 1. Platform reality check

The spec's §41 is already appropriately cautious. Verified against current
documentation:

### Steam — fully feasible

| Capability | Status |
|---|---|
| Browser sign-in | OpenID 2.0, documented and supported |
| Owned games + playtime | `IPlayerService/GetOwnedGames` |
| Achievements | `ISteamUserStats/GetPlayerAchievements` |
| Profile | `ISteamUser/GetPlayerSummaries` |

Three constraints shape the implementation:

- **No user token exists.** Steam OpenID returns a verified SteamID64 and
  nothing else; all data access uses *our* publisher API key. There is no
  refresh flow and nothing user-specific to encrypt.
- **Privacy gates everything.** If "Game details" is not public, `GetOwnedGames`
  returns `200` with an empty object — not a `403`. Treating that as "0 games"
  is the single most likely way to ship a product that looks broken. The adapter
  detects it and returns a `PRIVATE_PROFILE` error with instructions.
- **No session history.** Steam reports a *lifetime total* it overwrites on
  every sync, plus a two-week window. It never says when those hours happened.

### Xbox — feasible, highest technical risk

The token chain is real and documented:

```
Microsoft OAuth (scope XboxLive.signin + XboxLive.offline_access)
  → user.auth.xboxlive.com   (RpsTicket must be prefixed "d=")
  → xsts.auth.xboxlive.com   (RelyingParty http://xboxlive.com)
  → Authorization: XBL3.0 x=<userhash>;<xsts-token>
```

The `d=` prefix is required specifically because we use our own Azure app
registration rather than a first-party Microsoft client. Omitting it produces a
silent `400`, and it is the most common failure in third-party implementations.

**The scope correction.** Xbox's title-history endpoint is *achievement-derived*.
It lists titles the user has earned achievements in, plus recent activity. It is
**not** a complete launch record, and it is **not an ownership list at all**.
Xbox exposes no playtime figure through these endpoints either.

So Xbox cannot answer "what do I own on Xbox". It can answer "what have I played
on Xbox, approximately". A product that presents Xbox title history as a library
will show users games they do not own and omit games they do. This project
records it as `ACHIEVEMENT_HISTORY` activity at `DETECTED` confidence and
declines to create ownership rows from it.

*Risk:* this flow is documented but not contractually guaranteed for consumer
apps, and Microsoft could restrict it. Mitigation: the adapter is isolated behind
the provider interface, and [OpenXBL](https://xbl.io) is a drop-in fallback that
implements the same contract.

### PlayStation — not feasible via API; import fallback only

There is no public consumer API equivalent to Steam's or Microsoft's. The
official developer portal is partner-oriented. The commonly cited community
endpoints are reverse-engineered, unsupported, and break without notice.

The spec's instruction — *"do not architect OMNIPLAY around a permanent
unofficial PSN API"* — is correct and is followed here. `providers/psn/` is a
placeholder implementing the same interface, to be filled by either an approved
integration or a file import. **Plan for the import path being the real one.**

### IGDB — fully feasible

Twitch client-credentials auth; token lasts ~60 days. **Rate limit is 4
requests/second**, which is the binding constraint on first-sync speed for a
large library. Mitigations implemented: batched `where id = (...)` queries, a
token-bucket limiter pinned to 4/sec, and importing *every* store mapping IGDB
returns — so connecting Xbox after Steam resolves at level 1 with zero extra
requests.

---

## 2. What this means for the product promise

The spec's §40 end state is *"This is my entire gaming life."* Honestly
achievable today:

| | Steam | Xbox | PlayStation |
|---|---|---|---|
| Complete owned library | ✅ | ❌ | ❌ |
| Playtime | ✅ lifetime only | ❌ none | ❌ |
| Achievements | ✅ | ✅ | ❌ |
| Evidence of play | ✅ | ⚠️ partial | ❌ |
| Dated history | ⚠️ 2-week window | ⚠️ achievement dates | ❌ |

This is not a reason to abandon the idea — it is a reason to make provenance a
**visible product feature** rather than an internal detail. The spec already
says this (§2.5, §24); this assessment simply raises its priority from
"eventually" to "day one". A user who sees *"Xbox: activity detected,
ownership unknown"* trusts the product. A user who sees a confidently wrong
library does not.

---

## 3. Architecture assessment

**Sound as specified, adopted unchanged:**

- Modular monolith + workers + adapter layer — right size for this scope.
- Canonical model before the second provider (§39). This is the single most
  important instruction in the spec.
- Separating ownership / entitlement / activity / achievements (§2.2).
- Provenance on every meaningful record (§2.5).
- Postgres FTS before reaching for Elasticsearch (§17).
- Background jobs for all provider I/O (§11).

**Three deviations, each deliberate:**

1. **`GamingProvider.authenticate()` split into `beginAuth`/`completeAuth`.**
   A single method cannot express a browser redirect round-trip, which all
   three launch providers require.

2. **Collection methods return `AsyncIterable`.** A 5,000-game library streams
   and upserts page by page rather than buffering in memory.

3. **`provider` is a `String` column, never a Postgres enum.** §33 says not to
   hard-code provider assumptions; an enum would make adding Epic a migration.

**One gap the spec does not address:** playtime arithmetic. Steam's lifetime
total is *re-observed* on every sync, not accumulated. Summing observations
inflates a user's hours on every press of Sync. But the same game on Steam and
PlayStation represents two real playthroughs that *should* add. The rule
implemented — max per `(game, provider)`, then sum across providers — is in
`packages/statistics` with tests covering both directions.

---

## 4. Timeline

The 12-week plan is realistic **for full-time work**. Part-time, expect 20–24
weeks. Weeks most likely to overrun:

- **Week 7–8 (Xbox).** The token chain is fiddly and fails opaquely. Budget
  double.
- **Week 5 (matching).** Entity resolution always takes longer than expected.
  Manual resolution (§9 level 5) is not optional polish — it is what makes the
  other four levels safe to tune.
- **Week 10 (PSN).** Likely to end in the import fallback. Plan for that
  outcome rather than treating it as failure.

---

## 5. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Xbox restricts third-party XSTS | Low–medium | High | Adapter isolated; OpenXBL implements same contract |
| PSN never becomes available | **High** | Medium | Import path designed in from the start |
| Entity resolution false merges | Medium | **High** | Version markers block merges; admin queue; false splits preferred |
| IGDB 4 req/s throttles first sync | High | Low | Batching, store-id mappings, background jobs |
| Steam privacy settings confuse users | High | Medium | Explicit `PRIVATE_PROFILE` error with instructions |

The false-merge risk deserves emphasis: pooling two games' playtime is
**unrecoverable** without re-syncing from scratch, whereas a false split is one
click for an admin to fix. The matcher is tuned accordingly — it refuses to
merge across version markers ("Resident Evil 4" vs "Resident Evil 4 Remake")
however similar the strings, and defers to a human on near-ties.

---

## 6. Bottom line

Build it. The architecture is right, the hard parts are correctly identified,
and the phasing is sensible.

Change one thing: treat **provenance and confidence as user-facing features
from day one**, not as a later refinement. It is what separates this from a
library aggregator that quietly lies, and it is the honest answer to what these
three platforms will actually tell you.
