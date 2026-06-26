# Aster Sports — Web (Hub · Print Studio · Portals)

The astersports.io hub: the marketing/landing surface, the **Print Studio** (AI-assisted
apparel print design — recolor, density, scale), and the org/AAU portals. Separate from
the `aster-sports` SaaS app (astersports.app).

**Live:** https://astersports.io
**Host:** Railway (migrated off Manus 2026-06 — PR #103) · **DB/Auth:** Supabase (Postgres + Auth via Google OAuth)
**Owner:** Olive Juice Inc (DBA Aster Sports)
**Status:** PRE-ONBOARDING build/test — one client signed (Jaya, B2B apparel), not yet
live. Production is a test bed (see `CLAUDE.md` §0).

> Platform canon: STRUCTURE.md (canonical home moving to a neutral org repo — charter Q6).
> Operating agreement: [`CLAUDE.md`](./CLAUDE.md).

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 19 · Tailwind CSS 4 · Vite 7 · Wouter |
| Server | Express 4 · tRPC 11 (tsx dev / esbuild bundle) |
| DB | Supabase **Postgres** via Drizzle ORM (`postgres` driver) |
| Auth | Google OAuth → own JWT (post-#103) |
| Payments | Stripe |
| AI image | Replicate — SAM2 (mask/count) + LaMa (inpaint finish) |
| Storage | Supabase Storage (private `media` bucket; served via the `/manus-storage/{key}` proxy route) |
| Email | Resend |
| Shared | `@aster/weather` (git-tag dep) |

> Storage note: `server/storage.ts` was migrated from the Manus Forge presigned-URL/S3 path
> to Supabase Storage in #103. The public serving path `/manus-storage/{key}` is kept on
> purpose (existing DB-persisted keys stay valid); the bucket itself is never public — the
> proxy 307-redirects to a short-lived signed URL after a tenant-isolation auth check. The
> `@aws-sdk/*` packages still in `package.json` are residual from the old path.

## Quickstart

```bash
git clone git@github.com:astersports/astersports-web.git
cd astersports-web
pnpm install
cp .env.example .env   # see Env below — file may need to be created
pnpm dev               # tsx watch server/_core/index.ts
```

## Env

Names below are from the server env validation (`server/_core/env.ts`). Required set
depends on which surfaces you exercise locally.

**Core**
- `DATABASE_URL` — Supabase connection. **Must use the SESSION pooler (port 5432) or a
  direct connection — NOT the transaction pooler (6543).** The Railway server is persistent
  and `postgres-js` uses prepared statements, which PgBouncer's transaction pooler breaks.
  (Charter Gate A.)
- `JWT_SECRET`, `PUBLIC_BASE_URL`, `PORT`, `NODE_ENV`
- `CRON_SECRET` + `ENABLE_SCHEDULER` — the in-process scheduler/reaper (stranded-job refunds).

**Supabase** — `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`

**Auth (Google OAuth)** — `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OAUTH_SERVER_URL`,
`OAUTH_ALLOWED_REDIRECT_HOSTS`, `OWNER_OPEN_ID`

**Payments** — `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`

**AI / sub-processors** — `REPLICATE_API_TOKEN`, `REPLICATE_SAM2_MODEL`,
`REPLICATE_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`

**Email** — `RESEND_API_KEY`

**Studio** — `STUDIO_MASK_PROVIDER` (`classical` default, or `sam2` — hard-requires Replicate
creds, `validateEnv` fail-fast at boot) plus the `STUDIO_*` tuning/flag vars and the dark
`*_LIVE` feature flags (see `CLAUDE.md` §3–§4 — flips are Frank-only).

**Client** — `VITE_APP_ID`, `VITE_APP_URL`

## Scripts (from package.json)

```bash
pnpm dev      # dev server (tsx watch)
pnpm build    # vite build + esbuild server bundle → dist/
pnpm start    # NODE_ENV=production node dist/index.js
pnpm check    # tsc --noEmit
pnpm test     # vitest run (credential-dependent tests self-skip)
pnpm format   # prettier --write .
pnpm eval     # synthetic scale/density eval harness (eval/run.ts all)
pnpm db:push  # drizzle-kit generate && migrate
```

## Workflow

Feature branch off `main`, **descriptive name, one concern per branch** (charter
discipline). Routine PRs auto-merge on green CI. **Money / auth / schema / RLS /
mask-provider PRs HOLD for architect review** — open as draft and stop (`CLAUDE.md` §2.4).
No agent flips a `*_LIVE` flag — Frank flips (§3).

## Where things live

| | |
|---|---|
| Operating agreement | [`CLAUDE.md`](./CLAUDE.md) — phases, flip authority, launch gates |
| Print Studio image core | `server/_core/image/` (decode/guards/SSRF) |
| Storage helpers | `server/storage.ts` + `server/_core/supabaseStorage.ts` + `server/_core/storageProxy.ts` |
| Density/scale eval | `eval/` |
| Server (tRPC/routers) | `server/` |
| Client | `client/` |
| Migration scope + Railway notes | `docs/` |
