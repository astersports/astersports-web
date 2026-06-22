# CLAUDE.md — Working agreement for AI builders on astersports-web

This file governs how AI agents (CC, Manus, any lane) work in this repo. **Read
§0 Operating Phase first** — it scopes how strict everything else is right now.
The **Flip Authority** (§1) and **Launch Gates** (§2) are the live-phase hard
rules, ratified after the 2026-06-20 live-flag incident; §0 scopes *when* they
bind. The rest documents standing conventions so any lane can pick up work
without re-deriving them.

> The Flip Authority clause is transcribed from the Architect's incident ruling;
> the Architect amends its wording. §0 (operating phase) is Frank's call as owner
> while there are no onboarded clients, and should be ratified by the Architect at
> onboarding.

---

## 0. Operating Phase (read first)

**Current phase: PRE-ONBOARDING BUILD/TEST.** Zero clients are onboarded. One
real client is signed but **not yet onboarded** — onboarding happens only after
the known issues (scale/density quality, etc.) are worked out. Until then
**production is our test environment, not a customer surface**, and §0 scopes how
strict the rest of this doc is right now.

**Lean while pre-onboarding:**
- **Prod is a test bed.** Deploys are routine; PRs merge on green CI. The §2 gate
  sequence and per-change Architect SHA sign-off are **not** required to ship test
  code.
- **`*_LIVE` flags MAY be ON in prod to test them.** `STUDIO_SCALE_LIVE`,
  `STUDIO_DENSITY_LIVE`, `STUDIO_DENSITY_REDISTRIBUTE`, `STUDIO_MASK_PROVIDER=sam2`
  etc. do not have to stay dark now — flipping them on to exercise a feature is
  **expected, not an incident**. (This is the fix for "prod won't let me test
  scale/density.") Note: scale/density still need `sam2` + Replicate creds or the
  app won't boot (`validateEnv` fail-fast).

**Still human-gated, even now** (the part of §1 that does NOT relax):
- A flip stays **Frank's deliberate action** — he sets it, or names the exact
  flag/value for a lane to set. **No agent surprise-flips the money/mask/`*_LIVE`
  path on its own.** That's the 2026-06-20 incident guardrail; it stays. What
  relaxes pre-onboarding is the *ceremony around* the flip (gate order,
  Architect-verified SHA), not the human-gated nature of it.

**Always on — these never relax, because the data survives to the onboarded client:**
- **Billing/ledger integrity.** `deductCredits`/`grantCredits` stay idempotent on
  `(refId, reason)`; never a direct `creditBalance` write; never force the
  `credit_ledger` unique index over duplicate rows.
- **No irreversible data loss** (`DROP`/`TRUNCATE`, prod-data wipes, history
  rewrites, force-push to shared branches) without an explicit human OK.
- **Secrets** are never printed, committed, or echoed. Don't red-line CI for other
  lanes.

**Transition to LIVE phase:** the moment the first real client is **onboarded**,
§1 (Flip Authority) and §2 (Launch Gates) re-bind in full — human-gated flips with
the gate order, money-path sign-off, dark-by-default. **Before** that client goes
live, §2's gates run **once** as the onboarding-readiness checklist (scale/density
calibrated + verified, privacy re-confirmed) — a one-time gate, not a per-flip
ritual during testing.

> Agent auto-merge/auto-deploy is governed by the Claude Code harness permissions
> (auto-mode / settings), configured **separately** — this doc does not grant it.
> To get lean agent automation, set the matching permission rules in CC settings;
> wording here won't change what an agent may do unprompted.

---

## 1. Flip Authority (single authority, env-verified)

> **Scope:** LIVE phase only (≥1 onboarded client). Pre-onboarding, §0 governs — see §0.

> Verbatim from the Architect's 2026-06-20 incident ruling. The Architect amends
> this clause; that version wins.

A "flip" is any change that moves a feature from dark to live: setting,
changing, or deploying a `*_LIVE` flag, `STUDIO_MASK_PROVIDER`, or any
production secret that moves the **money/credit path**, the **mask provider**,
or a **sub-processor**.

1. No lane (CC, Manus, any agent) sets, changes, or deploys any `*_LIVE` flag,
   `STUDIO_MASK_PROVIDER`, or any prod secret that moves the money/credit path,
   the mask provider, or a sub-processor. Sole exception: Frank's explicit flip
   on an Architect-verified SHA after all gates clear.
2. The flip is a deliberate env change Frank makes or names by hand. It is never
   a side effect of a builder checkpoint, deploy, or PR merge.
3. Builders may PREPARE a flip (document the exact secret, value, and target
   SHA). Builders never SET it.
4. Every flip is logged: flag, old to new, SHA, who, gate-clearance ref. One
   flip per change, smoke-tested after. Never batch flips.
5. Default posture: every `*_LIVE` flag ships dark and stays dark until the flip
   ritual. No lane assumes another lane has flipped or will. "Dark" is true only
   when verified against the live deployment env (G0), never inferred.
6. Gate order before any flip: G0 prod env verified dark (Vercel evidence) →
   G1 Architect verifies live-candidate SHA → G2 credentialed SAM2 privacy
   re-confirm → G3 real-garment per-route eval on fixed runners → G4
   live-surface hardening merged and verified. Re-flip sequence: recolor
   (classical) → SAM2 provider (own flip, gated on G2) → scale → density.

---

## 2. Launch Gates (in order)

> **Scope:** LIVE phase only (≥1 onboarded client). Pre-onboarding, §0 governs — see §0.

Nothing re-flips to live until ALL of these clear, in sequence:

- **G0 — prod env verified dark.** A production env read (Vercel) showing the
  relevant `*_LIVE` unset/false and `STUDIO_MASK_PROVIDER` unset/`classical`.
  Owned by Frank, read by the Architect. Env state is a verified claim, not an
  inference. (Added after the incident, where the gate model verified code and
  *assumed* env.)
- **G1 — Architect verifies the live-candidate SHA.** The Architect reads the
  actual commit/diff, not the description.
- **G2 — credentialed SAM2 privacy re-confirmation** (only for the mask-provider
  flip): crop-to-fabric minimization, `org_id` stamped on every outbound call,
  sub-processor disclosure published, fail-safe verified.
- **G3 — real-garment per-route eval on FIXED runners.** Audit H10 found the
  synthetic gate wasn't actually executing (manifest field-name mismatch), so a
  prior "pass" was false. G3 does not count until the runners are fixed AND a
  real-garment eval passes per route.
- **G4 — live-surface hardening merged** (PR #5 cluster, C1 extended to
  `generated/*`), implementation-verified by the Architect at the final head SHA.

### Re-flip order

`recolor` is classical and SAM2-independent → flips first and cleanly. `scale`
and `density` both REQUIRE the SAM2 provider live (they need rasters), so they
are entangled with the provider flip and its privacy gate:

```
recolor (classical)
  → SAM2 provider live (own flip, gated on G2)
    → scale (after its per-route eval)
      → density (after its per-route eval; the credit no-op surface, last)
```

---

## 3. Branch & commit conventions

- Develop on the branch you were assigned; never push to `main` directly and
  never to another lane's branch without explicit permission.
- `git push -u origin <branch>`; on network failure retry up to 4× with
  exponential backoff (2s, 4s, 8s, 16s).
- After pushing, open a **draft** PR if none exists.
- Commit-message trailers (every commit):
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: <session url>
  ```
- Do **not** put the model identifier in commit messages, PR titles/bodies, code
  comments, or any pushed artifact.

---

## 4. Money path (`generate` / `rerun`)

- The credit/money path is GO-gated. Build dark / flag-off; Frank flips it live.
- Never bill for a no-op: `removed`/effect fields must reflect the EFFECT of an
  op, not the intent. A byte-identical result is a fail+refund, not a charge.
- Money-path changes (credit logic, idempotency, webhook/Stripe semantics) are
  Architect-scoped — coordinate, don't patch reactively.

---

## 5. Deterministic image ops & mask provider

- All raster ops decode through `server/_core/image/decodeUpright.ts` — the
  single orientation/coordinate boundary. Add new raster consumers there.
- Mask provider is `STUDIO_MASK_PROVIDER`: `classical` (default, ship-now floor)
  or `sam2` (hosted, gated). Opting into `sam2` hard-requires its Replicate
  creds (enforced at boot by `validateEnv`).
- Resource guards (`server/_core/image/guards.ts`) bound megapixels and decode
  concurrency; the SSRF guard (`server/_core/net/ssrfGuard.ts`) gates outbound
  image fetches. Keep new fetch/decode paths behind them.

---

## 6. Build / test / CI

- `pnpm run check` — TypeScript (`tsc --noEmit`).
- `pnpm run test` — vitest. Credential-dependent tests self-skip when their
  secret is absent (`it.skipIf`), so the suite is green in a clean environment.
- CI (`.github/workflows/ci.yml`) runs both on every PR and blocks merge on red.
- A gate must actually gate: don't add a check that's green for the wrong reason
  (the G3 lesson) or red for reasons orthogonal to the change.
