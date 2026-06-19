
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
