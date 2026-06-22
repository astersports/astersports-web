# Manus Deploy & Publish — Canonical Runbook

The single deploy/publish runbook for the Manus lane. Evergreen process up top;
a short **per-release smoke test** at the bottom (update it as releases ship).
Supersedes the per-PR handoffs (`MANUS_DEPLOY_HANDOFF.md`, `MANUS_DEPLOY_ADMIN_REBUILD.md`).

Stack: a long-running Express server, Manus-hosted, bundled to `dist/index.js`.

## 0. Hard guardrail (non-negotiable)
**Never** set, change, or flip any flag or prod secret during a deploy — specifically
`STUDIO_SCALE_LIVE`, `STUDIO_DENSITY_LIVE`, `STUDIO_DENSITY_REDISTRIBUTE`,
`STUDIO_RECOLOR_LIVE`, `STUDIO_MASK_PROVIDER`, or any money/credit-path secret.
Deploying != flipping. Leave the prod env exactly as it is. Flips are Frank's hand
only, on an Architect-verified SHA after all gates clear (CLAUDE.md §1, Flip Authority).

## 1. Preconditions
- The release PR is **reviewed and merged to `main`**. Publish from `main`.
- **Migrations:** check `git diff <prev-prod-sha>..main -- drizzle/`.
  - Empty -> no `pnpm db:push`.
  - Non-empty -> run migrations (§5). Never run a destructive reset.
  - Baseline: prod should be at least through `drizzle/0011_kind_dakota_north.sql`.
- **Env:** confirm required vars are present (§3); don't add or change anything the
  release didn't introduce.

## 2. Gates (must be green before building)
```bash
pnpm install --frozen-lockfile
pnpm run check     # tsc --noEmit — must pass
pnpm run test      # vitest — must be green (credentialed tests self-skip)
```
Red on either -> **stop and report**; do not deploy.

## 3. Required env (prod refuses to boot without these)
- **Boot-required:** `JWT_SECRET`, `DATABASE_URL`, `OAUTH_SERVER_URL`
- **If `STUDIO_MASK_PROVIDER=sam2`:** `REPLICATE_API_TOKEN` + `REPLICATE_SAM2_MODEL`
  (leave the provider as currently set — do not change it)
- **Warn-only (keep as-is):** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`

## 4. Build & publish
```bash
pnpm run build     # vite (client) + esbuild -> dist/index.js
pnpm run start     # NODE_ENV=production node dist/index.js
```
Server binds `PORT` (default 3000) and **fails hard in prod if the port is taken** —
route the platform to the configured port. Scheduled cron endpoints
(`trial-autocharge`, `trial-reminders`, `log-cleanup`) self-register at boot.

## 5. DB migrations (only if §1 found schema changes)
```bash
pnpm run db:push   # drizzle-kit generate && drizzle-kit migrate
```
Forward only. No destructive resets against prod.

## 6. Smoke test
Always: app loads, sign-in works, a recolor generation completes. Then run the
**per-release checklist** (§8) for the surfaces the release touched.

## 7. Rollback
Revert the release merge commit on `main`, rebuild, republish. Unwind a migration
only if the release added one and it's safe to reverse.

---

## 8. Per-release smoke checklists
Keep only the most recent releases here; prune once a release is well-baked in prod.

### Invite-links hardening (PR #4)
- `/join/:token` **preview before sign-in** renders (public `getByToken`); "Sign in
  to accept" then completes redemption.
- Firm invite: org-name field works; redeem creates the org and routes to
  `/studio/admin`.
- Reusing a single-use / capped link is rejected cleanly; domain-lock + seat-limit
  enforced.

### Multi-org admin rebuild (PR #5)
- **Switcher:** grouped Firms/Individuals, desktop + mobile, persists across reload.
- **Zone A:** all your orgs as cards; Switch/Manage/Billing; search past ~6 orgs.
- **Zone B:** firm admin -> full management · firm member -> "Your access" panel (no
  hard wall) · individual -> account panel (no team UI).
- **Create org:** acknowledgment checkbox required -> creates a firm + trial, you
  become owner. *(Architect-gated feature.)*
- **Platform Console:** stats cards · unified accounts table (search/filter/sort) ·
  Manage drawer (members/spend/ledger/inline grant/impersonate) · ⌘K launchpad ·
  impersonation round-trip + exit banner.

---
> Standing note: Scale ("splits the garment") and Density ("times out") are
> diagnosed-only and are not shipped by any current deploy.
