# Manus Handoff — Print Studio money-path go-live (WORK ORDER)

**Author:** CC lane (audit + surfaces). **Owner of this work:** Manus lane (Stripe
API + studio). **Flips:** Frank only. Baseline: `main` @ current head (re-pin
before each task — `main` is moving).

> This is an exact work order, not a suggestion. Do **only** what is listed.
> Anchor to the named functions; re-pin line numbers against current `main`.

---

## SCOPE — money-path go-live ONLY (do not drift)

This order covers **only** Tasks M1–M3 (reverse-trial subscription, ledger
integrity, Stripe live wiring). It does **NOT** include the Admin / History /
Billing **surface** redesigns. Do not start surface/UX work under this order.

**Surface backlog = separate track (CC lane unless Frank reassigns):**
- **Admin:** `member_spend_rollup` (replace 2 full ledger `GROUP BY` scans/load);
  remove vestigial `isUser`/`isAdmin` (not columns — dead synthetic fields in
  `tenancy.ts` + stale `firmAdmin.ts` comment); member-table paging. *(Shipped:
  #24 individual-account scoping.)*
- **History:** replace `getHistoryStats`' 4× unindexable `LIKE` + ~9 unbounded
  aggregates (denormalize `editType` at job-create + `tenant_stats` rollup —
  **writes in `generate`, money-path-adjacent → Manus or coordinate**); keyset
  paging; FULLTEXT search; fix `topType` combined-job double-count.
- **Billing surface:** hide per-seat **Team** plan for `individual` accounts;
  trim dead credit-model bits (`highRes` unused; `variations` clamped to 1 so
  extra-variation cost is dormant but advertised in `ControlPanel.tsx`) —
  **`shared/billing.ts` is money-path → Manus.**
- **Ledger:** keyset paging. *(Shipped: #24 full-export CSV.)*

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
  `grantCredits(tenant.id, TRIAL_CREDITS, 'grant', \`trial-init-${tenant.id}\`, ctx.user.id)`
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
- 3 draft PRs (M1, M2, M3), each CI-green, each with acceptance criteria +
  verification in the body.
- No `*_LIVE` flag, `STUDIO_MASK_PROVIDER`, or Stripe env value set by Manus.
- `billingClients` / "Web Maintenance" untouched.
- Candidate SHA + exact env values handed to Frank for the flips.

Full context: `docs/STUDIO_GO_LIVE.md`.
