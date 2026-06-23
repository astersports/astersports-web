
# AAU Basketball Integration

- [x] Add shared AAU types (Game, GameStatus, etc.) to shared/types.ts
- [x] Add server scraper (server/scraper.ts)
- [x] Add AAU tRPC routes to server/routers.ts (games.list, games.live, games.completed, games.refresh, leaderboard.get)
- [x] Register scheduled game-check endpoint in server/_core/index.ts
- [x] Add AAU CSS (variables, utilities, broadcast patterns) to index.css
- [x] Add AAU page component (client/src/pages/AAUBasketball.tsx)
- [x] Add AAU sub-components (LiveScores, TournamentHistory, SeasonLeaderboard, FilmHighlights, StatHeroBar, SectionHeading, Locations, Mission)
- [x] Add /aau route in App.tsx
- [x] Add AAU Basketball nav link in Home.tsx header
- [x] Add Barlow Condensed font to index.html
- [x] Run pnpm db:push for any schema changes
- [x] Restart dev server and verify

# Stripe Billing Integration

- [x] Create Stripe products/prices (Web Maintenance $300/mo)
- [x] Add webhook handler at /api/stripe/webhook with signature verification
- [x] Add billing tRPC routes (create customer, create subscription, create payment link, list clients)
- [x] Add admin billing dashboard page at /admin/billing
- [x] Wire up Stripe Customer Portal for client self-service
- [x] Add admin route protection (owner-only)
- [x] Test webhook with Stripe test events

# Stripe Billing Refinements

- [x] Add Checkout Session flow for subscription activation (return hosted checkout URL)
- [x] Add error UI states to /admin/billing for failed queries/mutations
- [x] Enforce owner-only access on billing routes (check openId against OWNER_OPEN_ID)

# Admin UX & Email Notifications

- [x] Add admin-only "Billing" link in site header (visible only when logged in as owner)
- [x] Set up Resend email notifications for payment failures and subscription cancellations

# Bug Fixes
- [x] Fix billing page owner access error (owner can't access their own billing dashboard)
- [x] Fix billing page header floating/overlapping content on mobile
- [x] Verify billing access works on production after deploy
- [x] Remove debug logging from ownerProcedure after confirming fix

# Webhook Handler Fix

- [x] Add detailed error logging (try/catch) around each step in handleCheckoutCompleted
- [x] Handle missing billing_clients row — auto-create client from Stripe customer data when checkout completes for unknown customer
- [x] Add error logging to all other webhook handlers (handleInvoicePaid, handleSubscriptionUpdated, etc.)
- [x] Wrap notifyOwner calls in try/catch to prevent TRPCError from crashing webhook handler
- [x] Write vitest tests for webhook handler (checkout.session.completed with and without existing client)
- [x] Clean up any remaining debug logging

# Navigation

- [x] Add back button/link on AAU page to navigate back to main landing page
- [x] Fix film section videos not playing in AAU page (redesigned with player-centric layout, 60 clips across 5 players)

# Film Section Optimization

- [x] Fix back button not visible on AAU page (made more prominent with pill background)
- [x] Mute all videos by default (page-level mute toggle, muted on load)
- [x] Add play summary/stats per player (aggregate play types, totals)
- [x] Optimize video layout — compact thumbnail grid instead of full-size cards (reduce scrolling)
- [x] Enhanced content: better browsing UX (compact grid with play labels, expandable lightbox modal on click)

# Film Section - Play Type Filtering

- [x] Add play type filter: clicking a play category pill filters the grid to only show clips of that type
- [x] Add "All" reset button to clear the filter
- [x] Show filtered clip count (e.g., "9 of 20 clips")
- [x] Visual highlight on active filter pill

# Landing Page Design Tightening

- [x] Hide AAU Basketball from main nav menu
- [x] Add AAU Basketball link to footer
- [x] Tighten spacing between all landing page sections (reduced from py-24/py-32 to py-16/py-20)

# Print Studio Integration (/studio)
## Phase 1: Database Schema
- [x] Add categories table to drizzle/schema.ts
- [x] Add tenants table to drizzle/schema.ts
- [x] Add memberships table to drizzle/schema.ts
- [x] Add credit_ledger table to drizzle/schema.ts
- [x] Add jobs table to drizzle/schema.ts
- [x] Add job_variations table to drizzle/schema.ts
- [x] Run pnpm db:push to sync schema

## Phase 2: Shared Modules & Server Middleware
- [x] Add shared/controls.ts (ControlSettings, buildInstruction, computeCredits)
- [x] Add shared/billing.ts (PLANS, TOPUP_PACKS, CREDIT_COST)
- [x] Add shared/domain.ts (emailAllowedForDomain)
- [x] Add server/tenancy.ts (tenantProcedure, tenantAdminProcedure)
- [x] Extend server/db.ts with tenant/membership/credit/job helpers (server/studioDb.ts)

## Phase 3: Server Routers & AI Engine
- [x] Add server/routers/tenants.ts
- [x] Add server/routers/studio.ts
- [x] Add server/routers/studioBilling.ts
- [x] Add server/aiEngine.ts (detectPrintElements, generateEditedImage)
- [x] Wire new routers into server/routers.ts appRouter

## Phase 4: Frontend Components & Pages
- [x] Add client/src/contexts/TenantContext.tsx
- [x] Add client/src/components/studio/AppShell.tsx
- [x] Add client/src/components/studio/ControlPanel.tsx
- [x] Add client/src/components/studio/PercentStepper.tsx
- [x] Add client/src/components/studio/BeforeAfter.tsx
- [x] Add client/src/pages/studio/StudioEditor.tsx
- [x] Add client/src/pages/studio/StudioHistory.tsx
- [x] Add client/src/pages/studio/StudioAdmin.tsx
- [x] Add client/src/pages/studio/StudioBilling.tsx

## Phase 5: Routing & Navigation
- [x] Add Protected wrapper and /studio routes in App.tsx
- [x] Add Studio link in landing page nav/footer (via StudioLayout gating)

## Phase 6: Stripe Billing for Studio
- [x] Add Studio Stripe products (Starter, Pro, Team, top-ups) via studioBilling router
- [x] Implement real checkout sessions in studioBilling router
- [x] Add webhook handlers for Studio subscription/top-up events

## Phase 7: Tests
- [x] Write vitest tests for controls (buildInstruction, computeCredits)
- [x] Write vitest tests for domain helpers
- [x] Write vitest tests for credit deduction logic

## Phase 8: Verify & Deliver
- [x] Verify build passes
- [x] Take screenshots of /studio pages
- [x] Save checkpoint

## Bug Fix: Image Generation Failure
- [x] Diagnose root cause: Image generation API returns 403 when fetching CloudFront signed URLs
- [x] Fix: Download image server-side and pass as base64 (b64Json) instead of URL
- [x] Verify fix with direct API test (200 OK, 7.6s, 1.4MB result)
- [x] TypeScript compilation clean
- [x] All 37 tests passing
- [x] Production build successful
- [x] Save checkpoint with fix

## Prompt Refinement: Textile & Fashion Terminology
- [x] Refine buildInstruction() in shared/controls.ts with textile-specific language
- [x] Refine element detection system prompt in server/aiEngine.ts with fashion terminology
- [x] Add a system-level image editing preamble for garment context
- [x] Test generation quality with refined prompts
- [x] Save checkpoint

## Color Recolor Control
- [x] Add RecolorControl interface and update ControlSettings in shared/controls.ts
- [x] Add recolor instruction builder logic with textile terminology
- [x] Update computeCredits to account for recolor control
- [x] Update ControlPanel UI with color picker and element selector for recolor
- [x] Update StudioEditor to pass recolor settings to generate mutation
- [x] Update studio router to handle recolor in the generate procedure
- [x] Update tests for buildInstruction and computeCredits with recolor
- [x] Verify build and test pass
- [x] Save checkpoint

## Critical Bug Fixes (User-reported Jun 19)
- [x] Fix AI generation producing rotated/blank results — add strict orientation and garment preservation constraints to prompts
- [x] Fix mobile horizontal scroll overflow in Before/After comparison viewer
- [x] Optimize upload speed — add client-side image compression before upload
- [x] Push to GitHub for Claude Code analysis

## Audit Fix: Timeouts & Size Validation
- [x] Add fetch timeout utility with AbortController
- [x] Add timeout to image download in generateEditedImage (30s)
- [x] Add timeout to generateImage API call (120s)
- [x] Add timeout to element detection signed URL fetch (via LLM retry)
- [x] Add server-side image size validation in upload procedure (reject > 16MB)
- [x] Add server-side image size check before base64 encoding in generateEditedImage (5MB)
- [x] Add MIME type validation in upload procedure (JPEG, PNG, WebP only)
- [x] Update tests and verify build
- [x] Save checkpoint

## Input Sanitization: Prompt Injection Prevention
- [x] Create shared sanitizeElementName utility (strip dangerous patterns, limit length)
- [x] Add Zod refinement in studio router for element name fields
- [x] Apply sanitization in buildInstruction before interpolation
- [x] Add tests for sanitization edge cases (injection attempts, unicode, special chars)
- [x] Verify build and all tests pass
- [x] Save checkpoint

## Rebrand: Favicon, Meta, Messaging & Navigation
- [x] Generate favicon.ico (16x16, 32x32, 48x48) from constellation logo
- [x] Generate apple-touch-icon.png (180x180) from logo
- [x] Create OG image (1200x630) with logo + brand name for social sharing
- [x] Update index.html with proper meta tags (og:image, apple-touch-icon, theme-color)
- [x] Update site title/description meta tags to reflect design studio positioning
- [x] Rebrand hero section messaging from "web development agency" to creative design studio
- [x] Update services section to reflect broader offerings (Print Design, Web Development, Brand Identity)
- [x] Add persistent top navigation menu with links to Home, Print Studio, Services, About, Contact
- [x] Ensure nav works on mobile with hamburger menu
- [x] Verify favicon shows in browser tab and bookmarks
- [x] Save checkpoint and push to GitHub

## AAU Access Control (Owner-Only)
- [x] Add backend protection: make AAU/leaderboard procedures owner-only (check ctx.user matches OWNER_OPEN_ID)
- [x] Add frontend guard: redirect non-owner users away from /aau
- [x] Hide AAU nav link in header and footer unless Frank is logged in
- [x] Verify build and tests pass
- [x] Save checkpoint

## Print Studio Audit Fixes (Claude Code Review - Jun 19)
- [x] Fix 3a: Add `gte` to drizzle-orm import in studioDb.ts
- [x] Fix 3b: Replace deductCredits with atomic transaction version
- [x] Fix 3c: Replace grantCredits with atomic transaction version
- [x] Fix 4a: Add stripeEvents table to drizzle/schema.ts
- [x] Fix 4b: Import stripeEvents in webhook.ts
- [x] Fix 4c: Add idempotency claim before switch(event.type)
- [x] Fix 4d: Release claim on failure in catch block
- [x] Fix 5a: Reject unsigned webhooks in production
- [x] Fix 5b: Gate evt_test_ bypass to non-production
- [x] Fix 1+7 Step A: Error-map deductCredits in studio.ts
- [x] Fix 1+7 Step B: Replace sequential loop with Promise.allSettled + pro-rated refund
- [x] Fix 2a: Add mysql2/promise import to db.ts
- [x] Fix 2b: Replace raw URL with connection pool
- [x] Fix 10: Trim extra newlines before OUTPUT REQUIREMENTS in controls.ts
- [x] Phase 1 Verification: pnpm install, db:push, check, test
- [x] Fix 9: Add 16MB input ceiling in imageCompress.ts
- [x] Fix 8: Add createImageBitmap EXIF orientation handling
- [x] Phase 2 Verification: pnpm check + pnpm test
- [x] Save checkpoint and push to GitHub

## Credit Ledger UI (Print Studio Dashboard)
- [x] Backend: Add tRPC query to fetch paginated credit ledger entries for a tenant
- [x] Frontend: Create CreditLedger page component with table, filters, and type badges
- [x] Navigation: Wire CreditLedger into Print Studio routes and sidebar/nav
- [x] Verification: pnpm check + pnpm test passing

## Park Variations Feature
- [x] Hide variations selector in UI, lock to 1 variation per generation

## Bug Fix + New Features
- [x] Fix: AAU Basketball page hooks ordering error (conditional hook calls)
- [x] Feature: CSV export button on Credit Ledger
- [x] Feature: Date-range filtering on Credit Ledger
- [x] Feature: Regenerate confirmation dialog in Print Studio editor

## Remove Control Prompt Fix
- [x] Fix: Improve 'Remove' control prompt to explicitly instruct AI to erase/delete elements, not redistribute them
- [x] Fix: Finish pending confirmation dialog TypeScript errors

## Credit Ledger Enhancements
- [x] Backend: Add search/query parameter to creditLedger tRPC query (filter by refId or note)
- [x] Frontend: Add search bar to Credit Ledger UI
- [x] Frontend: Improve pagination controls with page numbers and jump-to-page

## Per-Row Expand Feature (Credit Ledger)
- [x] Backend: Add metadata/note field to creditLedger query response (include generation prompt from jobs table)
- [x] Frontend: Add expandable row with animation showing full metadata on click

## History → Generation Archive Enhancements
- [x] Backend: Enhance history query to include job variations (result images), support search, status filter, pagination
- [x] Frontend: Before/After thumbnail comparison on each card
- [x] Frontend: Human-readable change description from parsed controls JSON
- [x] Frontend: One-click re-download button for result images
- [x] Frontend: Search bar (by title/element) and status filter
- [x] Frontend: Expanded detail view (modal or inline) with full prompt, controls, before/after
- [x] Frontend: Grid/List view toggle

## Generation Archive: Re-run, Batch Download, Favorites
- [x] Backend: Add jobFavorites table to schema
- [x] Backend: Add toggle favorite mutation + list favorites filter
- [x] Backend: Add re-run mutation (clone job with same settings)
- [x] Backend: Batch download handled client-side via fetch+JSZip (no server endpoint needed)
- [x] Frontend: Add star/pin toggle on each card and in detail modal
- [x] Frontend: Add "Favorites" filter option in the archive
- [x] Frontend: Add "Re-run" button in detail modal
- [x] Frontend: Add batch select mode with checkbox overlay + "Download ZIP" action bar
- [x] Verification: pnpm check + pnpm test passing

## Free Trial + Smart Billing Recommendation
- [x] Backend: Add trialStartedAt and trialCredits columns to tenants table
- [x] Backend: Initialize new tenants with 150 trial credits and trialStartedAt = now
- [x] Backend: Add usage analysis query (daily burn rate from credit ledger, days 4-7)
- [x] Backend: Add recommendation engine (map usage velocity to plan suggestion)
- [x] Backend: Add tRPC query for trial status + recommendation
- [x] Frontend: Trial status banner (days remaining, credits remaining)
- [x] Frontend: Smart recommendation banner starting day 4
- [x] Frontend: Trial expiry modal/gate blocking generation after day 7 or 0 credits
- [x] Frontend: "Choose a plan" CTA linking to billing page

## Side-by-Side Before/After with Synchronized Zoom
- [x] Replace slider-based BeforeAfter component with side-by-side layout
- [x] Add synchronized pan/zoom (pinch or scroll to zoom, drag to pan — both images move together)
- [x] Apply in StudioEditor results view and Generation Archive detail modal

## Scale & Density Prompt Improvements
- [x] Fix: Improve Scale prompt to be more explicit about physical size change of motifs
- [x] Fix: Improve Density prompt to be more explicit about removing/thinning motifs
- [x] Fix: Rewrite Scale prompt v2 — use textile terminology (ditsy/statement print, repeat scale) instead of math percentages; describe end-state visually

## Hybrid Scale Pipeline (SAM2 + Programmatic Resize)
- [x] Set up Replicate API token as project secret
- [x] Build server/replicateClient.ts — SAM2 segmentation via Replicate API
- [x] Build server/hybridScale.ts — full hybrid pipeline (SAM2 → programmatic resize → bg infill → composite)
- [x] Integrate hybrid pipeline into studio router (scale-only → hybrid, combined → AI)
- [x] Write tests for routing logic, scale factor math, and Replicate token validation (90 tests passing)

## Claude A1 Merge (deterministic recolor pipeline)
- [x] Fetch and review Claude's branch (claude/jolly-pascal-k9tw4r)
- [x] Copy masking interface (server/_core/masking/) — types, index, classical provider, sam2 stub, locateFabricRegion
- [x] Copy image decode (server/_core/image/decodeUpright.ts) — EXIF-aware decode with LRU cache
- [x] Copy A1 ops (server/_core/studio/ops/) — color.ts, kmeans.ts, membership.ts, separationRemap.ts
- [x] Copy eval harness (server/_core/studio/eval/) — metrics.ts, recolorEval.ts
- [x] Copy eval manifest and samples (eval/)
- [x] Copy spike scripts (scripts/spike/)
- [x] Copy all tests (separationRemap, masking, decodeUpright, metrics)
- [x] Update server/_core/env.ts with Studio env vars (STUDIO_NOOP_GUARD, STUDIO_MASK_PROVIDER, STUDIO_DETERMINISTIC_RECOLOR)
- [x] Install culori + @types/culori dependency
- [x] Verify TypeScript compiles cleanly (0 errors)
- [x] All 118 tests passing (13 test files)

## A1 Op Fix: Coverage Semantics + Metric Rewrite (per Claude's spec)
- [x] separationRemap.ts: Replace blend-strength weight curve with selection-tolerance (full remap inside T, thin antialias edge, skip outside)
- [x] metrics.ts: Switch target metric to change-based scoring (only score pixels the op actually remapped, ΔE(source,out) > delta)
- [x] metrics.ts: Split off-target into offTargetBackgroundDeltaE (membership==0) and offTargetFabricDeltaE (dFrom > far)
- [x] TypeScript compiles cleanly (0 errors)
- [x] All 118 tests pass (13 test files)
- [x] Synthetic eval: 4/4 PASS, all deterministic, targetΔE=0.11, lumSSIM=1.000, offΔE=0.00
- [x] Run eval on real garment photo (black-floral-skirt.jpg) — PASS at all coverage levels

## Truth-Mask Decoupling + SAM2 Eval
- [x] Pull Claude's truth-mask decoupling commits (0e94c53)
- [x] Generate SAM2 truth mask for black-floral-skirt via Replicate (meta/sam-2)
- [x] Run eval with truth mask: pink→navy PASS (offBg=1.18), blue→amber RASTER-NEEDED (offBg=2.14)
- [x] Verify structural blindness fix: no-truth case correctly shows "blind" instead of 0.00

## Full Claude Branch Merge (afac00a)
- [x] Merged A2 recolor live wiring (generateRecoloredImage + router gate + STUDIO_RECOLOR_LIVE flag)
- [x] Merged deterministic Scale op (scaleRepeat.ts + tile.ts + scaleMetrics.ts)
- [x] Merged deterministic Density op (densityThin.ts + infill.ts + stratifiedSelect.ts + densityMetrics.ts)
- [x] Merged SAM2 provider (sam2Provider.ts + replicateSam2.ts + sam2Mask.ts — full implementation)
- [x] Merged fromColor eyedropper picker in ControlPanel
- [x] Merged resolveTargetColorHex preset mapping
- [x] Merged describeExpectedChange + no-op guard (judgeEditApplied)
- [x] Merged cluster selection fix (separationRemap latest)
- [x] All 170 tests passing, TypeScript clean
- [x] All features dark-launched behind flags (defaults OFF)

## SAM2 Privacy Gate (4 Requirements)
- [x] Req 1: Crop-to-fabric minimization — only fabric bbox crop sent to Replicate, with full coordinate round-trip (remapRasterToFullImage + bbox re-normalization)
- [x] Req 2: org_id audit logging — structured log on every outbound SAM2 call (op, org_id, job_id, crop_dimensions, timestamp)
- [x] Req 3: Retention/sub-processor documentation (docs/replicate-sub-processor-disclosure.md)
- [x] Req 4: Fail-safe fallback — SAM2 → classical on infra error; getInstanceMasks returns empty array (D-B signal) when classical can't serve rasters
- [x] Fix: getInstanceMasks fail-safe returns empty array (D-B prompt-path fallback signal) when classical can't serve rasters
- [x] Privacy gate test suite (server/privacyGate.test.ts) — 8 tests covering all 4 requirements
- [x] All 178 tests passing, TypeScript clean

## Scale & Density Eval Runners
- [x] Build scaleEval.ts runner (manifest-driven, side-by-side PNGs, aggregate pass rates)
- [x] Build densityEval.ts runner (manifest-driven, side-by-side PNGs, aggregate pass rates)
- [x] Create sample manifests (scale.manifest.json, density.manifest.json)
- [x] Verify runners execute end-to-end on synthetic data
- [x] All 178 tests passing

## Density Live Wiring (D-C)
- [x] Add STUDIO_DENSITY_LIVE env flag to server/_core/env.ts
- [x] Build generateDensityImage helper in server/aiEngine.ts (SAM2 raster + instances → densityThin → PNG)
- [x] Add density-only detection in studio router (densityOnly + useDeterministicDensity)
- [x] Add density deterministic branch in variation generation loop (with D-B fallback)
- [x] Write densityLive.test.ts (5 tests: success path, URL signing, no-raster degradation, no-instances degradation, hard error propagation)
- [x] TypeScript compiles cleanly (0 errors)
- [x] All 183 tests passing

## Density D-B Fallback Fix
- [x] Fix: On provider degradation, reject + refund instead of falling through to prompt path (which produces garbage for count-based operations)
- [x] All 183 tests passing

## Test Fixes (env-aware assertions)
- [x] Fix masking.test.ts: Make "defaults to classical floor" test env-aware (respects STUDIO_MASK_PROVIDER)
- [x] Fix sam2 test: Skip "unavailable until provisioned" test when REPLICATE_API_TOKEN is set
- [x] Remove diagnostic console.log from studio.ts density gate (deferred until production confirmed)
- [x] Verify TypeScript compiles clean (0 errors)
- [x] All 184 tests pass (183 passed + 1 skipped)

## Architect Scale Flags (pre-live blockers)
- [x] Flag 1: Scale no-op refund parity — scalePrintRepeat signals `changed`, generateScaledImage refunds byte-identical results
- [x] Flag 2: Non-repeat guard — pre-deduct rejection when periodConfidence < threshold (honest message instead of tiling a logo)
- [x] Tests for both flags (10 scale tests + 5 repeatGuard tests, 208 total pass)

## Architect v3 Spec + PLANNED builds (2026-06-20)
- [x] Commit v3 STUDIO_OPS_SPEC.md (replaces blob 1053497f)
- [x] Remove stale non-repeat TODO in studio.ts
- [x] Build: scale 50-200 clamp (zod schema, mirrors density's 0-90)
- [x] Build: upscale DPI guard (pre-deduct, metadata-based enforce with warn fallback)
- [x] Build: NNI R >= 1.0 gate in densityMetrics (Clark & Evans 1954 + Donnelly boundary correction)
- [x] Build: min-feature advisory (non-blocking, checkScaleDownAdvisory in dpiGuard.ts)
- [x] Build: FFT + autocorrelation detector with labeled-garment calibration report (repeatDetector.ts, 10 tests)

## Production Logging
- [x] Add server_logs table (level, source, message, metadata JSON, jobId, tenantId, timestamp)
- [x] Create structured logger utility (serverLog.ts)
- [x] Wire logger into density, scale, recolor, and error paths in studio router
- [x] Add admin tRPC procedure to query logs (paginated, filterable by level/source/job/tenant/time/search)
- [x] Add Admin Logs page at /admin/logs (stats cards, filters, paginated log viewer, auto-refresh)

## Alert Hook & Log Retention
- [x] Wire error-level serverLog entries to trigger notifyOwner() (fire-and-forget, non-blocking)
- [x] Add log retention cleanup job: prune server_logs older than 30 days (Heartbeat cron at /api/scheduled/log-cleanup)
- [x] Write tests for alert hook (10 tests: notifyOwner called on error, not on info/warn/debug, crash-safe)
- [x] Write tests for log retention (6 tests: 30-day cutoff, DB unavailable, error propagation)

## Density Generation Fix
- [x] Fix SAM2 404: REPLICATE_SAM2_MODEL was set to bare slug 'meta/sam-2' causing SDK to hit deprecated /models/meta/sam-2/predictions endpoint; updated to 'meta/sam-2:fe97b453...' so SDK uses /predictions with version body

## Billing Screen Rebuild (Spec Screen 3)
- [x] Rebuild StudioBilling.tsx with role-gated views (owner/admin/member)
- [x] Add trial countdown card with progress track (amber gradient, days-left counter)
- [x] Add trial timeline card (Day 0/4/6/7 steps with done/now/future nodes)
- [x] Add payment method card (owner-only, links to Stripe portal)
- [x] Add credit packs section (owner-only purchase, visible to all)
- [x] Add subscription plans section (owner-only subscribe, visible to all)
- [x] Add "Start plan now" and "Cancel trial" actions (owner-only)
- [x] Gate billing management buttons by role (owner sees all, admin sees read-only, member sees balance only)
- [x] Add backend billingStatus procedure with trial + subscription + payment info
- [x] Write tests for role gating

## Platform Console (super_admin)
- [x] Add platform_admins table to schema + add type column to tenants
- [x] Create superAdminProcedure middleware (gates on platform_admins table)
- [x] Create server/routers/platform.ts with listAccounts, provisionFirm, inviteIndividual, grantCredits, impersonate
- [x] Wire platform router into appRouter
- [x] Build Platform Console UI page (/platform) with Firms/Individuals toggle
- [x] Add account list with status pills, plan, seats, balance (desktop table + mobile cards)
- [x] Add Provision Firm dialog (name, slug, plan, seats, credits, owner email, domain lock)
- [x] Add Invite Individual dialog (email, trial credits)
- [x] Add Grant Credits dialog (select account, amount, note)
- [x] Add Impersonate button (sets session context to target account, redirects to /studio)
- [x] Add /platform route to App.tsx with super_admin gate
- [x] Write tests for superAdminProcedure and platform procedures (9 tests, all pass)

## Firm Detail Admin Tab (Spec Screen 2)
- [x] Add backend: spendByMember query (ledger grouped by userId, last 7d and all-time)
- [x] Add backend: toggleRole mutation (promote/demote admin/member, blocks owner change)
- [x] Add backend: transferOwnership mutation (owner-only, reassigns owner badge, old owner→admin)
- [x] Add backend: updateDomainLock mutation (admin-only, set/clear allowedEmailDomain)
- [x] Add backend: removeMember mutation (admin-only, sets status=disabled, blocks owner removal)
- [x] Rebuild StudioAdmin.tsx with pooled balance + spent-7d metric cards
- [x] Add spend-by-member bar chart (horizontal bars, amber gradient, credits + percent)
- [x] Add members list with Admin toggle (amber switch), Owner badge locked, role badges
- [x] Add invite member card with domain hint + role selector (member/admin)
- [x] Add firm settings card (domain lock input + transfer ownership dropdown)
- [x] Gate: member sees 'Admin Access Required' shield, admin sees members/invite, owner sees transfer
- [x] Write tests for firmAdmin procedures (13 tests, all pass)

## Credit Ledger Per-Member Grouping
- [x] Add "Group by member" toggle button to the Credit Ledger header (Timeline | By Member pill toggle)
- [x] Create MemberGroupView component: spend bars per member with expandable transaction list
- [x] Reuse firmAdmin.spendByMember data for the bar chart, link to filtered transactions
- [x] Add userId filter to creditLedger backend query (listCreditLedger + studio router)
- [x] Show member avatar/name, amber spend bar, and collapsible recent 10 transactions per member
- [x] Maintain all existing filters (type, date range, search) in chronological view; grouped view uses spendByMember

## Impersonation Exit Banner
- [x] Create ImpersonationBanner component (persistent amber gradient bar, Eye icon, firm name + metadata, Exit button)
- [x] Wire into StudioLayout above AppShell (reads sessionStorage impersonate_tenant)
- [x] On Exit: clear sessionStorage, redirect to /platform
- [x] Responsive: truncates metadata on mobile, full info on desktop (z-60, sticky top-0)

## Trial Reminder Notifications (Day 4 + Day 6)
- [x] Create trialReminders.ts module: query tenants in trial at Day 4 and Day 6, send notifyOwner
- [x] Register /api/scheduled/trial-reminders endpoint in registerScheduledRoutes
- [x] Handler: find tenants where trialStartedAt puts them at Day 4 or Day 6 today, send notification per tenant
- [x] Notification content: Day 4 = "Trial halfway: X credits used, 3 days left"; Day 6 = "Trial ends tomorrow: card will be charged"
- [x] Idempotent: trial_reminders_sent table with (tenant_id, trial_day) unique key, INSERT IGNORE
- [x] Write tests for the reminder logic (10 tests, all pass)

## Server-Side Impersonation Token (superseded — see final section below)
- [x] Create impersonation JWT helper (sign/verify with JWT_SECRET, short TTL 2h, payload: superAdminId, targetTenantId)
- [x] Set impersonation cookie on platform impersonate mutation response (httpOnly, sameSite, secure)
- [x] Override tenant context in server when impersonation cookie present (inject targetTenantId)
- [x] Add exitImpersonation mutation to clear the cookie
- [x] Update ImpersonationBanner to call tRPC exit mutation instead of just clearing sessionStorage
- [x] Write tests for impersonation token sign/verify and context override

## Shadow Billing Reverse-Trial (superseded — see final section below)
- [x] Add stripeSetupIntentId and stripePaymentMethodId columns to tenants table
- [x] Create trial start flow: create Stripe SetupIntent, return client_secret to frontend
- [x] Backend: setupCardOnFile mutation in studioBilling router (owner-only)
- [x] On SetupIntent success webhook (setup_intent.succeeded): store PaymentMethod on tenant
- [x] Create /api/scheduled/trial-autocharge endpoint: find Day 7 tenants with stored PaymentMethod, create PaymentIntent
- [x] Handle charge failure: notify owner, extend trial 2 days, retry once
- [x] Write tests for shadow billing module

## Trial-to-Paid Conversion Webhook (superseded — see final section below)
- [x] Add payment_intent.succeeded handler to existing Stripe webhook endpoint
- [x] On successful Day 7 charge: set trialConvertedAt, set plan to starter, grant plan credits
- [x] Restore frozen credits on re-subscription within 90-day window
- [x] Send notifyOwner "Welcome — trial converted" notification
- [x] Handle edge cases: duplicate events via stripeEvents idempotency, missing tenant guard
- [x] Write tests for conversion logic

## Server-Side Impersonation Token
- [x] Create impersonation JWT helper (sign/verify with JWT_SECRET, short TTL 2h, payload: superAdminId, targetTenantId)
- [x] Set impersonation cookie on platform impersonate mutation response (httpOnly, sameSite, secure)
- [x] Override tenant context in server when impersonation cookie present (inject targetTenantId)
- [x] Add exitImpersonation mutation to clear the cookie
- [x] Update ImpersonationBanner to call tRPC exit mutation instead of just clearing sessionStorage
- [x] Write tests for impersonation token sign/verify and context override

## Shadow Billing Reverse-Trial (Org-Level, SetupIntent Day 0, Charge Day 7)
- [x] Add stripeSetupIntentId and stripePaymentMethodId columns to tenants table
- [x] Create trial start flow: create Stripe SetupIntent for tenant's Stripe Customer, return client_secret
- [x] Backend: setupCardOnFile mutation in studioBilling router (owner-only)
- [x] On setup_intent.succeeded webhook: store PaymentMethod on tenant row
- [x] Create /api/scheduled/trial-autocharge: find Day 7 tenants with stored PaymentMethod, create PaymentIntent off-session
- [x] Handle charge failure: notify owner, extend trial 2 days, retry once
- [x] One card per org — all members share the tenant's billing, owner/admin can update card
- [x] Write tests for shadow billing module (createOrgSetupIntent, handleSetupIntentSucceeded, cancelTrialAndFreezeCredits, restoreFrozenCreditsIfEligible, convertTrialToPaid)

## Trial-to-Paid Conversion Webhook
- [x] Add payment_intent.succeeded handler to existing Stripe webhook
- [x] On successful Day 7 charge: set trialConvertedAt, set plan to starter, grant plan credits
- [x] Restore frozen credits on re-subscription within 90-day window
- [x] Send notifyOwner "Welcome — trial converted" notification
- [x] Handle edge cases: duplicate events via stripeEvents idempotency, missing tenant guard
- [x] Write tests for conversion logic (covered in shadowBilling.test.ts)

## Heartbeat Cron Job Registration
- [x] Register /api/scheduled/trial-autocharge (daily 8am UTC) — task_uid: N4T7y66TLaYtVCTEfrrTXR
- [x] Register /api/scheduled/trial-reminders (daily 9am UTC) — task_uid: 8SPGdvarEaFz9KSHJyyL3w
- [x] Register /api/scheduled/log-cleanup (daily 3am UTC) — task_uid: N6TkTtm5F5fNGnDmmNaUNX

## Card-on-File UI (Stripe Elements in TrialCard)
- [x] Add @stripe/stripe-js and @stripe/react-stripe-js dependencies
- [x] Create CardOnFileForm component with Stripe Elements (SetupIntent confirmation)
- [x] Integrate CardOnFileForm into TrialCard (owner-only, shown during trial)
- [x] Show "Card saved" state when hasCardOnFile is true
- [x] Handle errors and loading states gracefully
- [x] Write vitest test for setupCardOnFile flow (covered in shadowBilling.test.ts)

## End-to-End Impersonation Flow
- [x] Verify platform.impersonationStatus query returns correct state
- [x] Verify ImpersonationBanner renders with firm metadata when impersonating
- [x] Verify Exit button calls exitImpersonation mutation and redirects to /platform
- [x] Verify TenantContext auto-selects impersonated tenant
- [x] Add smoke test (vitest) for impersonation round-trip (impersonationRoundtrip.test.ts — 13 tests)

## Replace History Page with Hybrid V2
- [x] Replace StudioHistory with StudioHistoryV2 as the main /studio/history route
- [x] Remove the /studio/history-v2 temporary route
- [x] Clean up old StudioHistory.tsx file (archived as StudioHistoryLegacy.tsx)
- [x] Sidebar nav link unchanged (already points to /studio/history)

## Full History Page Redesign (10/10 Experience)

### Backend Enhancements
- [x] Add user name join to historyArchive query (show who created each job)
- [x] Add date range filter (startDate/endDate) to historyArchive
- [x] Add historyStats summary endpoint (total jobs, credits spent, success rate, most active type)
- [x] Add "Created by" member filter option

### Recent Strip (Hero Section)
- [x] Show last 8-12 completed jobs as large cards with hover before/after reveal
- [x] Type badge (Recolor/Scale/Density/Remove) with color coding
- [x] Hover: smooth crossfade between original and result
- [x] Click: opens detail slideshow at that position

### Archive Section
- [x] Tabular layout with inline before/after thumbnail comparison
- [x] Column: Preview (hover-expandable), Title, Type (pill), Changes, Created by (avatar+name), Date, Credits, Status, Actions
- [x] Search with debounce across title, elements, prompt text
- [x] Filter: Status (All/Done/Failed/Processing), Type (All/Recolor/Scale/Density/Remove), Date range picker, Created by member
- [x] Sort: Date (newest/oldest), Credits (high/low), Title (A-Z)
- [x] Pagination with "Showing X-Y of Z" and prev/next + page numbers

### Detail Slideshow (Full-Screen Modal)
- [x] Full-screen overlay with before/after side-by-side comparison
- [x] Arrow keys / swipe to navigate between jobs
- [x] Metadata panel: timestamp, credits used, changes applied, detected elements, user
- [x] Actions: Download, Favorite
- [x] Keyboard: Esc to close, ←/→ to navigate, F to favorite, Space to toggle

### Batch Operations
- [x] Multi-select mode with checkboxes
- [x] Batch favorite/unfavorite
- [x] Select all on current page

### Stats Dashboard (Top Cards)
- [x] Total generations count
- [x] Credits spent (all time)
- [x] Success rate percentage
- [x] Most used edit type

### Micro-interactions & Polish
- [x] Smooth staggered entrance animation for table rows (fadeIn with delay)
- [x] Hover: thumbnail scales up with shadow
- [x] Type badge color coding per edit type
- [x] Status badge pulse for "processing" items
- [x] Empty state with illustration and CTA to Editor
- [x] Skeleton loading states for strip and table
- [x] Responsive: mobile collapses to card list, desktop shows full table

## Batch ZIP Download (History Page)
- [x] Add JSZip dependency (already installed)
- [x] Implement batch download function (fetch images, zip, trigger download)
- [x] Add "Download ZIP" button to batch selection action bar
- [x] Show progress indicator during download/zip creation ("Fetching X/Y..." → "Compressing...")
- [x] Handle errors gracefully (skip failed fetches, toast notification with count)

## PDF Lookbook Export (History Page)
- [x] Install jsPDF dependency for client-side PDF generation
- [x] Create lookbook PDF generator utility (branded cover, before/after pages, metadata) — client/src/lib/lookbookPdf.ts
- [x] Add "Generate Lookbook" button to batch selection action bar
- [x] Show progress indicator during PDF generation (stage-based: Preparing → Fetching → Compressing)
- [x] Include: cover page with logo/date/tenant name, one landscape spread per item (before/after side-by-side), edit type badge, changes, credits, user attribution
- [x] Handle errors gracefully (skip failed image fetches, toast notification)

## Lookbook Pre-Generation Dialog
- [x] Add dialog component with title, subtitle, and client name fields (shadcn Dialog + Input + Label)
- [x] Pre-fill with sensible defaults ("Design Lookbook", item count + month/year, org name placeholder)
- [x] Wire "Lookbook PDF" button to open dialog instead of generating immediately
- [x] Pass custom values to generateLookbookPdf on confirm
- [x] Add cancel button to dismiss without generating

## Density Pipeline Fix (SAM2 Fabric Raster + Giant Instance Filter)
- [x] Diagnosed root cause: combined_mask too sparse (2.6%) + giant background instance covering everything
- [x] Fix fabricFromSegment: use full crop bbox as fabric raster (not sparse combined_mask)
- [x] Fix instancesFromSegment: filter out instances > 20% of crop area (background, not motifs)
- [x] Verified: 30% test removes 63 motifs, 60% test removes 126 motifs
- [x] Diff visualization confirms clean infill with correct base-cloth color
- [x] All 347 tests pass after the fix

## Density UI Bug Fixes
- [x] Fix PercentStepper iOS Safari validation error (change type=number to type=text inputMode=numeric pattern=[0-9]*)
- [x] Fix density gateway timeout: convert generate mutation to async job pattern (start → poll → complete)
- [x] Add jobStatus query endpoint for polling job completion (reuse existing getJob)
- [x] Update StudioEditor frontend to poll for job completion instead of awaiting mutation directly
- [x] Show progress UI during async density generation (processing state with estimated time)
- [x] Run all tests and save checkpoint

## Processing Screen UX Enhancements
- [x] Add elapsed timer (counting up from 0s) to the processing screen
- [x] Add dynamic progress bar with estimated completion (based on typical 30-60s duration)
- [x] Smooth animation on progress bar and timer updates

## History Mobile UX Improvements
- [x] Add filter bar (status + type dropdowns) to mobile MobileCardList
- [x] Add search input to mobile archive
- [x] Fix detail slideshow header overflow on mobile (text overlapping)
- [x] Improve mobile detail view layout for small screens
- [x] Add "Favorites only" toggle to mobile filter panel
- [x] Persist filter state in URL params (search, status, type, favorites, page) for both desktop and mobile archive

## Invite Links & Admin UX Overhaul
- [x] Create invite_links table schema (token, type, metadata, expiry, status, usage tracking)
- [x] Add backend procedures: createInviteLink, getInviteLink, redeemInviteLink, listInviteLinks, revokeInviteLink
- [x] Build /join/:token self-service signup page (OAuth → auto-provision)
- [x] Unified "Add Account" dialog in Platform Console (firm/individual + create-now or generate-link)
- [x] Invite Dashboard section in Platform Console (list all links with status)
- [x] Add "Copy Invite Link" button in Studio Admin alongside email invite
- [x] Mobile-optimized for all new screens

## Fix Density Container Shutdown (SSE Keep-Alive)
- [x] Replace fire-and-forget async pattern with SSE streaming endpoint for density/scale
- [x] Send periodic heartbeat events to keep serverless container alive during SAM2 processing
- [x] Update frontend to consume SSE stream (progress events → completion event)
- [x] Handle error/timeout gracefully with refund on SSE stream
- [x] Fix 3 stuck processing jobs (360001, 420001, 420002) and refund 30 credits
- [x] Extract runVariation to shared studioEngine module
- [x] Add vitest tests for SSE endpoint (6 tests passing)

## Fix Density Applying to Subsection Only (Not Full Garment)
- [x] Change locateFabricRegion prompt to detect the ENTIRE visible printed fabric area (not just the "best sample region")
- [x] Add bbox expansion/padding (5% on each side) to ensure full garment coverage
- [x] Update default fallback from center-crop (40%) to full-garment (90%)
- [x] Update masking tests for new expansion behavior
- [x] Verify densityThin operates on all detected instances across the full garment

## SSE Proxy Buffering Fixes (Deploy to Production)
- [x] Merge user_github/main into origin/main (resolve 30-commit divergence)
- [x] req.socket.setTimeout(0) — disable Node.js 2-min socket timeout
- [x] res.flushHeaders() — flush headers immediately for GCL proxy
- [x] 2KB padding comment — push past proxy buffering threshold
- [x] Heartbeat reduced from 5s to 3s — stay within proxy idle timeout
- [x] res.flush() after every res.write() in sendSSE
- [x] Frontend buffer parser fix (process remaining buffer when stream ends)
- [x] Per-attempt deductRef (job-N-aN) — prevents duplicate-free-generation bug
- [x] signal: AbortSignal passed to runVariation for client disconnect
- [x] All 407 tests pass, TypeScript clean

## Density Reduction Safeguards
- [x] Minimum area threshold: auto-expand bbox to full garment if LLM returns < 35% (general) or < 40% (density)
- [x] Instance count sanity check: warn if SAM2 detects < 5 instances in large bbox (> 50% area)
- [x] Bbox logging: log returned bbox dimensions + area + confidence on every density job
- [x] Separate density-specific locator (locateFabricRegionForDensity): aggressive full-coverage prompt, stricter threshold

## Super Admin Navigation + Domain Lock Fix
- [x] Add super_admin nav link from studio header to /platform
- [x] Add "Back to Studio" link on Platform Console
- [x] Make Domain Lock read-only for tenant admins (only platform super_admin can change)

## Housekeeping (Jun 22)
- [x] Update cronSecret.test.ts to reflect authorized live posture (STUDIO_DENSITY_REDISTRIBUTE=true)
- [x] Delete stale GitHub branches (jolly-pascal-k9tw4r, print-studio-build-r8k25e, consolidate-followup, compassionate-ramanujan-7qs8px)
- [x] Verify async generation smoke test readiness on production

## 60s Timeout Diagnosis & Fix (Jun 22)
- [x] Diagnose 60s timeout: root cause is STUDIO_ASYNC_JOBS=false (SSE path killed by platform 60s cap)
- [x] Manually reap 16 stuck jobs and refund 160 credits
- [x] Add DB-persisted error logging to reaper and poll-predictions cron endpoints
- [x] SETTINGS FIX NEEDED: Set STUDIO_ASYNC_JOBS=true in Settings → Secrets
- [x] SETTINGS FIX NEEDED: Set STUDIO_DENSITY_REDISTRIBUTE=true in Settings → Secrets
- [x] Investigate why reaper cron is failing silently — ROOT CAUSE: cronSecretOk rejects platform requests (no x-cron-secret header sent)
- [x] Fix cronAuth.ts to accept x-webdev-schedule-uid header from Manus Heartbeat platform
- [x] Investigate redistribute output quality (white space in result instead of proper motif redistribution)

## Option B Dual-Mask Fix for densityRedistribute (Jun 22)
- [x] Update FabricMask type to include optional boundaryMask (seg.combined garment silhouette)
- [x] Update sam2Provider fabricFromSegment to extract seg.combined as boundaryMask
- [x] Update densityRedistribute to use boundaryMask for blueNoiseLayout constraints
- [x] Update densityRedistribute compositing clip to use boundaryMask
- [x] Preserve v1 densityThin behavior (uses full-crop sampling mask unchanged)
- [x] Run tests and verify no regression

## Poll-Predictions Cron Fix (Jun 22)
- [x] Diagnose: listSam2ProcessingJobs returns [] despite jobs existing in sam2_processing status
- [x] Root cause: Drizzle eq() on MySQL enums silently returns empty in serverless (TiDB + Autoscale); inArray() works
- [x] Fix: Replace eq(jobs.status, "sam2_processing") with inArray(jobs.status, ["sam2_processing"]) — mirrors working reaper pattern
- [x] Add diagnostic logging to poll-predictions handler (log found job IDs and processAsyncJob outcomes)
- [x] TypeScript compiles cleanly, all tests pass

## Real-Time Pipeline Progress Bar (Jun 22)
- [x] Server: Add `progress` SSE event type with stage info (segmenting → analyzing → processing → compositing → finalizing)
- [x] Server: Emit progress events at key points in runVariation (before SAM2, after SAM2, during CPU work, before persist)
- [x] Client: Extend useGenerateStream to handle `progress` event type with stage + percent data
- [x] Client: Build multi-stage pipeline progress bar component with labeled steps and animated transitions
- [x] Client: Replace time-based fake progress with real pipeline stage tracking in StudioEditor processing view
- [x] Client: Show current stage label, elapsed time, and stage-aware progress percentage
- [x] Mobile: Ensure progress bar renders well on small screens
- [x] Tests: Verify TypeScript compiles cleanly and existing tests pass (514 passed)

## Intermediate Preview Thumbnails in Progress View (Jun 22)
- [x] Server: Extend onProgress callback to accept optional previewUrl (base64 data URL for small thumbnails)
- [x] Server: Generate compositing preview (low-res thumbnail of result before final S3 persist)
- [x] Client: Extend SSE progress event to carry optional previewUrl field
- [x] Client: Update PipelineProgress to display filmstrip with original + stage previews
- [x] Client: Animate thumbnail appearance with fade-in/zoom-in transitions + click-to-zoom modal
- [x] Mobile: Thumbnails scale 16x16→20x20 with responsive layout and overflow scroll
- [x] Tests: TypeScript compiles cleanly, all 514 tests pass
