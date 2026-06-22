# Spec — Multi-Org Admin Rebuild (tenants + individuals)

**Status:** IMPLEMENTED — this design is built in PR #5 (`claude/multi-org-admin-rebuild`).
This document is the design-of-record for that work; sections originally written as
"proposed/PROPOSED" (Q5, §13, §16) are now **implemented** as described, the lone
exception being self-serve Create-org (§8.4), which is built but **pending Architect
sign-off** before it's considered final. Q1–Q4 were resolved by Frank (2026-06-22).
**Decisions locked:** Q1 → **new branch + new PR**. Q2 → **Platform Console IS in
scope** (§13). Q3 → **wire `tenants.create` in v1** (gated + Architect-flagged, §8.4).
Q4 → **members see Zone A + own balance** (§5.4). Q5 → **individual panel** as proposed.
**Scope owner:** the full admin experience — tenant-facing `/studio/admin` + the org
switcher **and** the super-admin Platform Console (`/platform`).
**Branch:** dedicated new branch + PR (Q1), cut from `main`, independent of the
in-review invite-links PR #4.

> **Org-repo port note (2/3):** the org repo deliberately REMOVED `tenants.create`
> (M2, 2026-06-21) because, as an open `protectedProcedure`, it minted credited trial
> tenants and wrote `creditBalance` with no matching `creditLedger` row (balance↔ledger
> drift). Tenant creation in the org repo is invite-only. So in the org tree the
> CreateOrgDialog UI is ported but ships **dark** behind `VITE_CREATE_ORG_LIVE` (no
> server create procedure wired); re-enabling requires a ledger-safe, rate-limited
> `tenants.create` + Architect sign-off. The §8.4 design below documents the original
> intent.

---

## 1. Goal

Rebuild the admin experience around the **multi-org model** the data already
supports: a single user can belong to **many organizations** — **firms** (multi-seat
teams) and **individuals** (solo, 1-seat accounts) — and needs to move between them,
see them at a glance, and manage each. Built to scale to "many tenants and
individuals," not the current implicit single-org assumption.

## 2. Current state (grounded in code)

| Area | Today | Gap |
|---|---|---|
| Data model | `tenants.type ∈ {firm, individual}`; `memberships` is many-to-many; `myTenants` already returns **all** a user's orgs + their role | none — model is already multi-org |
| Context | `TenantContext` holds `tenants[]` + `activeTenantId` + `setActiveTenant()` | selection **not persisted** (resets to `tenants[0]` on reload); `type` not surfaced |
| Switcher | bare `<select>` in the **desktop** sidebar, only when `tenants.length > 1` | no mobile switcher; no role/type/balance context; no "create org"; ugly |
| Admin screen | `/studio/admin` manages **only the active org** (metrics, spend-by-member, members, invite, firm settings); admin/owner gated | no "all your orgs" overview; **no individual-account treatment** (shows team/seats UI for solo accounts); no per-org identity header |
| Cross-org | only super-admins, via Platform Console + impersonation | no tenant-user multi-org overview |

Backend procedures that already exist and will be reused as-is:
`tenants.myTenants` · `tenants.create` · `tenants.members` · `tenants.invite` ·
`firmAdmin.spendByMember/toggleRole/transferOwnership/updateDomainLock/removeMember` ·
`inviteLinks.createJoinLink/listForTenant/revoke` · `platform.impersonationStatus`.

## 3. Scope

**In:**
1. **Org switcher** — polished, persistent, desktop + mobile, firm/individual aware.
2. **Studio Admin rebuild** — two zones: (a) **Organizations overview** (all your
   orgs), (b) **Active-org management** (the rebuilt current screen), with
   **firm-vs-individual** differentiation and role gating.
3. **`TenantContext`** — persist active org, expose `type`.
4. One small backend query: **`tenants.overview`** (per-org role + member count) — see §6.
5. **Create-organization** flow (self-serve) — **in v1** (Q3), gated + Architect-flagged (§8.4).
6. **Platform Console redesign** (super-admin) — **in v1** (Q2), see §13.

**Out (this pass):** cross-org aggregate analytics (tenant-user side);
individual→firm upgrade/conversion; billing/plan changes; new money-path semantics.

## 4. Information architecture

```
Studio shell (AppShell)
 └─ Org Switcher  ← new, replaces the <select>; desktop sidebar + mobile header
/studio/admin  (rebuilt)
 ├─ Header: active org identity (name, type badge, your role, plan)
 ├─ Zone A — "Your organizations" (overview)
 │    grid of OrgCards (every org you belong to)
 │    + "Create organization" CTA
 └─ Zone B — "Manage <active org>" (active-org management)
      ├─ FIRM:        Metrics · Spend-by-member · Members · Invite · Firm settings
      └─ INDIVIDUAL:  Account summary · Usage · Account settings  (no team/seats)
```

## 5. Screens & components

### 5.1 Org Switcher (`components/studio/OrgSwitcher.tsx`, new)
- Trigger shows active org: avatar/initial, name, **type badge** (Firm / Individual),
  and credit balance.
- Dropdown (shadcn `dropdown-menu`) lists every org **grouped** by "Firms" /
  "Individual accounts"; each row: name, role badge, balance, seats-used (firms),
  check on active. Selecting calls `setActiveTenant(id)` (persisted).
- Footer action: **"Create organization"** (→ §8.4) and **"Manage organizations"**
  (→ `/studio/admin`).
- Renders even with a single org (shows identity; no clutter). Desktop sidebar +
  mobile header. When **impersonating**, shows the impersonation banner state and
  disables switching (consistent with the existing impersonation model).

### 5.2 Organizations overview — Zone A (`OrgCard` + grid)
- Responsive grid of `OrgCard`s, one per org from `tenants.overview`.
- Card content: name + type badge, **your role** (Owner/Admin/Member), plan,
  **members N / seats** (firms) or "Individual" (solo), credit balance (low-balance
  accent reusing `LOW_BALANCE_THRESHOLD`), and actions: **Switch** (if not active),
  **Manage** (switch + scroll to Zone B), **Billing** (→ `/studio/billing`).
- Active org is visually highlighted.
- **Scales:** when `orgs.length` is large, a search/filter input appears above the
  grid (client-side filter by name/type). Empty state → "Create organization" CTA.

### 5.3 Active-org management — Zone B
Rebuilt from the current screen; **reuses the proven, role-gated sub-components**
(`MetricCards`, `SpendByMember`, `MembersList`, `InviteCard`, `FirmSettings`) rather
than rewriting working, `firmAdmin`-backed code. Restructured under a clear
per-org header.

**Firm (`type === "firm"`):** Metrics (pool balance, spend 7d, seats) · Spend-by-member
· Members (role toggles, remove, transfer) · Invite (email + copy link) · Firm
settings (domain lock, transfer ownership).

**Individual (`type === "individual"`):** a distinct, simpler panel — account
summary (balance, plan, trial state), recent usage, and account settings — and we
**hide** members/seats/invite/domain-lock entirely (a solo account has no team).
This is the core "individuals" half of the rebuild that's missing today.

### 5.4 Role-based visibility matrix (active org)
| Element | Owner | Admin | Member |
|---|---|---|---|
| Org overview (Zone A) | ✓ | ✓ | ✓ (read-only cards) |
| Metrics / spend | ✓ | ✓ | ✓ (own balance only) |
| Members list | ✓ | ✓ | hidden |
| Role toggle / remove member | ✓ | ✓ (not owner) | — |
| Invite (email + link) | ✓ | ✓ | — |
| Firm settings (domain lock) | ✓ | ✓ | — |
| Transfer ownership | ✓ | — | — |
| Individual account settings | ✓ (own) | — | — |

A **member** of a firm no longer hits a hard "Admin Access Required" wall — they
see Zone A (their orgs) + their own balance, just not the management controls.
(Today the whole page is blocked for members; this is an intentional change — flag
for review, Q4.)

## 6. Backend (one new query)
```ts
// tenants.ts
overview: protectedProcedure.query(async ({ ctx }) => {
  const orgs = await getUserTenants(ctx.user.id);            // existing
  return Promise.all(orgs.map(async (t) => ({
    ...t,                                                     // incl. type, role, balance, seats, plan
    memberCount: await countActiveMembers(t.id),             // existing helper
  })));
});
```
No money-path, no schema change, no new migration. Everything else reuses existing
procedures. (If member-count fan-out is a concern at scale, it can become a single
grouped COUNT query later — noted, not needed for v1.)

## 7. State & persistence (`TenantContext`)
- Add `type: "firm" | "individual"` to `TenantWithRole` (already in the payload).
- Persist `activeTenantId` to `localStorage` (`studio.activeTenantId`); on load,
  prefer impersonation → stored id (if still a member) → `tenants[0]`.
- `setActiveTenant` writes through to `localStorage`.
- Impersonation precedence unchanged.

## 8. Behavior details
1. **Switching** is instant (client state); all Studio pages already key off
   `tenant.id`, so they refetch automatically.
2. **Empty state** (no orgs — e.g. brand-new user): overview shows a "Get started"
   card → Create organization / accept an invite.
3. **Single org:** switcher shows identity but is non-interactive; Zone A still shows
   the one card.
4. **Create organization (self-serve) — IN v1 (Q3):** dialog → `tenants.create`
   (exists; seeds a 7-day trial + `TRIAL_CREDITS`, adds creator as owner). **Money-path
   guardrails:** this mints trial credits, so (a) the dialog action is behind an
   explicit confirm, (b) it's flagged for Architect sign-off before merge, and (c) I
   will **coordinate, not patch** any credit logic — `tenants.create` is used as-is;
   no change to credit/trial semantics. A per-user new-org rate limit is noted as a
   follow-up to prevent trial-credit farming.
   *(Org-repo port: `tenants.create` was removed in the org tree; see the top note —
   the dialog ships dark behind `VITE_CREATE_ORG_LIVE` until a ledger-safe procedure
   is restored and signed off.)*
5. **Impersonation:** banner + Zone B continue to work via the synthetic-owner
   context; the switcher is read-only while impersonating.

## 9. Out of scope / future
- Cross-org aggregate dashboard for tenant users (total spend/credits across all
  your orgs).
- Individual → firm conversion / adding seats to an individual account.
- Per-org notification settings, audit-log surfacing.
- Per-user new-org rate limiting (follow-up to §8.4).

## 10. Testing
- Reuse the green `firmAdmin`/invite-links suites (unchanged data layer).
- New: `tenants.overview` unit test (role + memberCount mapping; empty case).
- Component-level: switcher persistence (localStorage read/write), firm-vs-individual
  Zone B branching, role-gated element visibility. (Match repo's existing test style.)
- Gates: `pnpm check` + `pnpm test` green before any PR update.

## 11. Rollout
- **No flags, no money-path semantics changes.** The only credit-adjacent surface is
  the Create-org dialog (§8.4), which reuses `tenants.create` unchanged and is flagged
  for Architect sign-off before merge.
- **Branch (Q1 → resolved):** dedicated new branch (e.g. `claude/multi-org-admin-rebuild`)
  cut from `main`, new PR, independent of invite-links PR #4. The spec doc travels to
  the new branch.
- Phasing (single PR, reviewable commits): (1) context + `tenants.overview`; (2) Org
  switcher + AppShell; (3) Studio Admin Zones A/B + individual panel; (4) Create-org
  dialog; (5) Platform Console redesign (§13); (6) tests.

## 12. Decisions (Q1–Q4 locked; Q5 proposed)
- **Q1 — Branch:** ✅ **New dedicated branch + PR**, cut from `main`.
- **Q2 — Platform Console:** ✅ **In scope** — redesign per §13.
- **Q3 — Create-organization:** ✅ **Wire `tenants.create` in v1**, gated + Architect-flagged.
- **Q4 — Member access:** ✅ **Members see Zone A + own balance** (no hard wall).
- **Q5 — Individual panel (PROPOSED — confirm or amend):** Account summary (balance,
  plan, trial countdown), recent usage (last N jobs / 7-day spend), and account
  settings (display name, billing link, leave/close-account placeholder). No
  team/seat/invite/domain UI. *Tell me if a solo user needs anything else here.*

## 13. Platform Console redesign (super-admin, `/platform`) — PROPOSED

**Today:** a 3-tab view (Firms / Individuals / Links) over `listAccounts`, plus
provision/invite/grant/impersonate dialogs (`PlatformConsole.tsx` ~140 lines +
`AccountList`, `AddAccountDialog`, `GrantCreditsDialog`, `InviteDashboard`).
Functional, but not a unified operations dashboard.

**Proposed (reuses all existing `platform.*` procedures — no new money-path):**
1. **Platform dashboard header** — at-a-glance metrics: total accounts (firms vs
   individuals), active vs trialing, total credits outstanding, seats in use. Derived
   from the existing `listAccounts` payload (member counts + balances already there);
   a small `platform.stats` aggregate query may be added if the client-side rollup is
   too heavy (read-only, no money-path).
2. **Unified accounts table** — one searchable/sortable/filterable table across all
   accounts (replaces the rigid tab split; type becomes a filter chip, not a tab):
   columns = name, type, plan, status (active/trial/disabled), members/seats, balance,
   owner, created. Row actions: **Manage** (detail), **Impersonate**, **Grant credits**.
   Keeps the existing mobile-card fallback.
3. **Account detail drawer/panel** — click a row → side panel with the account's
   members, balance/ledger summary, plan, domain lock, and quick actions
   (impersonate, grant credits, invite link). Consistent with the tenant-admin design
   language from §5 so the two admin surfaces feel like one system.
4. **Add Account + Invite Dashboard** — keep the existing unified Add-Account dialog
   and invite-links dashboard; restyle to match.
5. **Design-language parity** — shared card/badge/table vocabulary, role/type/status
   badges identical to the tenant-facing side.

**Out (console):** changing provisioning/credit semantics; new billing actions;
analytics beyond the rollup above. **Guardrail:** `grantCredits` and `provisionFirm`
are used **as-is**; no reactive money-path edits (CLAUDE.md §4).

---

## 14. Component architecture — tenant-facing (`/studio/admin` + shell)

Shared design primitives (new, used by **both** surfaces for parity):
`TypeBadge` (Firm / Individual), `RoleBadge` (Owner / Admin / Member),
`StatusBadge` (Active / Trial / Disabled), `OrgAvatar` (initial monogram).
→ `client/src/components/studio/badges.tsx` + `OrgAvatar.tsx`.

```
AppShell (shell chrome)
└─ OrgSwitcher (new) ............... desktop sidebar + mobile header
     data: useTenant() → tenants[], tenant, setActiveTenant
     actions: switch (persisted), → CreateOrgDialog, → /studio/admin

StudioAdmin (page, rebuilt)
├─ AdminHeader ..................... active org: name, TypeBadge, RoleBadge, plan
├─ OrganizationsOverview (Zone A)
│    data: trpc.tenants.overview
│    ├─ OrgSearch ................. shown when overview.length > 6 (client filter)
│    ├─ OrgCard[] ................. name, TypeBadge, RoleBadge, plan, members/seats,
│    │                              balance (low-balance accent), [Switch][Manage][Billing]
│    └─ CreateOrgCard ............. → CreateOrgDialog
├─ ActiveOrgManagement (Zone B) — branches on tenant.type + role
│    ├─ FIRM + admin/owner:
│    │    ├─ MetricCards .......... firmAdmin.spendByMember + tenant (REUSE)
│    │    ├─ SpendByMember ........ firmAdmin.spendByMember (REUSE)
│    │    ├─ MembersList .......... tenants.members; firmAdmin.toggleRole/removeMember/
│    │    │                          transferOwnership (REUSE)
│    │    ├─ InviteCard ........... tenants.invite + inviteLinks.createJoinLink/
│    │    │                          listForTenant/revoke (REUSE)
│    │    └─ FirmSettings (owner) . firmAdmin.updateDomainLock/transferOwnership (REUSE)
│    ├─ INDIVIDUAL + owner:
│    │    └─ IndividualAccountPanel  (new) — §5.3 / Q5
│    └─ FIRM + member (non-admin):
│         └─ MemberView ........... own balance + read-only note (Q4)
└─ CreateOrgDialog (new) .......... tenants.create (confirm-gated; §8.4)
```

**Reuse vs new:** `MetricCards`, `SpendByMember`, `MembersList`, `InviteCard`,
`FirmSettings` are lifted from today's `StudioAdmin.tsx` (proven, `firmAdmin`-backed)
into their own files under `components/studio/admin/` and re-composed. New:
`OrgSwitcher`, `OrganizationsOverview`/`OrgCard`, `IndividualAccountPanel`,
`MemberView`, `CreateOrgDialog`, the shared badges.

## 15. Data & query map

| Component | Query / mutation | New? |
|---|---|---|
| OrgSwitcher | `tenants.myTenants` (via context) | existing |
| OrganizationsOverview / OrgCard | `tenants.overview` | **new (§6)** |
| CreateOrgDialog | `tenants.create` | existing (UI new) |
| MetricCards / SpendByMember | `firmAdmin.spendByMember` | existing |
| MembersList | `tenants.members`, `firmAdmin.toggleRole/removeMember/transferOwnership` | existing |
| InviteCard | `tenants.invite`, `inviteLinks.createJoinLink/listForTenant/revoke` | existing |
| FirmSettings | `firmAdmin.updateDomainLock/transferOwnership` | existing |
| IndividualAccountPanel | `tenants.overview` row + `studio.historyStats`/`studio.balance` | existing |

## 16. Platform Console — super-admin data requirements + architecture

### 16.1 New read-only queries (no money-path)
- **`platform.stats`** → `{ totalAccounts, firms, individuals, trialing, paid, disabled, totalCreditsOutstanding, totalSeatsUsed }`. Aggregate over `tenants`/`memberships`; read-only.
- **`platform.accountDetail({ tenantId })`** → `{ tenant, members:[{…,user}], spent7d, spentAll, recentLedger }`. Powers the detail drawer (super-admins are not tenant members, so `firmAdmin.*` — which is `tenantAdminProcedure` — can't be reused; this is the platform-scoped equivalent). Read-only.
- Reused as-is: `platform.listAccounts`, `provisionFirm`, `inviteIndividual`, `grantCredits`, `impersonate`, `exitImpersonation`, `impersonationStatus`, `whoami`.

### 16.2 Architecture
```
PlatformConsole (page, rebuilt)
├─ PlatformHeader ................. whoami; exit-impersonation affordance
├─ PlatformStats ................. aggregate cards            ← platform.stats (new)
├─ GlobalImpersonationLaunchpad .. command-style search to jump-impersonate any
│                                   account                   ← listAccounts + impersonate
├─ AccountsTable ................. unified, replaces the 3 tabs with filter chips
│    data: platform.listAccounts({ type: "all" })
│    cols: name, TypeBadge, plan, StatusBadge, members/seats, balance, owner, created
│    sort: name / balance / members / created ; search: name/owner
│    filters: type chip, status chip, plan chip
│    row actions: [Manage → drawer] [Impersonate] [Grant]
│    mobile: AccountCard[] fallback (reuse existing)
├─ AccountDetailDrawer ........... members + ledger summary + quick actions
│                                  (grant / impersonate / invite-link)  ← accountDetail (new)
├─ AddAccountDialog .............. existing, restyled to shared vocabulary
└─ InviteDashboard ............... existing, restyled
```
Design-language parity: same `TypeBadge`/`RoleBadge`/`StatusBadge`/`OrgAvatar` and
card/table primitives as §14, so tenant-admin and platform-admin read as one system.

> **Org-repo port note:** the org tree's `platform.stats`/`listAccounts`/`accountDetail`
> are the newer, batched implementations (no per-account N+1; `stats` already folds in
> Manus's "Top Spenders" panel and a trial pipeline). The port keeps those server
> procedures and the org's `PlatformStats.tsx`, and adapts the ported `AccountsTable`/
> `ImpersonationLaunchpad` to the `{ accounts, total }` shape `listAccounts` returns.

## 17. States, empty & error handling (per surface)
- **Loading:** skeletons for OrgCards, AccountsTable rows, stats cards.
- **Empty — no orgs (tenant):** "Get started" card → Create org / accept invite.
- **Empty — search:** "No organizations match" with a clear-filter action.
- **Single org:** switcher shows identity, non-interactive; Zone A shows one card.
- **Error:** inline error card with retry; mutations surface `toast.error(err.message)`
  (matches existing pattern).
- **Impersonation:** banner persists; OrgSwitcher read-only; Zone B works via synthetic
  owner context; platform AccountsTable highlights the impersonated row.
- **Permissions:** Zone B sections render per the §5.4 matrix; server procedures remain
  the source of truth (UI gating is convenience, not the security boundary).

## 18. Responsive & accessibility
- Mobile: OrgSwitcher in the mobile header; Zone A single-column cards; AccountsTable
  collapses to AccountCard list (existing pattern).
- Keyboard: switcher + launchpad are dropdown/command components (focus-trap, arrow
  nav, Esc); table actions reachable by keyboard; dialogs use the existing accessible
  `dialog` primitive.
- Badges carry text labels (not color-only) for status/role/type.

## 19. Testing matrix
- **Backend (vitest):** `tenants.overview` (role + memberCount, empty); `platform.stats`
  (aggregate rollup); `platform.accountDetail` (membership/ledger shape, super-admin
  gate). Reuse the green `firmAdmin`/invite-links suites unchanged.
- **Logic units (repo style):** Zone B branch selection (firm/individual/member),
  switcher persistence (localStorage read/write/eviction when stored id not a member),
  overview search filter.
- **Gates:** `pnpm check` + `pnpm test` green before each PR update.

## 20. Implementation phases (commit boundaries on the new branch)
1. **Foundation:** `tenants.overview`; `TenantContext` (`type` + persistence); shared
   badges/avatar. *(+ tests)*
2. **Switcher:** `OrgSwitcher` + AppShell wiring (desktop + mobile).
3. **Studio Admin Zone A:** `OrganizationsOverview`/`OrgCard` + extract reused
   sub-components into `components/studio/admin/`.
4. **Studio Admin Zone B:** firm path recompose + `IndividualAccountPanel` + `MemberView`
   + the §5.4 role gating (drop the hard wall).
5. **Create-org:** `CreateOrgDialog` (confirm-gated) — Architect-flagged in the PR.
6. **Platform Console:** `platform.stats` + `platform.accountDetail`; `AccountsTable`,
   `AccountDetailDrawer`, `PlatformStats`, `GlobalImpersonationLaunchpad`; restyle
   AddAccount/InviteDashboard. *(+ tests)*
7. **Verify + draft PR:** full `pnpm check`/`test`, screenshots, open draft PR.

**Net file inventory:** ~3 backend procedures (1 tenant, 2 platform) · ~10 new client
components · `TenantContext` + `AppShell` edits · `StudioAdmin` + `PlatformConsole`
rebuilds · ~4 new test files. No schema/migration, no flags, no money-path semantics
(Create-org reuses `tenants.create` unchanged, behind a confirm + Architect flag).
