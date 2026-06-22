# CLAUDE.md — Operating agreement (astersports-web)

**Phase: PRE-ONBOARDING, Claude-led.** Zero clients onboarded; one signed, not
yet live. Claude (CC) does the majority of the work autonomously; Frank is
oversight on a small set of confirm checkpoints. This replaces the prior
gate-heavy posture (which assumed live customers). It **re-tightens at
onboarding** — see §2.

---

## 0. Operating model — Claude-led, Frank oversight

### Claude runs autonomously (no per-action approval)
- Build end-to-end: design, implement, test, refactor, fix.
- Open PRs **ready**, **auto-merge on green CI**, auto-deploy (Manus from `main`).
- Run the toolchain (git, pnpm, gh/MCP) without per-step prompts.
- **Prepare** every flag/secret flip with full evidence: exact flag, old→new
  value, target SHA, what it turns on, and a one-line smoke plan.
- Keep a running log in chat of what merged / deployed / is queued / is awaiting a
  confirm.

### Frank's oversight — the limited checks (two confirms only)
1. **Production flip of the money / mask-provider / sub-processor path**
   (`*_LIVE`, `STUDIO_MASK_PROVIDER`, any prod secret moving credits/billing or a
   sub-processor). Claude prepares and proposes; **Frank executes/confirms the
   flip.** It's the only action that can mis-bill a client or expose customer
   images, so it stays human — rare, and it *is* the oversight. Claude never sets
   it unilaterally.
2. **Irreversible data ops** — `DROP`/`TRUNCATE`, prod-data wipe, history rewrite,
   force-push to a shared branch: explicit human OK first.

### Always-on invariants (automated; never relax)
- **CI green before merge** — the two CI checks gate every PR; red blocks.
- **Ledger integrity** — `deduct`/`grant` idempotent on `(refId, reason)`; no
  direct `creditBalance` writes; never force the `credit_ledger` unique index over
  duplicates. (This data survives to the live client.)
- **Never bill for a no-op** — effect fields reflect the EFFECT of an op, not the
  intent; a byte-identical result is fail+refund, not a charge.
- **Secrets** are never printed, committed, or echoed.

---

## 1. Standing technical conventions

- **Branch/commit:** develop on your assigned branch; PRs target `main`. Commit
  trailers on every commit:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: <session url>
  ```
  Never put the model identifier in commits, PR text, code, or any pushed artifact.
- **Money path (`generate`/`rerun`):** credit logic, idempotency, webhook/Stripe
  semantics — change deliberately, not reactively; the always-on ledger invariants
  (§0) hold.
- **Deterministic image ops & mask provider:** all raster ops decode through
  `server/_core/image/decodeUpright.ts` (single orientation boundary).
  `STUDIO_MASK_PROVIDER` is `classical` (default) or `sam2` (hosted; hard-requires
  Replicate creds, enforced at boot by `validateEnv`). Keep new fetch/decode paths
  behind the resource guards (`server/_core/image/guards.ts`) and SSRF guard
  (`server/_core/net/ssrfGuard.ts`).
- **Build/test/CI:** `pnpm run check` (tsc) and `pnpm run test` (vitest;
  credential-dependent tests self-skip). CI runs both on every PR and blocks merge
  on red. A gate must actually gate — don't add a check that's green for the wrong
  reason or red for reasons orthogonal to the change.

---

## 2. Onboarding transition (re-tighten)

The moment the first real client onboards, the posture re-tightens: production
flips of the money/mask/sub-processor path get a deliberate gate (verify prod
state → verify the live-candidate SHA → confirm sub-processor privacy for a mask
flip), and live surfaces ship dark-by-default. Run the readiness checklist **once**
before that client goes live: scale/density calibrated + verified, sub-processor
disclosure published, billing/ledger reconciled. The §0 autonomous build model
continues; what changes is that the flip checkpoint becomes a gated, evidenced
event rather than a one-tap confirm.
