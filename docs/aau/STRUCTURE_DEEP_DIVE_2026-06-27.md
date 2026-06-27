# AAU Backbone — Structure Deep-Dive & Forward Plan (2026-06-27)

Operator-directed pause to set the structure correctly **before** building screens.

## 0. WHAT THIS ACTUALLY IS (the framing that governs every decision below)

This is **the canonical, multi-tenant, multi-source GAME-INFORMATION BACKBONE** — the single
source of truth for game times, locations, addresses, scores, standings, and brackets. It is to
games what `@aster/weather` is to weather: a standalone data service that **every tenant app pulls
from** and stores none of itself.

- **Consumers (tenants), present + future:** the AAU tracking hub (`astersports.io/aau`), the
  Legacy Hoopers site/app (the anchor tenant), and every future tenant — all read game info from
  here via the public RPC API, exactly as the AAU hub does today (`client/src/lib/aster.ts`, thin
  public consumer, publishable anon key).
- **Sources (plural):** TourneyMachine for most tournaments **plus non-TM tournament links** (other
  providers exist; some events are not on TM). The schema must be **source-agnostic** with
  per-entity provenance.
- **Consequence:** stable keys, clean taxonomy, and a documented read API are not nice-to-haves —
  consumers' references break if these churn. Get the structure right first; screens are downstream.

This makes the whole thing **architect-scoped** (data model + API contract). This doc is the
artifact for ratification.

---

## 1. The five backbone principles (set these correctly now)

1. **Canonical, source-neutral schema.** `tournaments → divisions → teams → games → venues` are the
   canonical entities, independent of who supplied them. Today everything is TM-keyed
   (`tm_id_tournament`, `external_team_key`, `external_game_id`). **Add a `source` discriminator**
   (`tourneymachine` | `manual` | `our_program` | …) + the source's native ref on each entity, so a
   non-TM link lands in the same shape and is provenance-labeled. Our-own-program games (a tenant's
   real games) are AUTHORITATIVE; scraped external data is labeled as such (master spec TECH-3 O3).
2. **Stable public identity that survives re-ingest.** Consumers must reference entities by keys
   that don't churn when a tournament re-scrapes: team = `resolved_key` (+ `external_team_key` for
   collision-proofing), venue = the deduped building, game = a stable game key. (This session fixed
   two of these: the schedule RPC now keys on `resolved_key`; venues deduped 247→52 buildings.)
3. **The read API IS the contract.** Tenants call the public SECDEF RPCs (org-gated, PII-stripped),
   never the tables. Treat the RPC surface as a versioned, documented API — additive changes only,
   stable field names. (Have: directory, standings+rating, schedule+venue, search, ingest-status.)
4. **Multi-tenant gating stays at the data layer.** `org_is_public_listed` + RLS already gate what
   anon/tenants can read. Published game data is shared; tenant-owned/child data stays scoped.
5. **Indexing for read-heavy scale.** Many tenants × many tournaments × many seasons = read-heavy.
   Index the access paths (see §2.C); archive old seasons out of the live path; partition only when
   genuinely huge (later, not now).

---

## 2. Structural decisions to LOCK (grounded in the live DB)

### A. DIVISION TAXONOMY — structure the identity, stop parsing names
`tournament_divisions.grade_label` + `gender` are **NULL on 100% of 292 divisions.** Identity is
trapped in inconsistent names: `"Girls - 5th/6th"`, `"Boys - 2nd/3rd"`, `"[Sat] Boys 5th Grade
Black Diamond"`, `"Girls 6th Grade Ballers"`. **Add + backfill structured columns:** `gender`
(M/F/Coed), `grade_label` ("5th", "5th/6th"), `tier` (pool/bracket tag: "National Gold", "Black
Diamond", null), `day` (Sat/Sun, null). Backfill by parsing existing names; fix the ingest to fill
them going forward. → clean standings grouping ("Girls · 5th/6th · Gold") + a predictor that keys
on a real division, for every consumer.

### B. BRACKET + PLACEMENT — populate `bracket_slots` (currently 0 rows)
No bracket data → pool-rating predictions only, no champion derivation, and **no way to model "1st
of Gold vs 1st of Orange" cross-division playoff games.** Extend ingest to capture the bracket tree
(rounds, slots, `seed_source` — incl. cross-division feeds, `advances_to_slot_id`) and derive
placement (champion = terminal slot). Schema already supports it (master spec §16.B). Highest-leverage
missing layer; unlocks exact predictions, champion banner (render 05), road-to-the-chip (12-feat 04).

### C. TOURNAMENT TAXONOMY — one indexed table, a clean season/circuit path (NOT per-tournament folders)
**Direct answer to "subfolder per tournament vs one folder":** ONE set of well-indexed tables.
Per-tournament separation fragments every cross-tournament query (records, season aggregation,
team-follow, multi-tenant reads). Postgres scales to tens of thousands of games on one schema.
The "clear path" is logical, via columns: populate `circuit` (null on 6/12), add `season`
(spring/summer/fall/winter) + `year`; index `(circuit, year, season, start_date)`; directory groups
**Circuit → Season+Year → Tournament**, default to live & upcoming, archive past seasons
(`archived_at`, already supported) out of the live path but still queryable for records.

### D. SOURCE ABSTRACTION — TM today, non-TM tomorrow
Add the `source` provenance (principle 1). TM ingest is the first adapter; non-TM links get a generic
adapter (master spec S2: fetch → schema-constrained extraction → validate-or-hold, same
no-fabrication discipline). One canonical schema, many adapters.

### E. TEAM IDENTITY + PROGRAM + the PREDICTIVE SUBSTRATE (set the bones for ML now)
Team names are stable at the **program** level but drift at the variant level — a coach suffix
changes (`"High Rise - Brie"`, `"High Rise - Will"`, `"High Rise - Ayo"` are variants of program
**High Rise**). Lock a two-level identity:
- **program** (stable: "High Rise", "East Coast Storm") + **team variant** (program + coach/squad).
- resolve variants under their program so a suffix change doesn't fork the history; keep
  `external_team_key` (TM's per-appearance id) for collision-proofing.

**Why this is the "bones for the future":** we already hold **every game in history** — opponents,
points-for/against, W/L, dates, across all events — and the #1125 rating already aggregates
opponent-adjusted margin across all public tournaments by `resolved_key`. That history IS the
feature store. Locking stable team↔program identity makes it a clean training substrate so the
predictor can EVOLVE without a data migration:
- **now:** opponent-adjusted margin rating + grade prior (heuristic, honest, labeled "projection").
- **next:** head-to-head priors (prior meetings between these exact teams), recency-weighting,
  points-for/against distributions, strength-of-schedule — all derivable from the existing game graph.
- **later:** a trained ML model reading the same graph; the EXACT bracket clinch/elim math stays
  separate + authoritative (master spec F1 — never conflate the estimate with the exact math).

No schema churn needed for the model itself — the bones are the stable identity + the full,
indexed, cross-tournament game history. Lock identity now; the model is then an additive layer.

---

## 3. Build vs the renders — consumer-surface inventory (the AAU hub is consumer #1)

| # | Render surface | Built? | Gap |
|---|---|---|---|
| 01 Discovery | ✅ | dates fix in PR #150 |
| 02 Track one/many | ✅ | faithful |
| 03 My Teams / dashboard | ✅ | **Realtime tick not built** |
| 04 Today · route there | ❌ | not built |
| 05 Standings + predictor | ◑ | table+gauge built; **bracket sub-view + champion blocked on §2.B** |
| 06 iOS install | ❌ | not built |
| 07 Film | ◑ | held (§C) |
| 08 Add kid + $20 | ❌ | money held |

12-feature killers: next-game+travel ✅ (rebuilt, PR #150), conflict-radar ✅, schedule-change-alert
❌ (needs the diff engine). High-value + kid/family ❌. Dark theme render-locked; **no light mode** —
boosting contrast within dark. Minor: weather "overcast — overcast" bug to fix.

---

## 4. Recommended forward sequence (foundation-first)

1. **Architect ratifies §1 + §2** (this doc).
2. **Division taxonomy** backfill + ingest fill (§2.A).
3. **Bracket/placement ingest** (§2.B) — the predictor/playoff foundation.
4. **Source/provenance + ingest hardening** (§2.D) so re-scrapes preserve the venue dedup, the new
   division columns, and label non-TM sources — otherwise live re-polls re-introduce drift.
5. **Document the public RPC API** as the tenant contract (§1.3).
6. **Then build the screens** to the renders, one at a time behind the screenshot-diff gate, in spec
   order ([04] Today, [05] standings+bracket, [03] Realtime, then engine+killers, then next wave).

ONE LINE: this is the canonical multi-tenant, multi-source game backbone (the weather-service of
games). Lock source-agnostic schema + stable keys + the RPC contract + division/bracket/season
taxonomy on one indexed Postgres schema, harden the ingest so it stops re-introducing drift, then
build every consumer screen to the render behind the diff gate.
