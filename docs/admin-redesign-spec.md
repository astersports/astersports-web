# Print Studio — Admin Surface: Deep-Dive Audit & Execution Spec

**Role/posture:** software architect, **read-only / spec-only**. Nothing in this document has been pushed to `main`, no flag flipped, no money-path file edited. This is a reviewable spec produced *before* any code is written.

**Baseline (re-pinned):** repo `astersports/astersports-web`, default-branch HEAD observed moving during this audit (`1d484fb` → `533b36d`; Manus commits continuously). **All blobs below are SHA-pinned to the version actually read**, under tree `533b36d`. Re-baseline before acting.

**Tags used throughout:** **[V]** verified in source · **[I]** inference · **[R]** recommendation.

**Files read this pass (SHA-pinned):**
- `CLAUDE.md` @ `e2590fb` · `drizzle/schema.ts` @ `3b69395` · `server/studioDb.ts` @ `ca6f39a` · `server/routers/firmAdmin.ts` @ `35a9af7` · directory trees of `drizzle/`, `server/`, `server/routers/` @ `533b36d`.
- **Not yet read line-by-line (flagged where it matters):** `server/routers/studio.ts` (33KB), `server/routers/studioBilling.ts`, `server/billing.ts`, `server/webhook.ts`, `server/shadowBilling.ts`, `server/stripe.ts`, `server/tenancy.ts`, `server/trialReminders.ts`, `server/logRetention.ts`, all `client/**`, and prior-lane docs (`code-audit-report.md`, `notes-admin-analysis.md`, `todo.md`, `ideas.md`). Claims that would depend on these are marked **[I]** or "to confirm."

> **Independent verification note (architect lane, on `origin/main`):** the load-bearing **[V]** claims below were spot-checked against source and all held — `studioDb.ts:598` (non-sargable CAST/REPLACE ledger→jobs join), `studioDb.ts:460/464/468/472` (4× leading-wildcard `LIKE` on `controls`), `studioDb.ts:252` (`userId ?? null`), `schema.ts:182` (nullable `creditLedger.userId`) vs `:213` (notNull `jobs.userId`), trial fields `schema.ts:131/139/145/147` + `analyzeTrialUsage()` `studioDb.ts:671`, `firmAdmin.ts:34/49` group-by + `:67` null-drop, last migration `0011_kind_dakota_north.sql`. **Caveat:** `origin/main` still carries BOTH `0008_credit_ledger_idempotency.sql` (orphan) and `0008_superb_black_queen.sql` — the duplicate-`0008` collision is unresolved; any `0012+` work must be `drizzle-kit`-generated/journaled and reconcile that orphan.

---

## 0. Governance findings from `CLAUDE.md` (read first, as instructed)

1. **[V] Flip Authority is a hard rule** (post-2026-06-20 incident). No lane sets/changes/deploys any `*_LIVE` flag, `STUDIO_MASK_PROVIDER`, or money/credit/mask/sub-processor secret — only Frank flips, on an Architect-verified SHA, after gates **G0–G4**. This spec only ever **prepares** flips (documents secret/value/target SHA); it never sets them.
2. **[V] Money-path is Architect-scoped.** Credit logic, idempotency, webhook/Stripe semantics: "coordinate, don't patch reactively." Every money-path change in this spec is marked **`TODO(architect)` and is NOT implemented.**
3. **[V] Commit-trailer contradiction — flagged for Architect.** §3 says add a `Co-Authored-By: <model>` trailer, then says *"Do not put the model identifier in commit messages, PR titles/bodies, code comments, or any pushed artifact."* These conflict. Resolution applied: follow the **specific privacy prohibition** (no model identifier in any pushed artifact); use a neutral co-author trailer. The doc is marked "Draft for Architect sign-off" — **Architect should amend §3 to remove the contradiction.**
4. **[V→limit] G0 ("prod env verified dark") requires a Vercel env read.** This lane has GitHub + web, **not Vercel**. Every env/G0 claim here is **"unverifiable by this lane → owner/Architect to confirm,"** never inferred. Code is verifiable; live env state is not.

---

## PART A — Deep-dive audit (SHA-pinned)

### A0. Data model — the spine

`drizzle/schema.ts` @ `3b69395`. Tenancy + billing tables:

| table | role | key columns |
|---|---|---|
| `users` | identity (Manus OAuth `openId`) | `id`, `openId`, `role` (user/admin) |
| `tenants` | **billed tenant + workspace, fused** | `type` (firm/individual), `plan`, `creditBalance`, `seats`, `allowedEmailDomain`, `stripeCustomerId`, `stripeSubscriptionId`, `stripeSetupIntentId`, `stripePaymentMethodId`, trial fields |
| `memberships` | membership (scope+role) | `tenantId`, `userId`, `role` (owner/admin/member), `status` |
| `creditLedger` | append-only wallet ledger | `tenantId`, `userId` (**nullable**), `delta`, `balanceAfter`, `reason`, `refId`, unique `(refId, reason)` |
| `jobs` (`studio_jobs`) | generation/edit jobs | `tenantId`, `userId`, `status`, `creditsUsed`, `controls` (JSON text) |
| `jobVariations` | per-round result images | `jobId`, `tenantId` |
| `stripeEvents` | webhook idempotency | `id` PK |
| `inviteLinks` / `inviteLinkRedemptions` | join/firm/individual links | `token`, `type`, `metadata`, `maxUses` |
| `platformAdmins` | super-admins above tenants | `userId` |
| `categories` | taxonomy grouping of tenants | `name`, `slug` |
| `billingClients` | **legacy/parallel** Stripe table | `stripeCustomerId` — **not wired to `tenants`** |

**Critical structural findings:**

- **[V] Billing is fused onto `tenants`.** Plan, credit pool, and all Stripe ids live directly on the tenant row. There is **no `billing_account` table** and **no `org` table.**
- **[V] The workspace IS already the sole billed entity** (answers the verify-first brief directly): card/subscription/pool all bind to `tenants`. Shipped behavior already matches the locked billing model (Part C) — good.
- **[V] Stamping rule is only partially satisfied:** `jobs` carries `tenantId`+`userId` (both `notNull`) ✅; `creditLedger.userId` is **nullable** and `grantCredits` writes `userId ?? null` (`studioDb.ts` @ `ca6f39a`) — so **system grants (subscription/topup) are not attributable to a user** ❌; **no table carries `org_id`** ❌.
- **[V] Permission model is a single `memberships.role` enum** (owner/admin/member), tenant-scoped. No `scope` dimension, no `billing`/`viewer` roles → the `(scope, role)` 5-role model is **net-new**.
- **[V] Two Stripe-customer surfaces coexist:** `tenants.stripeCustomerId` (live path) and the older `billingClients` table (example data "St. Patrick's Church"). **[I]** `billingClients` looks legacy/dead relative to Print Studio. **[R]** Architect to confirm and schedule removal or document why it stays — two customer tables is a reconciliation hazard.
- **[V] Leftover template tables** `games` + `scraperCache` (AAU basketball) remain in schema — dead weight, not Print Studio. **[R]** confirm + drop in a cleanup migration.
- **[V] Trial system already exists in-schema and in code** (`trialStartedAt`, `stripeSetupIntentId` → Day-7 auto-charge, `trialConvertedAt`, `trialFrozenCredits` + 90-day freeze; `getTrialStatus`/`analyzeTrialUsage` in `studioDb.ts`; `TRIAL_DURATION_DAYS` from `shared/billing`). **This corrects the pricing research's "no trial tier" inference** — a 7-day card-on-file trial with Day-7 auto-charge is implemented. The gap is *positioning/free-tier*, not a missing trial mechanism.

**Indexes present [V]** (good — hot paths already covered): `memberships(tenantId,userId)`; `creditLedger(tenantId,createdAt)`, `(refId)`, unique `(refId,reason)`; `jobs(tenantId,createdAt)`; `jobVariations(jobId)`; `jobFavorites(tenantId,jobId)`; `serverLogs` ×4. The growth risks below are **query-shape** problems, not missing-index problems.

---

### A1. History (`/studio/history`) — "close but not there"

**Wiring [V]** (`studioDb.ts` @ `ca6f39a`):
- Archive list = `listTenantJobsEnhanced()` — server-side `LIMIT/OFFSET` (default 24), status/search/favorites/date/user filters, `ORDER BY` date|credits|title. Variations fetched in **one batched `IN` query** (no N+1 ✅). User names fetched in **one batched query** (no N+1 ✅).
- Summary tiles = `getHistoryStats()`.

**Growth risks [V]:**
1. **`getHistoryStats()` runs ~9 unbounded full-scan aggregates per page load**, all `WHERE tenantId=?` with **no date bound**: `COUNT(*)` jobs; `SUM(creditsUsed)`; `COUNT(status='done')`; **four `LIKE '%"recolor":%"enabled":true%'` (and scale/density/remove) scans over the `controls` TEXT column** — *leading-wildcard LIKE is unindexable* → full table scan ×4; `GROUP BY userId`; then an `IN` for member names. **This is the worst hotspot.** At 10³–10⁵ jobs/tenant the History page degrades linearly and the "Top Edit Type" computation dominates.
   **[R] Fix:** denormalize edit-type onto a `jobs.edit_type` enum/`editTypes` JSON-bool set written at job creation (kill the LIKE scans); maintain a per-tenant rolled-up `tenant_stats` (or a daily `tenant_stats_daily` materialization) for Total/Spent/Success-Rate/Top-Type so tiles are O(1) reads; bound "Spent" to a window. All **non-money-path** (reporting only) → Crostini-buildable.
2. **Offset pagination is the ceiling [V]:** `OFFSET n` scans-and-discards `n` rows; deep history pages get slower with depth. **[R]** switch the archive to **keyset/cursor** pagination (`WHERE (createdAt,id) < (?,?) ORDER BY createdAt DESC, id DESC LIMIT k`) — stable under inserts, O(k) at any depth.
3. **Search does three leading-wildcard `LIKE` on TEXT** (`title`/`detectedElements`/`instruction`) → full scan when a search term is present. **[R]** MySQL `FULLTEXT` index on the searchable columns, or push search to an external index when volume warrants.
4. **No retention/archival on `jobs`/`jobVariations` [V]** (a `logRetention.ts` exists for `server_logs`; nothing analogous for jobs). **[R]** define a retention/cold-archive policy (e.g. variations older than N months moved to cold storage; archive table for closed jobs) — an explicit owner decision.
5. **Minor [V]:** `getHistoryStats`/`listTenantJobsEnhanced` build the `users IN (...)` list via `sql.raw(userIds.join(","))` while the adjacent variations query uses parameterized `sql.join`. Values are numeric (not injectable), but it's an inconsistency the same file's own comment warns against. **[R]** unify on parameterized `sql.join`.

---

### A2. Credit Ledger (`/studio/ledger`)

**Wiring [V]** (`studioDb.ts` @ `ca6f39a`):
- `listCreditLedger()` — server-side `LIMIT/OFFSET`, filters reason/date/search/user, parallel `count(*)` for total.
- **Ledger↔jobs correlation join is non-sargable:** `leftJoin(jobs, … jobs.id = CAST(REPLACE(REPLACE(refId,'job-',''),'-failed','') AS UNSIGNED))`. A function on the join column means **the `jobs.id` PK index cannot be used** for this join. (The `creditLedger.refId` index is correctly tenant-scoped against cross-tenant metadata leakage — good — but the *jobs side* is computed.)

**Growth risks [V]:**
1. **Non-sargable correlation join** degrades as ledger grows; every page that joins metadata pays it. **[R]** store the numeric `jobId` as a real nullable column on `creditLedger` (written at deduct/refund time), index it, and join on equality. Migration + a backfill for historic rows. **Boundary: the ledger is money-path-adjacent → schema change is `TODO(architect)`; the backfill is a one-shot data migration to coordinate, not patch.**
2. **Per-job rows multiply with refunds [V]:** the pre-deduct + refund-on-failure design writes `Generation −10` then `Refund +10` (two rows per failed/no-op job). Healthy for correctness, but ledger cardinality ≈ 2× job attempts. Combined with offset paging this is the "won't survive thousands." **[R]** keyset pagination here too; consider a compacted "net per job" reporting view for the Timeline.
3. **Client-side pagination [I, to confirm in client]:** observed "Page 1 of 2 / 45 entries," implying the **client fetches a large set and pages in memory** even though the server supports offset/limit. **Not yet confirmed against the client component** (`client/**` not read this pass). **[R]** if confirmed, switch the client to consume server-side keyset pages; never ship a client that loads the whole ledger.
4. **CSV export [I]:** if export streams the full ledger it's an unbounded query. **[R]** server-side streamed/cursor export with a row cap or async job for large tenants.

---

### A3. Admin (`/studio/admin`)

**Wiring [V]** (`firmAdmin.ts` @ `35a9af7`):
- `spendByMember` — **two live `GROUP BY userId` scans** over `creditLedger` (all-time + 7-day) per Admin load, enriched with one batched user `IN`. **Drops null-`userId` rows** → **system/subscription spend is unattributable** in Spend-by-Member (direct consequence of the nullable-userId stamping gap).
- `toggleRole` (admin↔member; owner immutable; **last-admin guard**), `transferOwnership` (owner→admin, target→owner), `updateDomainLock` (writes `tenants.allowedEmailDomain`), `removeMember` (**soft-disable**, preserves history). Procedures `tenantAdminProcedure`/`tenantOwnerProcedure` from `tenancy.ts` (not read — **[I]** these encode the access checks).

**Growth risks [V]:**
1. **`spendByMember` aggregates the full tenant ledger live** on every load (all-time scan has no date bound). Same remedy family as History tiles: **[R]** maintain `member_spend_rollup` (per tenant×user, incrementally updated on ledger write, or daily materialized). Reporting-only → Crostini-buildable.
2. **Null-user spend is invisible [V].** **[R]** decide whether to (a) attribute system grants to the actor who triggered them (where one exists) or (b) show a "System / Subscription" bucket so totals reconcile. Owner/Architect decision.
3. **No pagination on Members table [I]:** fine at tens of members; at unlimited-seat Team scale (hundreds) it needs paging + server-side sort. **[R]** add when seat counts grow.

---

### A4. Billing (`/studio/billing`) — the structural spine

**Wiring [I/V]:** plan/pool/Stripe ids on `tenants` [V]; plan catalog + checkout + webhook credit grants in `studioBilling.ts`/`billing.ts`/`webhook.ts`/`stripe.ts` (**not read line-by-line this pass — money-path, fenced**). Idempotency is solid and verified at the data layer: `grantCredits` is **check-first idempotent on `(refId, reason)` + unique-index backstop**; `deductCredits` is an **atomic conditional `UPDATE … WHERE creditBalance ≥ amount` under a row lock**; `stripeEvents` PK dedupes webhook re-delivery (`studioDb.ts` @ `ca6f39a`, `schema.ts` @ `3b69395`). **Do not touch (Architect-scoped).**

**Brief-flagged items to confirm in money-path files (read-only):**
- **Stripe test mode live in prod copy** — flagged; verify in `stripe.ts`/billing config and treat any flip to live as a gated money-path change (`TODO(owner/architect)`, gate G0/G1).
- Plan catalog (Starter $39/3,900·1 seat; Pro $199/19,900·≤10; Team $20/seat/2,000·∞) and packs (1k/$15, 5k/$60, 20k/$200) — confirm the source-of-truth lives in `shared/billing` and matches the live copy.

---

## PART B — Architecture: Option A onto the current schema

**Decided model:** separate four concepts — **Identity (user)**, **Billed tenant (workspace)**, **Membership (scope+role)**, **Org (optional grouping parent)** — and serve three modes from one schema.

**Current-state gap analysis [V]:**

| Option-A concept | today | gap |
|---|---|---|
| Identity = user | `users` ✅ | none |
| Billed tenant = workspace | `tenants` ✅ but **billing fused on it** | extract billing → `billing_account` (Part C) |
| Membership `(scope, role)` | `memberships` with single `role` enum, tenant scope only | **add `scope` + roles `billing`,`viewer`; org-scoped memberships** |
| Org (grouping parent) | **absent** | **new `orgs` table + `tenants.orgId` FK (nullable)** |
| Stamping `(workspace,user[,org])` | jobs ✅; ledger user **nullable**; org absent | backfill org_id; decide system-grant attribution |

**Mode mapping:**
- **(1) Individual** [V supported] — `tenants.type='individual'`, no org, Starter. Already expressible.
- **(2) Single org / team** [V supported] — one `tenants` row, many memberships + seats, Pro/Team. Already expressible (note: "org" here = the team workspace; no `orgs` row needed).
- **(3) Multi-org** [✗ not modeled] — needs `orgs` parent over N `tenants`, users with memberships across several. **Net-new.**

**Target schema deltas [R] (migrations `0012+`; current last = `0011_kind_dakota_north.sql`):**
1. `0012_orgs` — `orgs(id, name, slug, createdAt)`; `tenants.orgId int NULL → orgs.id`.
2. `0013_membership_scope_roles` — `memberships.scope enum('org','workspace') NOT NULL default 'workspace'`; widen `role` to `owner|admin|member|billing|viewer`; allow `memberships.orgId` (org-scoped rows have `orgId` set, `tenantId` null, or a polymorphic `scopeId` — **Architect to choose the shape**).
3. `0014_org_stamping` — add `orgId int NULL` to `jobs` and `creditLedger`; **backfill** from `tenants.orgId`; index `(orgId, createdAt)` for rollups. *(ledger column = money-path-adjacent → `TODO(architect)`.)*
4. `0015_ledger_jobid` — real `creditLedger.jobId int NULL` + index; backfill; replaces the non-sargable CAST join. *(money-path-adjacent → `TODO(architect)`.)*

**Seams that keep modes from fragmenting billing [R]:**
- **Stamping invariant:** every job + ledger row carries `(workspaceId, userId)` always and `orgId` when present → rollups are `GROUP BY`, never a schema change. Enforce `userId NOT NULL` going forward by giving system grants a synthetic actor or a "system" sentinel; reconcile historic nulls.
- **Resolver boundary:** one `resolveScope(user, target)` in `tenancy.ts` returns `(scope, role)` for every request; all routers consume it. No router hand-rolls role logic (today `firmAdmin` reads `role` directly — fine, but route it through the resolver post-migration).
- **Rollup boundary:** org views are **read-only `GROUP BY orgId`** over per-workspace data. **No cross-workspace credit pool, no consolidated invoice** — enforced by never letting a deduct/grant cross a `workspaceId`.

---

## PART C — Billing structure (LOCKED) + auto-top-up

**Locked:** workspace = sole billed entity; one Stripe customer → one card → one subscription → one monthly pool → one invoice; seats draw from the pool; **no per-job/per-member invoicing** (those are *reporting*); multi-org bills per workspace, org = rollup only (no consolidated invoice, no cross-workspace pooling).

**`billing_account` indirection [R + migration reality]:**
- **[V] Not a clean pre-existing seam** — billing is fused on `tenants`. The indirection is a real extract migration, not a flag flip.
- `0016_billing_account` — `billing_account(id, plan, creditBalance, stripeCustomerId, stripeSubscriptionId, stripePaymentMethodId, …)`; `tenants.billingAccountId` FK **1:1 in all modes**; move the columns; backfill 1:1; update `studioDb`/billing reads/writes. **Money-path → `TODO(architect)`, build dark, do not flip.** Purpose is strictly future-proofing (org-level pooling becomes an FK/flag change, *not* a migration) — **do not build pooling; shipped behavior stays workspace-billed.**

**Auto-top-up (smart, capped) — design + money-path boundary:**

*Buildable now (analytics + UI, non-money-path) — Crostini:*
- **Run-rate estimator** — **a working analog already exists**: `analyzeTrialUsage()` (`studioDb.ts` @ `ca6f39a`) sums day-4–7 debits → avg daily burn → recommended plan (50/200 cr/day thresholds). **[R]** generalize to a `projectExhaustion(tenantId, window=7–14d)` over `creditLedger` debits → `{ creditsPerDay, daysToZero, recommendedPackSku }`, sizing the pack to cover ~N more days (bounding charge frequency), choosing from existing SKUs (1k/5k/20k).
- **Pre-exhaustion notice** — fire before zero ("≈Thursday at current pace"), auto-top-up shown as armed.
- **Exception UX** — admin sets a **monthly dollar budget cap** once; receives **receipts** per top-up and **alerts at 50/75/100%**; pulled in only at the cap.

*Money-path — `TODO(architect)`, dark, NOT implemented here:*
- **The piece that charges the card on a forecast.** Hard invariants: (a) **non-bypassable monthly dollar cap**; (b) idempotent charge (reuse the `(refId,reason)` + `stripeEvents` discipline); (c) at-cap behavior is an **owner decision** (hard-stop vs notify-and-pause); (d) every auto-charge writes a ledger row stamped `(workspaceId, userId=system)` with a receipt. **Do not implement the charge. Gate behind a dark `*_LIVE` flag; Frank flips per CLAUDE.md G0–G4.**

---

## PART D — Execution spec for Crostini

**Working agreement:** branch per phase off current `main` HEAD (re-pin first); **draft PR** only; CI green (`pnpm run check` + `pnpm run test`); every `*_LIVE` ships **dark**; money-path items are `TODO(architect)` and **not implemented**; commit trailers per the CLAUDE.md §3 resolution above (no model identifier in pushed artifacts). A gate must actually gate (G3 lesson) — no check that's green for the wrong reason.

**Phasing (each = own branch + draft PR, independently shippable, all dark where they touch live behavior):**

- **P1 — History scale (reporting-only, no money-path).** `feat/history-scale`. (a) `jobs.editTypes` denormalization written at create + backfill migration `0012a`; replace the 4 LIKE-scans in `getHistoryStats`. (b) `tenant_stats` rollup for tiles (O(1) reads). (c) keyset pagination on the archive. (d) `FULLTEXT` (or external) search. (e) unify `IN`-list params. **Tests:** unit on keyset boundaries + stat rollup correctness vs. a live-scan oracle; eval that tiles match `COUNT/SUM` over a seeded 50k-job tenant. Flag: none needed (pure perf/behavior-preserving) — but ship behind `HISTORY_V2` if UI changes are user-visible.

- **P2 — Ledger scale.** `feat/ledger-scale`. (a) keyset pagination; (b) client switched to server pages (kills client-side paging); (c) streamed/capped CSV export. **(d) `creditLedger.jobId` real column + backfill + sargable join → `TODO(architect)` (ledger is money-path-adjacent).** **Tests:** join-correctness before/after; pagination stability under concurrent inserts.

- **P3 — Admin scale + attribution.** `feat/admin-rollups`. (a) `member_spend_rollup` (incremental or daily); (b) decide+implement null-user spend display ("System" bucket) — **attribution semantics = `TODO(architect)`**; (c) Members table paging/sort at scale. **Tests:** rollup vs live-scan oracle; last-admin/transfer-owner invariants (extend `firmAdmin.test.ts`).

- **P4 — Tenancy: Option A schema.** `feat/tenancy-option-a`. Migrations `0012 orgs`, `0013 membership scope+roles`, `0014 org stamping` (ledger col = `TODO(architect)`), `resolveScope()` in `tenancy.ts`, org-scoped procedures. **Build dark behind `MULTIORG_LIVE` (dark).** **Tests:** `(scope,role)` matrix; rollup `GROUP BY orgId` correctness; **invariant test that no deduct/grant ever crosses `workspaceId`.**

- **P5 — billing_account indirection.** `feat/billing-account` — migration `0016`, 1:1 backfill, reads/writes moved. **Entirely `TODO(architect)`, dark, not flipped.** No pooling.

- **P6 — Auto-top-up (analytics + UI only).** `feat/autotopup-advisory` — `projectExhaustion()`, pre-exhaustion notice, admin budget-cap + receipts/alerts UI. **The forecast-charge is `TODO(architect)`, dark (`AUTOTOPUP_CHARGE_LIVE` unset).** **Tests:** estimator accuracy vs seeded burn curves; cap math; "never exceeds cap" property test on the (stubbed) charge planner.

- **P7 — Cleanup.** `chore/schema-cleanup` — confirm+drop `games`/`scraperCache`; reconcile/remove `billingClients`; **reconcile the duplicate-`0008` migration orphan**. **Architect confirm before drop.**

**Migrations enumerated (none applied here):** `0012 orgs` · `0012a jobs.editTypes` · `0013 membership scope+roles` · `0014 org stamping`*(mp)* · `0015 ledger.jobId`*(mp)* · `0016 billing_account`*(mp)*. *(mp = money-path-adjacent → `TODO(architect)`.)*

**Eval/test plan (global):** every rollup ships with a "matches live-scan oracle on a seeded large tenant" eval on **fixed runners** (per CLAUDE.md G3 — a gate that doesn't execute is not a pass); money-path stays covered by existing `webhook.test.ts`/`studioBilling.test.ts`/`shadowBilling.test.ts` and is **not modified by Crostini**.

---

## PART E — Verify-first answers & open decisions

**Verify-first (answered against source):**
- **Is workspace/billing separable or fused?** **[V] Fused** on `tenants`. The `billing_account` indirection is a real extract migration (P5), not a clean seam.
- **Do card/subscription/pool already bind to the workspace?** **[V] Yes** — all on `tenants`. Shipped behavior already = workspace-billed (Part C satisfied).
- **Is Option A a clean migration?** Identity + workspace + (basic) membership exist; **org, `(scope,role)`, org-stamping, and `billing_account` are net-new** → medium-weight, phased (P4–P5), money-path pieces fenced.

**Open — owner/Architect (do not flip):**
1. **Auto-top-up cap:** default value **and** at-cap behavior (**hard-stop vs notify-and-pause**). *Research lean: notify-and-pause default + hard-stop toggle.*
2. **Refund routing within a workspace** (which user/bucket a refund attributes to).
3. **System-grant attribution** (null-userId): synthetic actor vs "System" bucket.
4. **History/ledger retention policy** (window, cold-archive).
5. **Org-admin permission boundaries** (what org-scope `admin`/`billing` can see/do across workspaces; rollup is read-only).
6. **Pricing/packaging** changes (free-tier positioning, expiry posture, enterprise rung) — recommend-only.
7. **Stripe test→live** flip in prod copy — money-path, gated.
8. **`billingClients`/template-table** cleanup approval; duplicate-`0008` migration reconciliation.
9. Any **`*_LIVE` flag** gating go-live (`HISTORY_V2`, `MULTIORG_LIVE`, `AUTOTOPUP_CHARGE_LIVE`, …) — **dark until Frank flips, G0–G4.**

---

## PART F — Render (companion artifact)

**File:** `docs/admin-redesign-mockup.html` (single-file interactive HTML/CSS mockup — open in a browser).

**Fidelity (stated up front):** reconstructed from **(1)** the drizzle schema `3b69395`, **(2)** the server tRPC/data-layer contracts read this pass (`studioDb.ts` `ca6f39a`, `firmAdmin.ts` `35a9af7`), and **(3)** the logged-in observed-state. It is **not** pixel-scraped from the auth-walled prod app and **not yet reconciled against `client/**`** (not read this pass) — so it's design-intent fidelity, not a 1:1 reproduction of current React. It covers **History, Ledger, Admin, Billing** across **Individual / Single-Org / Multi-Org**, with expanded-volume states (keyset pagination, filters, bulk actions, populated history), the **org switcher + read-only cross-workspace rollup** (multi-org), and the **auto-top-up admin budget + receipts/exception UX**. Reviewable before any code.
