# Manus Handoff — Print Studio money-path go-live (WORK ORDER)

**Author:** CC lane (audit + surfaces). **Owner of this work:** Manus lane (Stripe
API + studio). **Flips:** Frank only. Baseline: `main` @ current head (re-pin
before each task — `main` is moving).

> This is an exact work order, not a suggestion. Do **only** what is listed.
> Anchor to the named functions; re-pin line numbers against current `main`.

---

## SCOPE — full studio section (Manus owns end-to-end)

Per Frank (2026-06-21), Manus owns its whole studio section. This order covers
**both** the money-path go-live (M1–M3) **and** the Admin / History / Billing
surface redesigns (M4–M6). Every task follows the same rules: one task = one PR,
anchor to named functions, never flip env, never weaken the credit primitives,
STOP-and-ask rather than improvise.

**Money-path-adjacent tasks** (touch `generate` or `shared/billing.ts` / credit
constants) — handle with money-path care, idempotency intact: **M1, M2, M5a,
M5b, M6b.**

Already shipped (CC lane, merged — do not redo): #24 individual-account Admin
scoping + full-export ledger CSV.

---

## 0. RULES OF ENGAGEMENT — read first, do not deviate

1. **Scope lock.** Touch only the files/functions named in each task. Do **not**
   refactor, rename, reformat, or "improve" anything not named. If a fix seems to
   require touching something not listed → **STOP and ask Frank.** Do not improvise.
2. **One task = one branch = one draft PR.** Never batch tasks into one PR.
3. **Never flip.** Do not set or change any `*_LIVE` flag, `STUDIO_MASK_PROVIDER`,
   or any prod env/secret (incl. live Stripe keys). Those are Frank's by-hand
   action (CLAUDE.md §1). You **prepare + hand Frank the verified SHA**; he flips.
4. **Do not weaken the credit primitives.** `grantCredits` (check-first idempotent
   on `(refId, reason)` + unique index), `deductCredits` (atomic conditional
   `UPDATE … WHERE creditBalance >= amount` under row lock), and the `stripeEvents`
   PK webhook dedupe are correct. Build **on** them; never bypass or alter them.
5. **Do not touch the legacy `billingClients` / "Web Maintenance" path.** Frank
   said keep it untouched. It is separate from Studio.
6. **Green gates.** Before marking any PR ready: `pnpm run check` and
   `pnpm run test` both pass. Put the task's acceptance criteria + how you
   verified in the PR body.
7. **These fixes merge dark.** They only go live when Frank flips Stripe to live
   keys; no per-fix flag is needed. Merging to `main` is safe and expected.

---

## TASK M1 — Reverse-trial must create a recurring subscription
**File:** `server/shadowBilling.ts` (`processTrialAutoCharges`, `convertTrialToPaid`)

**Verified problem:** `processTrialAutoCharges` charges a **one-off PaymentIntent**;
`convertTrialToPaid` sets `plan='starter'` + grants credits but **creates no Stripe
subscription**. Net: the customer is charged once and **never re-billed or
re-credited** — `handleStudioInvoicePaid` (the renewal grant) can never fire.

**Change (implement exactly this contract):**
- On a successful trial conversion, create a **recurring subscription** for the
  tenant: `stripe.subscriptions.create` using the tenant's existing
  `stripeCustomerId` + stored `stripePaymentMethodId` (set as the customer's
  default payment method), on the **same price** the live subscribe flow uses —
  `ensureStudioPrice('Print Studio Starter', 3900, 'month')`. **Reuse that helper;
  do not hardcode a new price id.**
- Set `metadata` on the subscription to exactly: `product: 'print-studio'`,
  `tenantId`, `plan: 'starter'`, `seats: '1'` (so the existing webhook routing +
  `handleStudioInvoicePaid` renewal grants work unchanged).
- **Remove the standalone one-off PaymentIntent** so the subscription's first
  invoice is the single conversion charge. (Creating the subscription with a
  default PM and no trial makes Stripe charge the first invoice immediately
  off-session — that IS the conversion charge.)
- **First-cycle credits:** keep the existing manual
  `grantCredits(tenantId, creditsPerCycle, 'subscription_start', <stable refId>)`
  in `convertTrialToPaid`. The first invoice arrives with
  `billing_reason='subscription_create'`, which `handleStudioInvoicePaid` already
  **skips** — so no double grant. Renewals (`subscription_cycle`) grant via the
  webhook.
- Store the new `stripeSubscriptionId` on the tenant via `updateTenantStripe`.

**Acceptance criteria (the contract — verify each):**
1. After auto-conversion: tenant has non-null `stripeSubscriptionId` and `plan='starter'`.
2. **Exactly one** charge at conversion (no double-charge from PI + first invoice).
3. **Exactly one** first-cycle grant, `reason='subscription_start'`, idempotent on its refId.
4. One cycle later: a renewal `invoice.paid` (`billing_reason='subscription_cycle'`)
   grants the next cycle (`reason='subscription_renewal'`).
5. `cancelTrial` still cancels cleanly against the new subscription.

**Verify:** Stripe test-clock (or documented manual test) for the renewal cycle;
extend `server/shadowBilling.test.ts` to assert conversion creates a subscription
+ a single first grant.

**DO NOT:** weaken grant idempotency; change `deductCredits`; touch `billingClients`.
**If** creating the subscription causes any second charge or any first-grant
duplication in your live setup → **STOP and flag Frank.** The invariant is
*exactly one charge + exactly one first grant.*

---

## TASK M2 — Ledger integrity + close the free-trial mint
**File:** `server/routers/tenants.ts` (`create` mutation → `createTenant`)

**Verified problem:** `tenants.create` sets `creditBalance: TRIAL_CREDITS`
**directly, with no `creditLedger` row**, and it is a `protectedProcedure` any
logged-in user can call → ledger↔balance drift + a free-credit mint once
generation is live.

**Change (implement exactly this contract):**
- Create the tenant with `creditBalance: 0`, then grant the trial credits through
  `grantCredits(tenant.id, TRIAL_CREDITS, 'grant', 'trial-init-' + tenant.id, ctx.user.id)`
  so a ledger row is written. Mirror the working pattern in
  `inviteLinks.redeem` (the firm/individual branches already do this).
- **Bound self-serve creation.** The exact rule is a Frank decision — **STOP and
  confirm before implementing.** Default if Frank says "your call": make
  `tenants.create` invite-only (require a valid invite token) rather than open.

**Acceptance criteria:**
1. Every new tenant's `creditBalance` equals the sum of its `creditLedger` deltas
   (no path sets balance without a ledger row).
2. A single user cannot mint unlimited credited tenants.

**Verify:** add a vitest asserting `create` writes a ledger row and balance==Σdeltas.
**DO NOT:** change `grantCredits` internals.

---

## TASK M3 — Stripe live wiring (prepare; Frank flips the env)
**Files:** `server/stripe.ts`, webhook config (Stripe dashboard) — **prep only.**

**Do:**
- Confirm the live Stripe account has products/prices matching `shared/billing.ts`
  **exactly** (Starter/Pro/Team monthly + the 3 top-up packs: 1k/$15, 5k/$60,
  20k/$200). `ensureStudioPrice` creates on demand, but verify names + amounts.
- Confirm the live webhook endpoint subscribes to exactly: `checkout.session.completed`,
  `invoice.paid`, `customer.subscription.updated`, `customer.subscription.deleted`,
  `invoice.payment_failed`, `setup_intent.succeeded`.
- Run a **test-mode** end-to-end on the candidate SHA: subscribe → webhook →
  credits granted; top-up → webhook → credits granted. Must pass before flip.
- Hand Frank: the candidate SHA + the exact env values to set
  (`STRIPE_SECRET_KEY` live, `STRIPE_WEBHOOK_SECRET` live).

**DO NOT** set those env values yourself (§1 — Frank flips).

---

## TASK M4 — Admin surface
**Files:** `server/routers/firmAdmin.ts` (`spendByMember`), `server/tenancy.ts`,
`client/src/pages/studio/StudioAdmin.tsx`

**M4a — member spend rollup.** `spendByMember` runs **two full `creditLedger`
`GROUP BY userId` scans** (all-time + 7d) on every Admin load. Replace with an
incrementally-maintained or daily-materialized per-`(tenant,user)` rollup so the
Admin tiles are O(1) reads.
- Acceptance: rollup totals **exactly match** a live-scan oracle on a seeded
  large tenant (run on fixed runners); Admin load no longer full-scans the ledger.
- DO NOT change `deductCredits` / `grantCredits`; read/reporting only.

**M4b — role-model cleanup.** Remove the vestigial `isUser` / `isAdmin` — they
are **not** schema columns; they exist only as dead fields on the synthetic
impersonation membership in `tenancy.ts` and as a stale comment on
`firmAdmin.ts` `toggleRole`. Standardize on the single `memberships.role` enum
the code already uses.
- Acceptance: zero `isUser` / `isAdmin` references remain; `toggleRole`'s comment
  matches its code; impersonation still grants owner access; check + test green.

**M4c — members paging.** Add server-side paging + sort to `tenants.members` for
unlimited-seat (Team) tenants.
- Acceptance: members list paginates; no regression for small tenants.

**Verify:** extend `firmAdmin.test.ts`; rollup-vs-oracle eval for M4a.

---

## TASK M5 — History surface  (M5a touches `generate` — money-path care)
**Files:** `server/studioDb.ts` (`getHistoryStats`, `listTenantJobsEnhanced`),
`server/routers/studio.ts` (`generate` / `rerun` → `createJob`),
`client/src/pages/studio/StudioHistoryV2.tsx`, + a drizzle migration.

**M5a — denormalize edit type (kills the LIKE scans).** `getHistoryStats`
computes "Top Edit Type" with **four leading-wildcard `LIKE` scans** over the
`controls` TEXT column (unindexable) and **double-counts combined jobs**. Add a
`studio_jobs.editType` column (or an `editTypes` bool-set) written at job
creation in `createJob`, backfill existing rows, compute topType from it.
- Money-path care: the write is in the `generate` / `rerun` path — keep credit
  deduct / refund / idempotency byte-for-byte unchanged; the column is additive
  metadata only.
- Acceptance: no `LIKE` on `controls` in `getHistoryStats`; backfill covers all
  existing rows; combined jobs bucketed once.

**M5b — `tenant_stats` rollup** for the dashboard tiles (Total / Spent / Success
/ Top-Type) → O(1) reads.
- Acceptance: tiles match a live-scan oracle on a seeded 50k-job tenant.

**M5c — keyset pagination** on the archive (`listTenantJobsEnhanced`): replace
`OFFSET` with `WHERE (createdAt,id) < (?,?) ORDER BY createdAt DESC, id DESC
LIMIT k`.
- Acceptance: stable under concurrent inserts; O(k) at any depth.

**M5d — FULLTEXT search** on `title` / `detectedElements` / `instruction`
(replace the leading-wildcard `LIKE`).
- Acceptance: search uses a FULLTEXT index, not a full scan.

**Verify:** stat-rollup-vs-oracle eval; keyset boundary tests.
**Interim allowed:** if M5a/M5b slip, collapse `getHistoryStats`' ~7 separate
scans into ONE conditional-aggregate query (behavior-preserving) as a stopgap.

---

## TASK M6 — Billing surface  (M6b touches `shared/billing.ts` — money-path care)
**Files:** `client/src/pages/studio/StudioBilling.tsx`, `shared/billing.ts`,
`client/src/components/studio/ControlPanel.tsx`

**M6a — individual accounts don't see Team.** The per-seat **Team** plan is
multi-seat; hide / disable it when `tenant.type === 'individual'`.
- Acceptance: an individual account cannot view or select Team; firm accounts
  unchanged.

**M6b — trim the dead credit-model bits.** `CREDIT_COST.highRes` is **never
read** (not in `computeCredits`), and `variations` is clamped to 1 in `generate`
so the extra-variation cost is dormant while `ControlPanel.tsx` still advertises
"Each additional variation costs N credits." Either wire these for real or
remove / guard them so the UI never advertises a cost the metering can't charge.
- Money-path care: `shared/billing.ts` is the credit source of truth — keep
  `computeCredits` outputs unchanged for the live single / combined cases (10 / 15).
- Acceptance: no dead `CREDIT_COST` field; no UI copy advertising an uncharged
  cost; live credit math unchanged (tests green).

**Verify:** `studio.test.ts` credit math unchanged for active controls.

---

## FLIP SEQUENCE (after M1–M3 merge; Manus prepares SHA, Frank flips)
Per `docs/STUDIO_GO_LIVE.md §3`, in order, one at a time, smoke-test after each:
1. Money path live (`STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` → live) — after M1–M3.
2. `STUDIO_RECOLOR_LIVE=true` (classical; clean first) — gate G0 + G1.
3. `STUDIO_MASK_PROVIDER=sam2` (+ Replicate creds) — **gate G2 SAM2 privacy**.
4. `STUDIO_SCALE_LIVE=true` — gate G3 real-garment eval.
5. `STUDIO_DENSITY_LIVE=true` — gate G3 real-garment eval.
Never batch flips. One flip per change, smoke-test after (CLAUDE.md §1.4).

---

## DEFINITION OF DONE
- One PR per task (M1–M6), each CI-green, each with acceptance criteria +
  verification in the body.
- No `*_LIVE` flag, `STUDIO_MASK_PROVIDER`, or Stripe env value set by Manus.
- `billingClients` / "Web Maintenance" untouched.
- Candidate SHA + exact env values handed to Frank for the flips.

Full context: `docs/STUDIO_GO_LIVE.md`.
