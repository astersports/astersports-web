# AAU Tracking Hub — canonical build artifacts (BINDING)

> If you are a Claude Code session working on the AAU hub (`/aau`, `client/src/components/aau/**`,
> `client/src/lib/aau/**`, `client/src/lib/aster.ts`): **read these three files before building.**
> The last session drifted from the renders and started inventing UI. These are the contract so
> that does not happen again.

## The three sources of truth

| File | What it binds |
|---|---|
| [`RENDER_SET_bestinclass.html`](./RENDER_SET_bestinclass.html) | The **8 core surfaces** — visual truth: layout, hierarchy, components, the 4-tab nav, brand tokens, copy intent. |
| [`RENDER_12_features.html`](./RENDER_12_features.html) | The **12 feature moments** (killers + high-value + kid/family) — visual truth per feature. |
| [`MASTER_BUILD_SPEC.txt`](./MASTER_BUILD_SPEC.txt) | Data sources (RPC/field), states, logic, gates, phasing, build order, acceptance, design tokens. The single written spec. |

## Precedence
- The **render HTML** is binding for layout / hierarchy / components / nav / brand / copy intent.
  If the built screen doesn't look/structure like its render frame, it is **not done** — redo it.
- The **MASTER_BUILD_SPEC** is binding for data sources, states, logic, gates, phasing.
- Neither authorizes inventing data — **all render content is PLACEHOLDER; bind every value to its RPC.**

## The enforcement gate (do this for every screen)
A screen is done only after: (1) a **screenshot** of the built screen (default + key states:
empty / live / offline) is posted, (2) the RPCs it binds to are listed, (3) it passes a **visual
diff** against its render frame. No diff, not done. Do not batch-merge screens then ask for review —
go one screen at a time.

## Holds (do not violate)
Owner applies migrations (or explicitly authorizes CC to); money path = architect review + Frank
flips (no Stripe on merge); child data = Supabase backbone only; film = §C posture; no agent flips
`*_LIVE`; auth + predictor/engine + RPC are architect-scoped.

_Source: architect master spec, 2026-06-27. Kept in-repo so the contract survives context compaction._
