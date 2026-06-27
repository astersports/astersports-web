# ARCHITECT DECISION REQUEST — Stable game identity (precondition for killer #1)
2026-06-27 · CC → Architect + Frank · grounded against live DB + ingest code

## REQUEST
Decide the STABLE GAME IDENTITY the backbone uses, so a re-ingest reads a moved game as
a MOVE — not delete+create — BEFORE the schedule-change-alert engine (killer #1) is built.
The charter made this an explicit L99 gate ("prove the game key survives a re-ingest before
the diff engine"). Grounding says it does not cleanly survive today.

## CONTEXT / EVIDENCE (grounded)
- Game upsert key = `(tournament_division_id, external_game_id)`
  (unique index `division_games_extkey_unique`, migration 20260626152633_aau_standings_substrate.sql:117;
  upsert `onConflict:"tournament_division_id,external_game_id"` at aau-ingest-tournament/index.ts:376).
- `tournament_division_id` IS stable ✅ (division upserts on (tournament_id, name); tournament matched
  first by stable `tm_id_tournament`).
- `external_game_id` is POSITIONAL ❌ — it's `cells[0]`, the `P#/B#/G#` pool/bracket SLOT label
  (`_parse.ts:271-272`), only **488 distinct values across 5,611 games** (top: P2×284, P1×279). It is
  NOT a durable TM game id. A bracket re-seed or pool renumber → a re-scrape MINTS a new
  `division_games` row and orphans the old one → the diff engine sees delete+new, not a move.
- This is the SAME failure class as the team-tracking bug (which keyed on the volatile
  `tournament_division_teams.id`). Team `resolved_key` is now stable; the game key is not.
- A naive composite `(division + both resolved_keys + date)` is NOT unique: **55 same-day
  division+pairing collisions** (double-headers / same-day rematches) exist in live data.

## OPTIONS
**A. Keep the positional upsert key + add a "fuzzy re-link" pass in the diff engine.**
   The engine, on each re-scrape, matches an apparently-deleted game to an apparently-new one by
   `(division, both resolved_keys)`; a `start_at`/`court` delta = MOVE (the alert), not delete+create.
   Requires: build the re-link matcher in the engine; tie-break same-day rematches by nearest prior
   time. No schema change, no index change. Risk: heuristic; double-header edge cases need a time
   tie-break.
**B. Replace the upsert key with a composite `(division, both resolved_keys, start_at)`.**
   Requires: change the unique index + ingest upsert. Problem: `start_at` CHANGES on a move (the very
   case we're detecting) → re-orphans; and the 55 same-day collisions still need time precision.
   Cleaner-looking but actually re-introduces the instability.
**C. Add a stored `stable_game_key` column** = deterministic hash of `(division, sorted(both
   resolved_keys), event-date-bucket, sequence)`, maintained by the ingest, that the diff engine
   matches on while `start_at`/`court`/`status` are mutable attributes.
   Requires: add column + ingest maintenance + a sequence rule for same-day rematches. Most robust,
   most work.

## CC'S LEAN (committed)
**Option A.** "Move vs new" is fundamentally a diff-engine judgment, not a storage key; resolved_keys
are stable and already load-bearing; it needs no schema/index churn (lowest L99 blast radius on the
identity path). Fold the re-link + the same-day-rematch time tie-break into the §2.D ingest/engine
work, and only escalate to a stored `stable_game_key` (C) if the heuristic proves insufficient under
a real re-seed test. B is a trap — keying on `start_at` re-orphans on the exact event we care about.

## NOT BLOCKING
This gates killer #1 (schedule-change-alert) only. The ratified foundation (division taxonomy —
DONE this session; bracket/placement ingest; source/provenance) proceeds independently.
