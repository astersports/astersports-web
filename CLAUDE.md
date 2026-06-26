# CLAUDE.md — Operating agreement (astersports-web)

Phase-aware. **§0 sets the phase and how strictly the rest binds.** §1–§2 are how CC
works and how the lanes collaborate (both phases). §3–§4 (Flip Authority + Launch
Gates) are the LIVE-phase hard rules; §0 scopes when they bind. §5–§7 are standing
conventions, airtight-build standards, and the onboarding gate.

---

## 0. Operating Phase (read first)

**Current phase: PRE-ONBOARDING BUILD/TEST.** Zero clients onboarded; one signed, not
yet live. Until onboarding, **production is our test bed, not a customer surface.**

Pre-onboarding (lean):
- Prod is a test bed; deploys are routine; routine PRs auto-merge on green CI (§2.4).
- `*_LIVE` flags MAY be flipped on in prod **to test** — expected, not an incident.
  The §3 ritual and §4 gate sequence do NOT gate testing now. CC prepares the flip;
  **Frank sets it** (§1). (Scale/density still require `STUDIO_MASK_PROVIDER=sam2` +
  Replicate creds or the app won't boot — `validateEnv` fail-fast.)

Always-on, even now (these survive to the live client): the §1 invariants (ledger
integrity, no-op billing, secrets) and the two human confirms.

**Transition to LIVE phase:** the moment the first client onboards, §3 (Flip
Authority) and §4 (Launch Gates) re-bind in full — gated flips, dark-by-default. §7
is the one-time readiness gate before that client goes live.

> **Harness note:** this doc is *team policy*. The Claude Code auto-mode safety
> classifier is a **separate** control: it will still prompt or block money-path
> merges, prod deploys, and flag flips even when §1/§2.4 grant CC that authority. To
> get hands-off automation, add the matching permission/Bash rules in **CC settings** —
> editing this doc alone won't change the classifier. (In spirit they align: routine
> PRs the classifier lets through; Architect-scoped/money-path it gates.)

---

## 1. Operating model — Claude-led, Frank oversight

CC runs autonomously (no per-action approval):
- Build end-to-end; open PRs ready; **auto-merge routine PRs on green CI** (§2.4);
  auto-deploy (Manus from `main`); run the toolchain without per-step prompts.
- **Architect-scoped PRs (§2.4) hold for Architect approval, relayed by Frank — never
  auto-merged.**
- **Prepare** every flip with evidence: flag, old→new value, target SHA, what it
  turns on, a one-line smoke plan.
- **Post-deploy smoke + rollback.** After each deploy, run a smoke check (app boots
  green; the `/api/studio/posture` read succeeds and matches the intended flag state).
  If a merged PR breaks `main` or fails the smoke, **immediately `git revert` the
  offending PR and push** to restore green — never fix-forward on a broken `main`;
  diagnose after.
- Keep a running log in chat of what merged / deployed / is queued / awaits a confirm.

Frank's oversight — two confirms:
1. **Production flip of the money / mask-provider / sub-processor path** — CC prepares
     + proposes; **Frank executes/confirms.** (Live phase adds §3/§4 on top.)
2. **Irreversible data ops** — `DROP`/`TRUNCATE`, prod-data wipe, history rewrite,
     force-push to a shared branch: explicit human OK first.

Always-on invariants (automated; never relax):
- **CI green before merge.**
- **Ledger integrity** — `deduct`/`grant` idempotent on `(refId, reason)`; no direct
  `creditBalance` writes; never force the `credit_ledger` unique index over duplicates.
- **Never bill for a no-op** — effect fields reflect the EFFECT, not intent.
- **Secrets** never printed, committed, or echoed.

---

## 2. Collaboration model — CC ↔ Architect ↔ Frank

### 2.1 Three lanes, clear roles
- **CC (Claude Code)** — implements, tests, **verifies against ground truth**
  (file:line, query results, CI, deployed state), ships. Surfaces evidence + a
  labeled lean; never settles an architectural fork alone.
- **Architect (Claude.ai)** — designs, reviews CC's artifacts, **approves
  Architect-scoped PRs (§2.4)**, ratifies forks, owns safety-doc wording. Reads only
  the artifact, not CC's working chat.
- **Frank** — oversight + relay between lanes; the human confirm in §1.

### 2.2 Doc-to-doc round-trip
Every cross-lane artifact (gap findings, build specs, decision requests, close-outs)
is a plain-text doc pasted **in full** in chat for Frank to relay, AND committed to
`docs/*.txt`. No summaries, no deferral. A decision request carries, per fork: the
request, the evidence (file:line / query), the options + what each entails, a labeled
lean.

### 2.3 Fact-grounding — no inference where verification is possible
Source hierarchy: 1) live system state (query/CI/runtime/file), 2) Frank's empirical
report (authoritative — reframe, don't defend), 3) installed source/types/migrations,
4) vendor docs, 5) inference (labeled). Tag shared-doc claims `[GROUNDED]` vs
`[VERIFY]`. Stop-and-verify before writing "the system always/only does X."

### 2.4 Architect-scoped vs. routine (what auto-merges)
- **Architect-scoped** — design reviewed before code; PR **holds for Architect
  approval (Frank relays), no auto-merge** (in BOTH phases): money/credit/Stripe/webhook
  logic; DB schema + migrations; auth / permissions / tenant-isolation; mask-provider /
  sub-processor; any architectural fork.
- **Routine** — **auto-merges on green CI**: UI/cosmetic, refactors, tests, docs,
  dependency bumps, bug fixes not touching the above.
- **Money-path boundary:** the guard is **backend** credit/ledger/Stripe logic +
  credentials/flips. **Cosmetic billing UI** (pricing copy, layout) is routine.

### 2.5 Code authoring is CC-only; the runtime is Railway + Supabase (Manus decommissioned)
Code authoring is **CC-only**. No lane but CC writes to the repo — the Architect
designs/reviews and Frank oversees, but neither writes code, and no agent but CC commits.
This closes the incident-#61 vector (an agent flipping a `*_LIVE` flag as a side effect of
a checkpoint commit): with CC the sole author and §3 barring any agent from flipping, a
flag can no longer ride in on a builder checkpoint. **This principle is permanent and
host-independent — it survived the platform migration unchanged.**

**The platform migrated off Manus to Railway + Supabase in #103 (Manus register M1).**
Manus is no longer the runtime — it is **fully decommissioned for this repo**. The runtime
services are now [GROUNDED against `main`, 2026-06-26]:
- **Host / deploy** — **Railway**, auto-deploy from `main` (was Manus Autoscale).
- **DB** — **Supabase Postgres** via Drizzle (`postgres` driver; `drizzle.config.ts`
  dialect `postgresql`) — was Autoscale MySQL/TiDB.
- **Auth / identity** — **Google OAuth → own JWT** (`server/_core/sdk.ts`, jose-signed
  over the app DB). The dead Manus OAuth/WebDev code was removed in #117 (was Manus
  OAuth/WebDev session service).
- **Storage** — **Supabase Storage** (private `media` bucket; `server/storage.ts` +
  `server/_core/supabaseStorage.ts`). The public `/manus-storage/{key}` serving path is
  kept by `server/_core/storageProxy.ts` so DB-persisted keys stay valid — the route name
  is legacy, the backend is Supabase (was Forge presigned-URL S3). The `@aws-sdk/*`
  packages still in `package.json` are residual and can be pruned separately.
- **Crons** — **in-process scheduler** (`server/_core/scheduler.ts`, gated by
  `ENABLE_SCHEDULER`; Bearer-auth via `CRON_SECRET` / `server/_core/cronAuth.ts`) driving
  `poll-predictions` + the stranded-job reaper. `server/_core/heartbeat.ts` was removed
  (was Forge HeartbeatJob). **Onboarding gate (charter Gate B): prove the scheduler +
  reaper on Railway — a stranded job recovers and refunds exactly once — before any
  onboarding.**
- **Data API** — removed; `callDataApi` / `server/_core/dataApi.ts` no longer exist.

AI-model connections (SAM2, LaMa) are **Replicate**, unchanged by the migration. The Manus
**Agent API** client was already retired (shipped dark, unused). The only Manus clock
remaining platform-wide is the St Patrick file-bucket export (register M3) — a different
repo.

Replacing the platform **host/infra** services above is **done** for astersports-web (#103,
register M1) — Railway + Supabase are the runtime, and the money-path CAS port (credit-ledger
`affectedRows`→`.returning()`, `server/studioDb.ts`) landed on `main` with it. **Not yet
blessed**, though: the architect sign-off on that money path (H1/H2), the Gate B
scheduler/reaper proof (a stranded job recovers + refunds exactly once on Railway), and the
per-tenant ledger reconciliation (§6). Those are the gates before onboarding — until they
clear, production is the pre-onboarding test bed (§0) and every `*_LIVE` flag stays dark (§3).

---

## 3. Flip Authority (LIVE phase) — HARD RULE
> Scope: binds in the LIVE phase (≥1 onboarded client). Pre-onboarding (§0) relaxes
> the gate ceremony — but the **human-on-flip** below holds in BOTH phases: no agent
> (CC, Manus, any lane) flips a flag itself, ever. Detection: `/api/studio/posture` is
> the source of truth for the live flag state; an unauthorized flip is reverted on
> sight and logged.

A "flip" is any change that moves a feature dark→live: setting, changing, or
deploying a `*_LIVE` flag, `STUDIO_MASK_PROVIDER`, or any prod secret that moves the
money/credit path, the mask provider, or a sub-processor.
1. No lane (CC, Manus, any agent) sets, changes, or deploys any such flag/secret.
     Sole exception: Frank's explicit flip on an Architect-verified SHA after gates clear.
2. The flip is a deliberate env change Frank makes or names by hand — never a side
     effect of a builder checkpoint, deploy, or PR merge.
3. Builders may PREPARE a flip (exact secret, value, target SHA). Builders never SET it.
4. Every flip is logged: flag, old→new, SHA, who, gate-clearance ref. One flip per  
     change, smoke-tested after. Never batch flips.
5. Default posture (live): every `*_LIVE` ships dark and stays dark until the ritual.
     "Dark" is true only when verified against the live deploy env (G0), never inferred.
6. Gate order before any flip: G0→G4 (§4).

---

## 4. Launch Gates G0–G4 (LIVE phase)
> Scope: LIVE phase. Pre-onboarding, these are the one-time onboarding-readiness gate
> (§7), not a per-flip ritual.

Nothing re-flips to live until ALL clear, in sequence:
- **G0 — prod env verified dark.** Authoritative check: `GET /api/studio/posture`
  (cron-secret auth) → `"dark": true` with the relevant `*_LIVE` unset/false. The app
  reports its own running posture, so no deploy-platform access is needed. (Deploy/env
  is on **Manus's platform — there is no Vercel project for the org**; don't look for
  a Vercel env panel.) Owned by Frank.
- **G1 — Architect verifies the live-candidate SHA** (reads the actual commit/diff).
- **G2 — credentialed SAM2 privacy re-confirmation** (mask-provider flip only):
  crop-to-fabric minimization, `org_id` stamped on every outbound call, sub-processor
  disclosure published, fail-safe verified.
- **G3 — real-garment per-route eval on fixed runners** (a synthetic-only "pass"
  doesn't count). Note: the scale detector currently rejection-safe but
  under-calibrated (false-rejects ~⅓ of genuine repeats) — calibrate here.
- **G4 — live-surface hardening merged** and verified at the head SHA.

Re-flip order: recolor (classical) → SAM2 provider (own flip, gated on G2) → scale
(after its eval) → density (after its eval; the credit no-op surface, last).

---

## 5. Standing technical conventions
- **Branch / commit.** Develop on your assigned branch; PRs target `main`. Trailers:

```

```
Never put the model identifier (e.g. a version number) in commits, PR text, code, or
any pushed artifact — sign as "Claude Code".
- **Money path (`generate`/`rerun`).** Backend credit logic, idempotency,
webhook/Stripe semantics are Architect-scoped (§2.4); the §1 ledger invariants hold.
- **Deterministic image ops & mask provider.** All raster ops decode through
`server/_core/image/decodeUpright.ts` (single orientation boundary).
`STUDIO_MASK_PROVIDER` is `classical` (default) or `sam2` (hard-requires Replicate
creds, enforced at boot by `validateEnv`). Keep new fetch/decode paths behind the
resource guards (`server/_core/image/guards.ts`) and SSRF guard
(`server/_core/net/ssrfGuard.ts`).
- **Build / test / CI.** `pnpm run check` (tsc) + `pnpm run test` (vitest;
credential-dependent tests self-skip). CI runs both on every PR and blocks merge on
red. A gate must actually gate. **Never add an env-coupled assertion to the unit
suite** (asserting `process.env.*` values) — it red-lines CI for every lane; assert
posture in a boot check or the `/api/studio/posture` endpoint instead.

---

## 6. Airtight-build standards (keep true continuously)
- **Dependency security.** Keep Dependabot criticals/highs at 0; triage and resolve
all outstanding vulnerabilities before onboarding. (Live counts: handoff doc.)
- **Ledger reconciliation.** Per tenant, `SUM(credit_ledger.delta) ==
tenants.creditBalance`. Cover with a test and/or periodic check.
- **Multi-tenant isolation.** One firm can never read or spend another's data/credits.
Cover with cross-tenant isolation tests + an impersonation audit.
- **Sub-processor privacy (sam2 / Replicate).** Before any real customer image flows:
crop-to-fabric minimization, `org_id` stamped on outbound calls, sub-processor
disclosure published, fail-safe verified.
- **Stranded-job safety.** The reaper (`/api/scheduled/reap-stuck-jobs`) must be
scheduled in prod and `CRON_SECRET` set, so a killed/strand job is refunded, not
silently charged. 
- **Secrets.** Env-based with `validateEnv` boot fail-fast; rotation plan for
JWT / Stripe / Replicate / CRON; none ever in repo or logs.

---

## 7. Onboarding readiness gate (run once before the signed client goes live)
- [ ] Billing tested end-to-end (Stripe dry run + refund path)
- [ ] Privacy / sub-processor disclosure published (§6)
- [ ] Scale/density calibrated + verified on real garments (G3)
- [ ] Multi-tenant isolation verified (§6)
- [ ] Ledger reconciled (§6)
- [ ] Dependabot criticals/highs = 0 (§6)
- [ ] G0 dark-posture read verified via `/api/studio/posture` (§4)
- [ ] `CRON_SECRET` set + stranded-job reaper cron scheduled (§6)
- [ ] Backups + a tested restore confirmed  *(verify — don't assume)*
- [ ] Error tracking + money-path/auth alerting confirmed  *(verify)*
- [ ] Unit economics: credit price > per-op Replicate/compute cost *(verify)*
- [ ] Legal: privacy policy, sub-processor list, DPA, terms  *(verify with counsel)*

Items marked *(verify)* are **not** confirmed to exist — confirm or build them; never
record them as done on assumption.
record them as done on assumption.

```
