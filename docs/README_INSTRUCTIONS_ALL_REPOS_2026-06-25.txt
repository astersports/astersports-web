README INSTRUCTIONS — all 5 Aster repos (hand to the build chat / CC)
From: Claude Code · For: Frank to relay · Date: 2026-06-25
Purpose: each repo gets a README.md at its root that says — in plain language — what the
project is, where it lives, what stack it runs on, its current status, and where its docs
are. This is the "front door" so any chat/session/person lands oriented. Copy this whole
file into the build chat; it tells CC exactly what to write per repo.

HOW TO USE THIS (instructions for the build chat / CC):
  1. For EACH repo below, create or overwrite `README.md` at the repo root with the
     "README CONTENT" block given for that repo, verbatim.
  2. Fill the two bracketed spots — [DEV SETUP] and [SCRIPTS] — from that repo's actual
     package.json (do NOT invent commands; read them).
  3. Commit on the repo's working branch, open a draft PR to main, let it merge on green
     (per each repo's auto-merge rule). Docs-only; routine.
  4. Do NOT touch any code — README only.

A NOTE ON THE GOOGLE DRIVE HISTORY (context for the build chat):
  A Drive folder "Aster Platform — Project History" now holds one subfolder per repo
  (+ a "_platform-wide" bucket) where the operator-facing reference docs (audits, specs,
  handoffs, recaps) are mirrored from each repo's docs/. The README's "Docs" section
  points readers at BOTH the repo docs/ (source of truth) and that Drive folder (browse).

════════════════════════════════════════════════════════════════════════
STANDARD README TEMPLATE (the shape every repo follows)
════════════════════════════════════════════════════════════════════════
# <Project name>
> <one-line identity>

**Live:** <url or "n/a"> · **Status:** <live / migrating / queued / library>
**Stack:** <frontend / backend / db / host>

## What this is
<2–4 sentences: who it serves, what it does, how it relates to the platform.>

## Stack & hosting
- Frontend: …
- Backend / DB: …
- Auth / storage / email: …
- Deploy: …

## Develop
[DEV SETUP — fill from package.json: install + run + test commands]
[SCRIPTS — list the real npm/pnpm scripts]

## Docs
Source of truth = `docs/` in this repo. Operator-facing mirror = Google Drive →
"Aster Platform — Project History" → <this repo's folder>. Key docs: <list>.

## Status & next
<2–4 bullets: what's live, what's in flight, what's next, any blocker.>

════════════════════════════════════════════════════════════════════════
REPO 1 — aster-sports  →  README CONTENT
════════════════════════════════════════════════════════════════════════
# Aster Sports
> Multi-tenant SaaS for youth-sports organizations — schedules, RSVPs, rosters, comms,
> payments. Pilot tenant: Legacy Hoopers (Westchester AAU basketball).

**Live:** https://astersports.app · **Status:** LIVE (healthy)
**Stack:** React 19 + Tailwind · Supabase (Postgres/RLS/Edge Functions) · Vercel

## What this is
The platform product. Replaces LeagueApps + spreadsheets + email/text with one mobile-
first app. Multi-tenant (every table org-scoped via RLS). Owned by Olive Juice Inc (DBA
Aster Sports); tenants are separate entities. St Patrick is slated to be tenant context
only for youth-sports — the parish SITE is a separate standalone repo (see st-patricks-armonk).

## Stack & hosting
- Frontend: React 19 + Tailwind CSS 4 + Vite
- DB/Auth: Supabase (Postgres + RLS + Realtime + Storage + Edge Functions); project vrwwpsbfbnveawqwbdmj
- Deploy: Vercel, auto-deploy from `main`; edge functions via deploy-edge-functions.yml
- Secrets: Supabase `app_secrets` (HMAC/cron/JWT); env for the rest

## Develop
[DEV SETUP — fill from package.json]   (known: `npm run lint && npm run build`, `npm test` (vitest))
[SCRIPTS — list from package.json]

## Docs
Source of truth = `docs/` (CLAUDE.md is the operating doctrine). Mirror = Drive →
Aster Platform — Project History → "aster-sports". Key: CLAUDE.md, CC_SESSION_HANDOFF_*,
the 2026-06-25 platform audit set (in astersports-web/docs + _platform-wide).

## Status & next
- LIVE and Manus-independent. The 2026-06-25 audit's routine fixes merged (#1095).
- Held for architect: academy-classification resolver, money-read reconciles, dual
  game_results writer, full DB-hygiene sweep (D5), edge-fn constant-time compare.
- Gate before tenant #2: de-hardcode tenant literals (ADMIN_BCC etc.); ET-anchor dates.

════════════════════════════════════════════════════════════════════════
REPO 2 — astersports-web  →  README CONTENT
════════════════════════════════════════════════════════════════════════
# Aster Sports — Print Studio
> Agency web app: client-side image compression + AI element-detection/editing engine +
> Stripe credit/money-path. (astersports.io)

**Live:** https://astersports.io · **Status:** MIGRATING (Manus → Railway, verify live)
**Stack:** React + tRPC + Drizzle · Postgres (Supabase) · Railway

## What this is
The Print Studio product. Private/proprietary (studio logic + money-path). Was hosted on
Manus/Forge; PR #103 migrated it to Railway + Supabase + Anthropic + Google OAuth. The
migration code is merged to main; whether it is fully deployed + serving on Railway is the
open verify (see Status).

## Stack & hosting
- Frontend: React + tRPC client
- Backend: tRPC + Drizzle ORM
- DB: Postgres on Supabase (was MySQL on Manus/Forge)
- Auth: Google OAuth (own-JWT session). Image AI: Anthropic + Replicate (SAM2/LaMa)
- Deploy: Railway (was Manus auto-publish)
- Secrets: env with validateEnv boot fail-fast

## Develop
[DEV SETUP — fill from package.json]   (known: `pnpm run check` (tsc) + `pnpm run test` (vitest))
[SCRIPTS — list from package.json]

## Docs
Source of truth = `docs/` (CLAUDE.md = operating doctrine; the 2026-06-25 audit set +
master recap + operational gap audit live here). Mirror = Drive → "_platform-wide" +
"astersports-web (Print Studio)".

## Status & next
- #103 off-Manus migration MERGED to main. VERIFY: Railway deploy serving, env/secrets/DB
  set, MySQL→Supabase data migrated, the studioDb.ts money-path CAS port re-proven.
- 30 Dependabot vulns outstanding — triage to 0 criticals/highs before onboarding.
- Print Studio money-path was OUT OF SCOPE of the 2026-06-25 audit (separate lane).

════════════════════════════════════════════════════════════════════════
REPO 3 — st-patricks-armonk  →  README CONTENT
════════════════════════════════════════════════════════════════════════
# St. Patrick in Armonk — Parish Site
> Parish CMS + digital-forms system for St. Patrick's Church, Armonk NY (bulletins, Mass
> schedule, sacrament/CCD forms, homily archive, parish assistant).

**Live:** https://stpatrickinarmonk.org · **Status:** OFF-MANUS REHOST (host TBD)
**Stack (target):** React + Supabase (Postgres + Storage) + Google OAuth + email service · Railway

## What this is
A live client deliverable for the parish. Was 100% on Manus/Forge (host + MySQL + OAuth +
LLM + S3 + notifications); Manus was decommissioned, so it needs an off-Manus rehost. The
architect ruled a STANDALONE rehost on the #103 pattern (NOT a youth-sports tenant). The
digital-forms system (fill → PDF → route-to-recipient → store-then-send for child data) is
the emphasized piece. Forms are BLANK templates (build, not data-rescue).

## Stack & hosting
- Target: React + Supabase (Postgres + Storage) + Google OAuth (staff) + Resend/SendGrid · Railway
- Was: Manus/Forge SDK (server/_core/*) — being replaced
- Secrets: env, never committed

## Develop
[DEV SETUP — fill from package.json]   (has vitest; NO CI workflow yet — add lint+typecheck+test)
[SCRIPTS — list from package.json]

## Docs
Source of truth = `docs/`. Mirror = Drive → "st-patricks-armonk (parish site)". Key:
REHOST_SPEC_FORMS_2026-06-25.txt (the build spec), REHOST_FORMS_RENDERINGS_2026-06-25.html
(parish-identity mockup), DATA_RECOVERY_PLAN_2026-06-25.txt (the Manus-data rescue).

## Status & next
- Manus decommissioned → currently DOWN; security/date/a11y fixes merged to main are
  undeployed until the new host exists.
- BUILD: provision Railway + Supabase + Google OAuth + email key (Frank), then CC builds
  the forms registry + submit pipeline + staff inbox per the spec.
- RESCUE (operator-run, only the time-sensitive remainder): pull the Forge S3 file bucket
  (homily audio / photos / bulletin PDFs / any uploads) + export Droplet.io (CCD) +
  Flocknote (subscribers) while reachable. The form TABLES are blank — no DB-dump needed.
- Add the CI workflow this repo lacks.

════════════════════════════════════════════════════════════════════════
REPO 4 — aster-weather  →  README CONTENT
════════════════════════════════════════════════════════════════════════
# @aster/weather
> Shared weather core for the Aster platform — Open-Meteo fetch/cache, WMO code→icon/label
> mapping, forecast-window helpers, static SVG weather icons. Consumed by the apps.

**Live:** n/a (library) · **Status:** PUBLISHED (v0.1.0; v0.2.0 in progress)
**Stack:** TypeScript package, distributed as a git-tag dependency (dist/ committed)

## What this is
The single source for weather logic, extracted to kill the triplication across St Patrick,
aster-sports, and astersports-web. v0.1.0 froze the primitives; v0.2.0 grows the
composition layer (combined daily-strip composer, React hook, batch enrichment, animated
icons) so all three consumers can drop their local copies.

## Stack & hosting
- TypeScript library; no host. Consumed via git-tag dependency.
- Has CI (lint + typecheck + tests).

## Develop
[DEV SETUP — fill from package.json]
[SCRIPTS — list from package.json]

## Docs
Source of truth = repo. Mirror = Drive → "aster-weather (shared package)". The
convergence plan + v0.2.0 backlog are in the 2026-06-25 platform audit (X2) in _platform-wide.

## Status & next
- v0.1.0 + polish (#1, #2) published. Clean extraction, no P0/P1.
- v0.2.0: composer + React hook (from the app copy) + animated icons (from the parish copy)
  + batch getWeatherForEvents; then refactor consumers one at a time. No 4th copy.

════════════════════════════════════════════════════════════════════════
REPO 5 — legacy-hoopers  →  README CONTENT
════════════════════════════════════════════════════════════════════════
# Legacy Hoopers — Standalone Site (queued rebuild)
> A standalone public site for the Legacy Hoopers AAU program. Currently an unshipped
> prototype; the live LH presence is Squarespace, and LH operational data is served by the
> aster-sports platform.

**Live:** n/a (Squarespace is the live LH site) · **Status:** QUEUED REBUILD (do not ship as-is)
**Stack (prototype):** React + tRPC (was Manus/Forge)

## What this is
An unshipped 2-day Manus prototype that reimplements the Legacy Hoopers tenant (records,
schedules, locations, live scores) as hardcoded/scraped data — redundant with the platform's
DB-backed tenant. Frank's queued WEBSITE REBUILD will start fresh (a thin consumer of the
app's public API, not hardcoded constants/scraper). Salvage only the "Court Noir" design
language as a reference.

## Stack & hosting
- Prototype: React + tRPC on Manus/Forge (can't deploy — Manus gone). No CI.

## Develop
[DEV SETUP — fill from package.json]
[SCRIPTS — list from package.json]

## Docs
Source of truth = repo. Mirror = Drive → "legacy-hoopers (queued rebuild)". Assessment is
in the 2026-06-25 platform audit (P3) in _platform-wide.

## Status & next
- LEAVE as-is this cycle (operator decision). Revisit at the rebuild.
- Rebuild approach: consume the aster-sports public API; never re-hardcode tenant facts.

════════════════════════════════════════════════════════════════════════
END — copy the per-repo blocks into each repo's README.md, fill [DEV SETUP] + [SCRIPTS]
from package.json, commit + PR. Then mirror each repo's key docs into its Drive folder.
════════════════════════════════════════════════════════════════════════
