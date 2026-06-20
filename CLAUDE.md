# CLAUDE.md — Working agreement for AI builders on astersports-web

This file governs how AI agents (CC, Manus, any lane) work in this repo. The
**Flip Authority** section is a hard rule ratified after the 2026-06-20
live-flag incident; treat it as non-negotiable. The rest documents standing
conventions so any lane can pick up work without re-deriving them.

> Draft for Architect sign-off — the Flip Authority clause is transcribed from
> the Architect's incident ruling. If wording needs to change, the Architect
> amends here and that version wins.

---

## 1. Flip Authority (HARD RULE)

A "flip" is any change that moves a feature from dark to live: setting,
changing, or deploying a `*_LIVE` flag, `STUDIO_MASK_PROVIDER`, or any
production secret that moves the **money/credit path**, the **mask provider**,
or a **sub-processor**.

1. **Only Frank flips, and only on an Architect-verified SHA after gates clear.**
   No lane (CC, Manus, any agent) sets/changes/deploys any of the above except
   as Frank's explicit flip.
2. **A flip is a deliberate act, never a side effect.** It is an env change
   Frank makes or directs by name — never a byproduct of a builder checkpoint,
   deploy, or "while I was in there" change.
3. **Builders may PREPARE a flip, never SET it.** Preparing = documenting the
   exact secret, target value, and the SHA it applies to. Setting = forbidden.
4. **Every flip is logged**: flag, old → new value, SHA, who, and the
   gate-clearance reference. One flip per change, smoke-tested, attributable.
5. **Default posture: dark.** Every `*_LIVE` flag ships dark and stays dark
   until the flip ritual. No lane assumes another lane will or won't flip.

Corollary: if you believe a feature is "already dark" or "already live", that is
an **inference** until verified by a production env read (see G0). Do not act on
inferred env state.

---

## 2. Launch Gates (in order)

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
