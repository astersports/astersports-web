# CLAUDE.md — Operating agreement (astersports-web)

**Phase: PRE-ONBOARDING, Claude-led.** Zero clients onboarded; one signed, not yet
live. Claude Code (CC) does the majority of the work autonomously; the Architect
(Claude.ai) designs + reviews; Frank is oversight + relay and the human confirm on
the few highest-risk actions. This replaces the prior gate-heavy posture (which
assumed live customers) and **re-tightens at onboarding** (§4).

Read order: §0 (how CC operates) → §1 (how the lanes collaborate) → §2–§4 as needed.

---

## 0. Operating model — Claude-led, Frank oversight

### CC runs autonomously (no per-action approval)
- Build end-to-end: design, implement, test, refactor, fix.
- Open PRs **ready**, **auto-merge on green CI**, auto-deploy (Manus from `main`).
- Run the toolchain (git, pnpm, gh/MCP) without per-step prompts.
- **Prepare** every flag/secret flip with full evidence: flag, old→new value,
  target SHA, what it turns on, a one-line smoke plan.
- Keep a running log in chat of what merged / deployed / is queued / awaits a confirm.

### Frank's oversight — the limited checks (two confirms only)
1. **Production flip of the money / mask-provider / sub-processor path** (`*_LIVE`,
   `STUDIO_MASK_PROVIDER`, any prod secret moving credits/billing or a sub-processor).
   CC prepares + proposes; **Frank executes/confirms the flip.** It's the only action
   that can mis-bill a client or expose customer images — rare, and it *is* the
   oversight. CC never sets it unilaterally.
2. **Irreversible data ops** — `DROP`/`TRUNCATE`, prod-data wipe, history rewrite,
   force-push to a shared branch: explicit human OK first.

### Always-on invariants (automated; never relax)
- **CI green before merge** — the two CI checks gate every PR; red blocks.
- **Ledger integrity** — `deduct`/`grant` idempotent on `(refId, reason)`; no direct
  `creditBalance` writes; never force the `credit_ledger` unique index over
  duplicates. (This data survives to the live client.)
- **Never bill for a no-op** — effect fields reflect the EFFECT of an op, not intent;
  a byte-identical result is fail+refund, not a charge.
- **Secrets** are never printed, committed, or echoed.

---

## 1. Collaboration model — CC ↔ Architect ↔ Frank

### 1.1 Three lanes, clear roles
- **CC (Claude Code)** — implements, tests, **verifies against ground truth**
  (file:line, query results, CI, deployed state), ships. Surfaces evidence + a
  labeled lean; never settles an architectural fork alone.
- **Architect (Claude.ai)** — designs, reviews CC's artifacts, ratifies forks, owns
  safety-doc wording. Reads only the artifact, not CC's working chat.
- **Frank** — oversight + relay between lanes; the human confirm in §0.

### 1.2 Doc-to-doc round-trip (no summaries, no deferral)
Every cross-lane artifact (gap findings, build specs, decision requests, close-outs)
is a plain-text doc pasted **in full** in chat for Frank to relay, AND committed to
`docs/*.txt`. Never a summary-instead-of-paste; never "I'll write it next." The doc
IS the deliverable. A decision request carries, per fork: the request, the evidence
(file:line / query result), the options + what each entails, and a labeled lean —
the Architect/Frank decide.

### 1.3 Fact-grounding — no inference where verification is possible
Verify against the closest to ground truth before claiming. Source hierarchy:
1. **Live system state** — DB query, CI, deployed runtime, file read.
2. **Frank's empirical report** — if he says "X is broken / used to work," that's
   authoritative; reframe the model, don't defend the inference.
3. **Installed source / types / migrations** — actual code, not docstrings.
4. **Vendor / tool docs.**
5. **Inference / memory** — only when 1–4 are unreachable, and **labeled** as such.

Stop-and-verify trigger: about to write "the system always/only does X," or Frank
pushes back with an empirical contradiction → verify, or ask the one specific
question that resolves it. Tag claims in shared docs `[GROUNDED]` vs `[VERIFY]`.

---

## 2. Standing technical conventions

- **Branch / commit.** Develop on your assigned branch; PRs target `main`. Commit
  trailers on every commit:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: <session url>
  ```
  Never put the model identifier in commits, PR text, code, or any pushed artifact.
- **Money path (`generate` / `rerun`).** Credit logic, idempotency, webhook/Stripe
  semantics — change deliberately; the §0 ledger invariants hold.
- **Deterministic image ops & mask provider.** All raster ops decode through
  `server/_core/image/decodeUpright.ts` (single orientation boundary).
  `STUDIO_MASK_PROVIDER` is `classical` (default) or `sam2` (hosted; hard-requires
  Replicate creds, enforced at boot by `validateEnv`). Keep new fetch/decode paths
  behind the resource guards (`server/_core/image/guards.ts`) and the SSRF guard
  (`server/_core/net/ssrfGuard.ts`).
- **Build / test / CI.** `pnpm run check` (tsc) and `pnpm run test` (vitest;
  credential-dependent tests self-skip). CI runs both on every PR and blocks merge on
  red. A gate must actually gate — never green for the wrong reason or red for
  reasons orthogonal to the change.

---

## 3. Airtight-build standards (keep these true continuously)

- **Dependency security.** Keep Dependabot **criticals/highs at 0**. (As of
  2026-06-22 the default branch reports 2 critical / 28 high / 48 moderate / 7 low —
  triage before onboarding.)
- **Ledger reconciliation.** Per tenant, `SUM(credit_ledger.delta) ==
  tenants.creditBalance`. Cover with a test and/or a periodic check.
- **Multi-tenant isolation.** One firm can never read or spend another's data/credits.
  Cover with cross-tenant isolation tests + an impersonation audit.
- **Sub-processor privacy (sam2 / Replicate).** Before any real customer image flows:
  crop-to-fabric minimization, `org_id` stamped on outbound calls, sub-processor
  disclosure published, fail-safe verified.
- **Secrets.** Env-based with `validateEnv` boot fail-fast; rotation plan for
  JWT / Stripe / Replicate / CRON; none ever in repo or logs.

---

## 4. Onboarding transition + readiness gate

At the first client onboard, the posture re-tightens: production flips of the
money/mask/sub-processor path get a deliberate gate (prod state verified → the
live-candidate SHA verified → sub-processor privacy confirmed for a mask flip), and
live surfaces ship dark-by-default. Re-flip order when it applies: **recolor
(classical) → sam2 provider → scale → density.** Close incident **#61** (the
unauthorized flip) via the G0 posture read (`/api/studio/posture` → `dark:true`)
before onboarding.

Run this readiness checklist **once** before the signed client goes live:
- [ ] Billing tested end-to-end (Stripe dry run + refund path)
- [ ] Privacy / sub-processor disclosure published (§3)
- [ ] Scale/density calibrated + verified on real garments
- [ ] Multi-tenant isolation verified (§3)
- [ ] Ledger reconciled (§3)
- [ ] Dependabot criticals/highs = 0 (§3)
- [ ] Backups + a tested restore confirmed  *(verify exists — don't assume)*
- [ ] Error tracking + money-path/auth alerting confirmed  *(verify)*
- [ ] Unit economics: credit price > per-op Replicate/compute cost  *(verify)*
- [ ] Legal: privacy policy, sub-processor list, DPA, terms  *(verify with counsel)*

Items marked *(verify)* are **not** yet confirmed to exist — confirm or build them;
never record them as done on assumption.
