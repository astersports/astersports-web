# Studio Go-Live Packet

**Status:** preparation only. This doc is the handoff for taking Print Studio
live. Per CLAUDE.md §1 (Flip Authority) the **flips are Frank's** by-hand env
action; the **Stripe API + studio section are the Manus lane**. CC (this lane)
prepares + reviews; it does not flip and does not edit the Stripe integration.

Baseline at writing: `main` @ `4a7ca38`. Re-pin before acting.

---

## 1. Ownership map (who does what for go-live)

| Concern | Owner |
|---|---|
| `*_LIVE` flags, `STUDIO_MASK_PROVIDER`, prod env/secrets (the flips) | **Frank** (by hand, §1) |
| Stripe API integration (`shadowBilling`, `webhook`, `studioBilling`, `stripe.ts`), money-path code | **Manus lane** |
| astersports.io + studio section | **Manus lane** |
| SAM2 privacy gate (G2) sign-off | Architect + Frank |
| Surface/UX redesign PRs, audit, this packet | **CC lane** (reviewable PRs, auto-merged when green) |

Live Stripe = the `aster sports` account under frank@astersports.co → **real money**, not test.

---

## 2. Pre-flight: money-path bugs to fix BEFORE money goes live

Route to the Manus lane (Stripe owner). These must not go live as-is:

1. **Reverse-trial bills once.** `shadowBilling.ts` (`processTrialAutoCharges` →
   `convertTrialToPaid`) charges a one-off PaymentIntent and sets
   `plan='starter'` but **creates no Stripe subscription**. The customer is
   charged once, gets one credit grant, then **never re-bills or re-credits**
   (the `handleStudioInvoicePaid` renewal path can't fire with no subscription).
   Fix: create a real recurring subscription on conversion.
2. **Free-credit / ledger gap.** `tenants.create` sets `creditBalance` directly
   with **no `creditLedger` row**, and any authenticated user can mint trial
   tenants → free-credit abuse once generation is live, plus ledger↔balance
   drift. Fix: route all balance changes through `grantCredits`; gate/limit
   self-serve tenant creation.
3. **Stripe test-mode in prod.** Going live requires switching to live keys
   (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) — step 1 below.

---

## 3. Go-live flip sequence (Frank executes, in order)

`recolor` is classical (no sub-processor) → flips first and cleanly. `scale`
and `density` REQUIRE the SAM2 provider (rasters) → gated on the privacy gate.

| # | Flip (env change) | Gate that must clear first |
|---|---|---|
| 1 | Money path: `STRIPE_SECRET_KEY`→live, `STRIPE_WEBHOOK_SECRET`→live | §2 bugs fixed; webhook smoke-tested |
| 2 | `STUDIO_RECOLOR_LIVE=true` (classical) | G0 env-dark verified, G1 SHA verified |
| 3 | `STUDIO_MASK_PROVIDER=sam2` (+ Replicate creds) | **G2** SAM2 privacy: crop-to-fabric, `org_id` stamped, sub-processor disclosure published, fail-safe verified |
| 4 | `STUDIO_SCALE_LIVE=true` | G3 real-garment per-route eval on fixed runners |
| 5 | `STUDIO_DENSITY_LIVE=true` (or `STUDIO_DENSITY_REDISTRIBUTE`) | G3 real-garment per-route eval |

One flip per change, smoke-tested after. Never batch (§1.4).

### Gate definitions (CLAUDE.md §2)
- **G0** prod env verified dark (Vercel read) — owned by Frank.
- **G1** Architect verifies the live-candidate SHA (reads the diff).
- **G2** credentialed SAM2 privacy re-confirmation (mask-provider flip only).
- **G3** real-garment per-route eval on FIXED runners (the synthetic gate was
  found not executing — a prior pass was false).
- **G4** live-surface hardening merged + verified at head SHA.

---

## 4. Recommended doctrine note (for Frank/Architect to ratify)

Frank directed go-live with Studio at zero users. To unblock the Manus lane's
money-path fixes without per-change Architect round-trips while still protecting
the post-launch state, consider adding to §4:

> **Pre-launch carve-out.** While Studio has zero live users/transactions,
> money-path *code* changes may be built + merged under the owner's direction
> without per-change Architect coordination. Reverts automatically on the first
> live user/transaction. Does **not** relax §1: any `*_LIVE` /
> `STUDIO_MASK_PROVIDER` / sub-processor flip remains Frank's by-hand action.

This is a recommendation, not an applied change — §1/§4 are Architect-owned.

---

## 5. Shipped already (CC lane)

- **PR #24** (`4a7ca38`) — individual-account scoping (no org chrome on
  single-seat accounts) + full-filtered-set CSV export on the credit ledger.
  Pure client/read-only; no flag, no money-path.
