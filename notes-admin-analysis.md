# Admin Architecture Analysis

## Current State

### Two Admin Levels
1. **Platform Console** (`/platform`) — super_admin only
   - Lists all Firms and Individuals (segmented tabs)
   - "Provision Firm" dialog: name, slug, plan, seats, credits, owner email, domain lock
   - "Invite Individual" dialog: email + trial credits
   - Grant Credits dialog (to any account)
   - Impersonate any account

2. **Studio Admin** (`/studio/admin`) — tenant-level admin (owner/admin of a firm)
   - Members list with role badges
   - Invite by email (validates domain lock, checks seat limit)
   - Firm Settings: domain lock, transfer ownership

### Gaps Identified
- **No self-service signup link** — admin must manually invite each person by email
- **No unified "Add Account" flow** — firm vs individual are separate dialogs with different fields
- **No invite link generation** — can't send a URL that lets someone sign up and auto-join
- **No org-level self-service onboarding** — can't send a link to an org owner to set up their own firm
- **Invite flow requires user to already exist** or creates a stub with userId=0
- **No batch invite** — must invite one at a time
- **No invite link expiry or tracking**

## Recommendations

### 1. Unified "Add Account" Flow (Platform Console)
Replace the two separate dialogs with a single smart dialog:
- Step 1: Choose type (Firm / Individual)
- Step 2: Fill details based on type
- Step 3: Choose delivery method:
  - "Create now" (admin fills everything)
  - "Send invite link" (generates a shareable URL)

### 2. Shareable Invite Links (New Feature)
- Generate a signed invite link with embedded metadata (type, plan, credits, org name)
- Link routes to `/join/:token` page
- Recipient signs in via OAuth, account is auto-provisioned
- Links can expire (configurable: 7d, 30d, never)
- Track: created, viewed, redeemed

### 3. Org Self-Service Setup Link
- Admin generates a "Setup your org" link for a firm
- Recipient signs in, becomes owner, can name their org, invite their own members
- Pre-configured: plan, seats, credits, domain lock

### 4. Simplified Studio Admin Invite
- Add "Copy invite link" button alongside email invite
- Link auto-joins the person to this specific tenant
- Respects domain lock and seat limits

### 5. Mobile-Friendly Platform Console
- Current desktop grid doesn't work well on mobile
- Already has mobile cards — good
