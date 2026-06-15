
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
