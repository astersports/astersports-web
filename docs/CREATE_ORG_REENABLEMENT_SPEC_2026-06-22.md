# Spec / Architect decision request — Create-org re-enablement (ledger-safe `tenants.create`)

> **Status:** RULED + IMPLEMENTED (dark). Frank ruled all five forks 2026-06-22
> (all leans — see "Rulings" below); the ledger-safe, rate-limited `tenants.create`
> is built **dark** behind `STUDIO_CREATE_ORG_LIVE` (default off) in this PR. The
> flip itself stays Frank's hand per CLAUDE.md §1/§4 (G0 dark-verify + G1 Architect
> SHA verify). The forks + evidence below are retained as the decision record.
>
> **Repo:** `astersports/astersports-web` · **Branch:** `claude/keen-hypatia-65jrof`
> · **`main` HEAD at writing:** `474ea69` · **Date:** 2026-06-22

---

## 0. TL;DR for the Architect

1. **There is a correctness gap in the re-enablement plan as currently written in the
   code.** `CreateOrgDialog.tsx` (header, lines 20-21) says to enable by "(1) re-add a
   ledger-safe, rate-limited `tenants.create`, then (2) wire it here and **flip
   `VITE_CREATE_ORG_LIVE`**." But `VITE_CREATE_ORG_LIVE` is a **build-time client**
   flag (`import.meta.env`, `CreateOrgDialog.tsx:43`). It does **not** gate the tRPC
   endpoint. A live, credit-minting `tenants.create` procedure is a **live money-path
   surface** the moment it exists — callable directly regardless of whether the UI
   button is shown. Per Flip Authority §1, the credit-minting path must ship **dark**
   behind a flip Frank sets by hand. **⇒ Re-enablement requires a SERVER runtime flag
   (`STUDIO_CREATE_ORG_LIVE`, default off), and THAT flag is the governed flip. The
   client `VITE_CREATE_ORG_LIVE` is cosmetic (UI affordance only).** (Fork **F1**.)
2. The ledger-safe construction is **non-controversial** — it already exists. Mirror
   the `inviteLinks.redeem` firm path: `createTenant({ creditBalance: 0, … })` →
   `createMembership(owner)` → `grantCredits(...)`. The M2 bug was bypassing
   `grantCredits` and writing `creditBalance` directly. Using `grantCredits` makes
   balance↔ledger drift **structurally impossible** (it writes both in one tx).
3. **Five forks need a ruling** before I build: F1 server-flag gating (lean: add it),
   F2 rate-limit mechanism (lean: query-based caps, no new table), F3 trial-credit
   semantics (lean: 150 + lifetime cap), F4 cross-op atomicity (lean: parity with
   redeem, don't expand), F5 eligibility (lean: any auth user + caps).

---

## Rulings (2026-06-22, Frank) — all leans, + implementation notes

| Fork | Ruling | Built as |
|---|---|---|
| **F1** server dark gating | Add `STUDIO_CREATE_ORG_LIVE` | `env.ts` flag (default off); `tenants.create` throws `FORBIDDEN` when off; surfaced in `/api/studio/posture` `flags.createOrgLive` + folded into `dark` |
| **F2** rate limits | Lifetime 2 + burst 3/24h, query-based | `countUserOwnedTenants` / `countUserOwnedTenantsSince` in `studioDb.ts`; caps enforced with `>=` (block the 3rd lifetime / 4th in 24h) → `TOO_MANY_REQUESTS` |
| **F3** trial credits | 150 + lifetime cap | `grantCredits(tenant.id, TRIAL_CREDITS, "trial_creation", \`signup-trial-${id}\`, userId)` — never a direct `creditBalance` write |
| **F4** atomicity | Redeem-parity + cleanup | owner membership + grant in a try/catch; `deleteTenantCascade` best-effort on failure; full single-tx refactor stays open item #3 |
| **F5** eligibility | Any auth user + caps | `create` is a plain `protectedProcedure`, gated only by F1 + F2 |

Two reconciliations against the relayed plan, applied: (a) `grantCredits` is
**positional** with a **string** `refId` (not an object / numeric id), so the call
is `grantCredits(id, amount, reason, refId, userId)`; (b) caps use `>=` to enforce
exactly "2" / "3" (a `>` would permit 3 / 4). The posture-endpoint surfacing was
pulled in per Frank's Step 1 (so the create-org flip is G0-verifiable, Flip
Authority §5). Files: `server/_core/env.ts`, `server/routers/tenants.ts`,
`server/studioDb.ts`, `server/routes/studioPosture.ts`,
`client/src/components/studio/admin/CreateOrgDialog.tsx`; tests
`server/tenantsCreate.test.ts`, `server/cronSecret.test.ts`,
`server/routes/studioPosture.test.ts`.

---

## 1. Evidence — what M2 removed and why

`server/routers/tenants.ts:49-55` (the removal tombstone) and the pre-removal code
(`git show 96b1c2b^:server/routers/tenants.ts`) show the old `create`:

```ts
// OLD (removed 2026-06-21, M2 / PR #31):
const tenant = await createTenant({
  name, slug, categoryId: category.id,
  allowedEmailDomain: input.allowedEmailDomain ?? null,
  trialStartedAt: new Date(),
  trialCredits: TRIAL_CREDITS,
  creditBalance: TRIAL_CREDITS,   // ← BUG: sets balance directly, NO grantCredits → NO creditLedger row
});
await createMembership({ tenantId: tenant.id, userId: ctx.user.id, role: "owner", status: "active" });
return tenant;
```

Two defects, both confirmed in code:

- **Balance↔ledger drift.** `creditBalance: TRIAL_CREDITS` sets the balance to 150 but
  never appends a `creditLedger` row. Balance reads 150; `SUM(ledger.delta)` reads 0.
  Every other credit grant in the tree goes through `grantCredits`
  (`studioDb.ts:305-356`), which increments balance **and** inserts the ledger row in
  **one `db.transaction`**, idempotent on `(refId, reason)`.
- **Open-procedure trial-credit farming.** It was a bare `protectedProcedure` (any
  authenticated user) with **no rate limit** — call it N times, mint 150·N credits.
  There is **no existing rate-limit infrastructure** in the server (grep: the only
  `rate-limit` hits are the Manus API client's own backoff + docs).

## 2. The ledger-safe pattern already exists (the model to mirror)

`inviteLinks.redeem` firm path (`server/routers/inviteLinks.ts:338-375`) is the
correct construction and is **shipped + green**:

```ts
const tenant = await createTenant({
  name: firmName, slug: `${slug}-${Date.now().toString(36)}`,
  categoryId: category.id, type: "firm", plan: "none", seats: 5,
  creditBalance: 0,                          // ← balance starts at 0
  trialStartedAt: new Date(), trialCredits: TRIAL_CREDITS,
});
await createMembership({ tenantId: tenant.id, userId: ctx.user.id, role: "owner", status: "active" });
await grantCredits(tenant.id, credits, "grant", undefined, ctx.user.id);  // ← balance + ledger, atomic
```

Re-enabled `tenants.create` = this sequence, triggered self-serve (not via a link
token), **+ a rate-limit gate + a server dark-flag gate.**

## 3. Open forks (each needs a ruling)

### F1 — Server-side dark gating *(this is the Flip-Authority correctness item from §0.1)*
- **Option A (LEAN):** Add `studioCreateOrgLive: process.env.STUDIO_CREATE_ORG_LIVE === "true"`
  to `server/_core/env.ts` (default off — identical pattern to `studioScaleLive`,
  `env.ts:41`). `tenants.create` throws `TRPCError({ code: "FORBIDDEN" })` (or
  `PRECONDITION_FAILED`) when the flag is off. **Setting `STUDIO_CREATE_ORG_LIVE=true`
  is the single Flip-Authority-governed flip.** `VITE_CREATE_ORG_LIVE` remains the
  cosmetic client gate (enables the dialog button). Optionally surface
  `createOrgLive` in `/api/studio/posture` so G0 can see it.
- **Option B (rejected):** Gate on the client flag only, ship the server procedure
  live. ✗ Violates Flip Authority — a live credit-minting endpoint behind a
  build-time cosmetic flag; directly callable. Shown only to document why the
  dialog header's current "flip `VITE_CREATE_ORG_LIVE`" instruction is insufficient.
- **LEAN: A.** (Effectively required for §1 compliance, not a true coin-flip.)

### F2 — Rate-limit mechanism + limits (no existing infra)
- **Option A (LEAN):** Query-based, **no new table**, enforced inside the procedure:
  - **Lifetime cap** on self-serve **trial-credited** orgs per user (proposed **2**) —
    directly bounds the farming vector. Count tenants where the user is `owner` (join
    `memberships` role=owner ↔ `tenants`) created via self-serve.
  - **Burst cap** (proposed **≤ 3 creates / rolling 24h**) — counts owner-memberships
    on tenants with `createdAt` in the window. Catches double-submits + abuse bursts.
  - Reject over-cap with a kind `TOO_MANY_REQUESTS` / `BAD_REQUEST` + actionable copy.
- **Option B:** Dedicated `rate_limits(userId, action, windowStart, count)` table —
  reusable + precise, but a **new migration + infra** for one dark, single-pilot
  feature (over-build vs. the "don't build infra you don't need yet" posture).
- **LEAN: A** (query-based lifetime + burst caps). Exact numbers are Frank's product
  call; proposed lifetime **2**, burst **3 / 24h**. (Distinguishing "self-serve" from
  invite-provisioned orgs: simplest is to count *all* owner orgs created by the user;
  if invite-firm owners should be exempt from the cap, we need a marker column —
  flagging as a sub-decision.)

### F3 — Trial-credit semantics for self-serve
- **Option A (LEAN):** Same as invite-firm — grant `TRIAL_CREDITS` (150) via
  `grantCredits`, `type: "firm"`, `trialStartedAt = now`. Parity, simplest, matches
  the dialog copy ("starts its own free trial"). **Bounded by F2's lifetime cap** →
  max mintable per user = 2 × 150 = 300.
- **Option B:** Self-serve grants **0** trial credits (trial only via invite or
  payment). Removes the money-path risk **entirely** — arguably demotes this from a
  "flip" to a normal feature. But it guts the self-serve-trial UX the dialog promises.
- **Option C:** Smaller self-serve trial (e.g. 50, the individual amount).
- **LEAN: A**, *paired with F2's cap*. Honest tradeoff: **B is the zero-money-path-risk
  position** — if the Architect wants this to not be a money-path flip at all, B is the
  truer choice and I'd build that instead. A is a deliberate product lean (preserve the
  free-trial hook), not a hedge.

### F4 — Cross-op atomicity (ties to open carry-forward #3)
`createTenant` + `createMembership` + `grantCredits` are three ops. `grantCredits` is
internally atomic, so **no balance↔ledger drift is possible** regardless. Worst case
from a mid-sequence failure is an **orphan/under-provisioned tenant** (tenant with no
owner, or owner with 0 credits) — **never phantom credits.**
- **Option A (LEAN):** Accept **parity** with the shipped `inviteLinks.redeem` path,
  which lives with the exact same gap (documented Architect-scoped + out-of-scope at
  `inviteLinks.ts:481-489`). Add **best-effort orphan cleanup** (if membership/grant
  throws after `createTenant`, attempt to delete the just-created tenant; log loudly
  for reconciliation) + an idempotent grant `refId` (`signup-trial-<tenantId>`) so a
  retry never double-grants.
- **Option B:** Full single-tx refactor now (thread one tx handle through
  create/membership/grant). Also closes open item #3 — but it edits the **shared**
  `grantCredits` primitive (blast radius = every credit path) → its own Architect-scoped
  change, not a rider on this one.
- **LEAN: A** (parity + best-effort cleanup + idempotent refId). Keep B as its own PR.

### F5 — Eligibility (who may self-serve create)
- **Option A (LEAN):** Any authenticated user, subject to F2 caps. Matches original
  intent + the dialog's placement (org-switcher footer / Zone A CTA).
- **Option B:** First-org-only self-serve (users with 0 owned orgs); additional orgs
  via invite/admin. Tighter farming bound, but limits a legit "I run two firms" user.
- **LEAN: A** (any auth user + F2 caps).

## 4. Build shape once ruled (default = all leans)

**Server** (`server/routers/tenants.ts`, `server/_core/env.ts`):
- `env.ts`: add `studioCreateOrgLive` (F1-A). Optional: `validateEnv` note (no
  co-requirement — create-org doesn't need SAM2/Stripe; a dark→live flip just enables
  the procedure).
- `tenants.create` = `protectedProcedure` that: (a) throws if `!ENV.studioCreateOrgLive`;
  (b) runs the F2 rate-limit checks; (c) `ensureCategory("Default","default")`; (d)
  `createTenant({ type:"firm", plan:"none", seats:5, creditBalance:0, trialStartedAt:now,
  trialCredits:TRIAL_CREDITS, slug:`${slug}-${Date.now().toString(36)}` })`; (e)
  `createMembership(owner)`; (f) `grantCredits(tenant.id, TRIAL_CREDITS, "grant",
  `signup-trial-${tenant.id}`, ctx.user.id)`; (g) best-effort orphan cleanup on failure
  (F4-A). Input: `{ name: z.string().trim().min(1).max(255) }` (slug derived server-side,
  mirroring redeem — don't trust a client slug).

**Client** (`client/src/components/studio/admin/CreateOrgDialog.tsx`):
- Replace the guarded-no-op `submit()` (lines 61-71) with
  `trpc.tenants.create.useMutation()`; on success invalidate `utils.tenants.overview`
  + `utils.tenants.myTenants`, call `onCreated(tenantId)`, toast success; on error
  `toast.error(err.message)`. Keep the confirm checkbox + the `CREATE_ORG_LIVE` UI gate.

**Tests** (`pnpm check` + `pnpm test` green; mirror existing style):
- Ledger-safety: after create, assert a `creditLedger` row exists with `delta=150` and
  `balanceAfter=150` (the regression guard for the M2 drift bug).
- Flag-off: `tenants.create` throws when `STUDIO_CREATE_ORG_LIVE` unset (the dark proof).
- Rate-limit: N+1th create within the window/lifetime throws.
- Idempotent grant: a retried grant for the same tenant is a no-op (no double-credit).

## 5. Flip preparation (PREPARE, do NOT SET — Flip Authority §1.3)

| Field | Value |
|---|---|
| **Governed flip (money-path)** | `STUDIO_CREATE_ORG_LIVE` : unset/`false` → `true` (server runtime env) |
| Cosmetic UI env (not a governed flip) | `VITE_CREATE_ORG_LIVE` : unset/`false` → `true` (client build env; set in the same deploy) |
| Target SHA | the merge SHA of the create-org **implementation** PR (not this doc PR) — Architect verifies at G1 |
| Who | Frank, by hand |
| Gate ref | G0 prod-dark confirmed (incident #61) + G1 Architect SHA verify; G2-G4 are mask/raster gates and **do not apply** (create-org is classical, no SAM2/raster) |
| Log | flag, old→new, SHA, who, gate-clearance ref — one entry, smoke-test create+ledger after |

**Note:** only `STUDIO_CREATE_ORG_LIVE` is a Flip-Authority-governed flip (it enables
credit minting). `VITE_CREATE_ORG_LIVE` is cosmetic and may be set in the same deploy;
it is not itself a money/mask/sub-processor flip.

## 6. Out of scope
- The full single-tx provisioning refactor (F4-B / open carry-forward #3) — separate
  Architect-scoped PR touching the shared `grantCredits` primitive.
- Any change to `grantCredits` / trial / Stripe semantics — used as-is (§4).
- Individual (1-seat) self-serve creation — this spec is firm-type self-serve only
  (matches the dialog). Individual self-serve, if wanted, is a follow-up.
