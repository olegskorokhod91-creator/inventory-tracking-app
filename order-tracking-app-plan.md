# Order Tracking App — Product & Technical Plan (Phase 1)

**Status:** M0 through M5 built and committed locally (see Section 16 for what each milestone actually delivered, including two milestones — M2.5, M3.5 — added mid-build beyond this document's original list). Not yet pushed to `origin/main` or deployed. This document is kept as the original pre-development advisory record; where the actual build diverged from what's recommended below, that's called out inline rather than silently edited away, so the reasoning trail stays intact. `CLAUDE.md` is the living day-to-day reference — check it first for current state.
**Purpose:** Advisory document to align on scope, architecture, and risk before build begins.

---

## 1. Summary of Understanding

You manage short-term rental properties and buy recurring supplies from Amazon, Walmart, Home Depot, Costco, and similar retailers. Right now nobody has a single place to see what was ordered, where it's going, when it should arrive, or whether it actually showed up correctly. Cleaners are the last line of defense — they're physically at the property — but they have no visibility into what to expect.

The app's job is narrow and specific: **track the lifecycle of a purchase from "ordered" to "confirmed received by a human at the right property,"** with packages tracked separately from orders (since one order can split into several shipments arriving on different days), and with a clear "requires attention" state for anything that doesn't resolve cleanly.

It is explicitly **not** an inventory system, a purchasing system, or an accounting system in Phase 1 — those are deliberately deferred.

---

## 2. Recommended Phase 1 Scope

**In scope:**
- Manual + email-forward order import, with AI-assisted extraction and a mandatory human review step
- Property-based organization of orders
- Order + package as separate entities, each with independent status
- Shipment/delivery status ingestion via forwarded emails, with a manual review queue for anything unmatched
- Active Orders view (mobile-first)
- Cleaner delivery confirmation flow (received/missing/partial/damaged/wrong item)
- Past Orders with search/filter
- Properties view showing everything in flight at that address
- Two roles: Administrator/Manager and Cleaner, enforced with real database-level access control
- Basic audit trail (who changed what, when, from what source)

**Explicitly out of scope for Phase 1** (matches your instruction, restated so it's easy to hold the line during development):
- Inventory counts, reorder points, or automatic purchasing
- Connected Gmail/Outlook inbox (see Section 3 — this is a deliberate downgrade from what you listed as an option, not an oversight)
- Retailer APIs (Amazon/Walmart) — see Section 3
- Native mobile app
- Analytics/reporting beyond basic filtering
- Chat/messaging features
- PMS or accounting integration

This scope is achievable by a small team without heroics. The risk in this project isn't the CRUD — it's the email-matching logic and the discipline to keep the status model simple. Both get dedicated sections below.

---

## 3. Best Order-Import Approach

**Recommendation: dedicated forwarding email address, with manual paste/screenshot/PDF as fallback. Do not connect Gmail/Outlook via OAuth in Phase 1.**

Here's the reasoning, including where I'm disagreeing with an option you listed:

### Why not connected inbox (even though you listed it)
Connecting a Gmail/Outlook inbox is the "automatic" option, but it's the wrong first move:
- It requires broad mail-read OAuth scope over an entire inbox, not just order emails. You flagged this exact risk yourself in the security section — connected inbox access is the highest-privacy-risk option on your list, and it's not necessary to hit your actual goal.
- It requires ongoing token refresh management, re-consent when scopes change, and a security review burden that's disproportionate to what Phase 1 needs.
- It requires classification logic to distinguish order emails from every other email in that inbox — a second AI/heuristic layer you don't need if you control what reaches the app in the first place.
- It creates a dependency on Google/Microsoft API policy and rate limits for a workflow that doesn't need real-time inbox polling.

### Why forwarding is the better fit
- It's push-based: an inbound email parsing service (e.g., Postmark Inbound, Mailgun Routes, or AWS SES receiving) turns "email arrives at orders@yourcompany.com" into a webhook with parsed sender, subject, body, and attachments. No polling, no OAuth, no token lifecycle.
- Only the emails you choose to forward ever touch the app — nothing else in the inbox is ever visible to it. That's a much easier privacy story for employees and for you.
- It's dramatically simpler to build and test. This is a real engineering-time difference, not a marginal one.

### The practical middle ground (do this)
You don't have to rely on someone remembering to manually forward every email. Set up a **mail rule/filter in whatever inbox management already uses** (Gmail filter or Outlook rule) that auto-forwards emails from known retailer domains (amazon.com, walmart.com, homedepot.com, costco.com, and carrier senders) to the app's dedicated address. This is a five-minute one-time setup with zero ongoing API relationship, and it gets you ~90% of the "automatic" benefit of a connected inbox for about 10% of the integration and privacy cost. This is what I'd actually build toward.

### Full comparison

| Method | Dev effort | Reliability | Privacy | Ongoing cost | Mobile UX | Verdict |
|---|---|---|---|---|---|---|
| **Email forwarding + auto-filter rule** | Low | High | High (opt-in, scoped) | Low ($ per inbound email, cents) | N/A (backend) | **Use for Phase 1** |
| Connected inbox (Gmail/Outlook OAuth) | High | High | Low (full inbox scope) | Low-medium | N/A | Defer — reconsider only if forwarding proves genuinely too manual after real use |
| Pasted email text | Low | Medium (user must copy correctly) | High | None | Poor on mobile (large paste) | Keep as fallback only |
| Screenshot upload | Low-medium (needs vision model) | Medium (formatting varies) | High | Per-image AI cost | Good on mobile | Keep as fallback, especially for Costco/Home Depot in-store receipts |
| PDF upload | Low-medium | Medium-high | High | Per-doc AI cost | OK on mobile | Keep as fallback |
| Pasted webpage/HTML | Medium | Low (page structure varies a lot) | High | Low | Poor on mobile | Not worth building for Phase 1 — screenshot covers this better |
| Retailer API (Amazon/Walmart) | Very high | N/A — doesn't practically exist for this use case | N/A | N/A | N/A | **Do not build.** See below. |
| Manual entry | Low | High (but slow) | High | None | Fine as last resort | Keep as universal fallback |

### On retailer APIs specifically
I checked current documentation before recommending against this, because "just use the API" is the instinct and it's wrong here:
- **Amazon** does not offer a practical order-tracking API for a normal buyer or business-purchasing account. There is an "Amazon Business API for Order History," but it's a B2B spend-analytics product that requires an approved Amazon Business account relationship, is scoped to Amazon Business orders specifically, and would do nothing for Walmart, Home Depot, or Costco. The Selling Partner API (SP-API) is for people *selling* on Amazon, not buying. Unofficial libraries exist that log in and scrape the order-history website; these violate Amazon's terms of service and are explicitly documented by their own maintainers as liable to break without warning whenever Amazon changes the page. That's not a foundation to build operational tooling on.
- **Walmart** is the same story: every public Walmart API (Marketplace, Supplier, GoLocal, Advertising) is for sellers and partners, not buyers. There is no public buyer-side order API.
- Home Depot and Costco don't have anything comparable either.

Email is genuinely the best available signal for these four retailers today — not a fallback you're settling for.

### Handling duplicates
Every inbound email gets a fingerprint (retailer + order number + email type, or a hash of message-ID if available). If a matching fingerprint already exists, the email is logged but not re-processed as a new order — this also naturally handles a retailer resending the same confirmation.

---

## 4. Best Shipping & Delivery-Status Update Approach

**Recommendation: forwarded status emails as the primary signal, with a carrier tracking API as a supplemental cross-check once a tracking number is known. Manual override always available.**

**Layer 1 — Forwarded status emails (primary).** Same inbound pipeline as order confirmations. Parse "shipped," "out for delivery," "delivered," "delayed," "cancelled" emails. Match to an existing order/package using, in priority order: (1) tracking number if present, (2) retailer order number, (3) as a last resort, a review-queue for anything that doesn't match confidently. Never auto-apply a low-confidence match — this matters more than it sounds like it should, because a wrong match silently corrupts two orders' history at once (the real one and the one it got attached to).

**Layer 2 — Carrier tracking API (supplemental, not primary).** Once you have a real tracking number, a tracking aggregator (e.g., AfterShip's tracking API or EasyPost) can query carrier scan events directly — this catches the case where a retailer's "delivered" email never arrives or arrives late, and gives you an independent confirmation source. These services typically have a free or low-cost tier (roughly $0–30/month) that comfortably covers the volume a small property-management operation would generate; I'd evaluate 2 vendors against a real month of your tracking numbers before committing. This is a nice-to-have that meaningfully increases reliability — I'd build it in Phase 1, but after the email pipeline is working, not before.

**Layer 3 — Manual status update.** Always available to admins for the cases nothing else catches (phone orders, in-person purchases, retailer email formats you haven't seen yet).

### Processing pipeline (as you described it — this is sound, I'm not simplifying it)
1. Identify retailer from sender domain
2. Extract order number and/or tracking number
3. Match to existing order/package
4. Update package status, record source + confidence
5. Route low-confidence matches to a review queue instead of applying them
6. Never create a duplicate order from a status-update email (status emails should only ever update, never create)

This is the one place in your spec where I'd push back on "keep it simple" — the match-confidence-queue is *not* overengineering. Silently misapplying a delivery update to the wrong order is worse than a manager spending 20 seconds a week resolving a handful of queue items. Skipping this step to save development time will cost you real operational trust in the tool.

---

## 5. Alternative Approaches — Advantages & Disadvantages

Covered in the table in Section 3, with the addition of what "not now" looks like for each deferred option:

- **Connected inbox:** revisit only if, after a few months of real use, the forwarding-filter approach is demonstrably too lossy (e.g., staff turnover keeps breaking the filter rule). Even then, scope it to a read-only label/folder rather than the whole inbox if Gmail/Outlook support that.
- **Retailer APIs:** revisit only if you formally become an Amazon Business customer at meaningful spend and want spend analytics — that's a different product goal than delivery tracking, and still wouldn't cover Walmart/Home Depot/Costco.
- **Webpage paste:** not worth building; screenshot upload covers the same need with far less parsing fragility.

---

## 6. How Orders Move from Active → Completed/Past

Your proposed model is close, and the underlying principle is correct: **an order should never leave Active status just because the retailer or carrier says "delivered."** That's the single most important behavioral rule in this app and I fully agree with it.

Where I'd simplify: your spec lists ~10 order-level statuses and ~13 package-level statuses maintained independently. That's a lot of surface area for the two to drift out of sync (e.g., an order marked "Shipped" while every one of its packages is actually "Delivered by carrier" — a bug waiting to happen). 

**Simpler alternative:** make **package status the single source of truth**, and compute order-level status as a derived rollup:

- If any package is `not_found`, `damaged`, `incorrect_items`, or `requires_attention` → order shows **Requires Attention** (this is a flag, not a rollup — see below)
- Else if any package is not yet `confirmed_received`/`cancelled` → order is **Active** (with a sub-label like "waiting on cleaner" or "in transit" derived from the least-resolved package)
- Else → order is **Completed**

`Requires Attention` should be an explicit boolean/flag on the order rather than a status enum value, so it can layer on top of any other state and can't get silently overwritten by a later status change. This gets you all the visibility your spec wants with one status table to maintain instead of two that can disagree with each other. Fewer states = fewer bugs = easier for a manager to reason about six months from now.

**Built (M2–M5):** exactly this shape, with one simplification beyond what's proposed above. Rather than three distinct package-level problem states (`not_found`/`damaged`/`incorrect_items`), the package_status enum collapsed all cleaner-reported problems into one value, `requires_attention` — the *specific* reason (package not found / items missing / incorrect quantity / wrong item / damaged / received-not-put-away) lives instead in a separate `package_confirmations.outcome` field, populated by M5's cleaner confirmation flow, not the package status itself. `orders.requires_attention` sat as a dead column (never set by anything) from M2 until M5 actually built the cleaner confirmation flow that produces it — a database trigger recomputes it from package state after every change, so application code never sets it directly and it can't drift out of sync the way three independent call-sites remembering to set the same flag by hand eventually would.

---

## 7. Recommended Mobile Application Format

**Recommendation: Progressive Web App (PWA), built as a responsive Next.js app that's installable to the home screen. Not a native app, not a hybrid framework.**

Why this is the right call for a small internal tool, and where I'd push back if you were leaning native:
- You have a small, known user base (your own cleaners and management) — you don't need app store discovery, so you lose nothing by skipping native app store distribution.
- One codebase instead of two (or a hybrid layer that fights you on native features). For a small team, that's the difference between shipping and not shipping.
- No app store review cycles blocking urgent fixes.
- Camera access for photo uploads works fine in a PWA on both iOS and Android via a standard file input with camera capture — you don't need native camera APIs for this use case.
- Installable to home screen satisfies your "installable as PWA if practical" requirement directly.

**One honest limitation to plan around:** iOS web push notifications require the user to have added the app to their home screen first, and iOS's implementation is more limited than native push (no rich notification actions, historically less reliable delivery). If your cleaners are on a mix of iPhones and Androids, plan for **in-app badges/lists as the primary "what needs my attention" mechanism**, with push notifications as a nice-to-have on top rather than the thing the workflow depends on. This is a real constraint, not a reason to go native — just something to design around (e.g., cleaners open the app each shift and see a clear "needs confirmation" list even if a push never fired).

---

## 8. Technology Stack Review

Your proposed stack — **Next.js, TypeScript, Supabase, Tailwind CSS, Vercel, Playwright** — is appropriate for this project. I'm not recommending changes to it; I'd only flag two operational risks to design around, not stack swaps:

1. **AI extraction calls can be slow (multi-second), and Vercel serverless functions have execution time limits.** Don't run order-extraction inline inside the request that handles an inbound email webhook. Instead: the webhook writes the raw email/attachment to storage and a queue row, and a background job (Supabase Edge Function, cron-triggered, or a lightweight queue table processed on a schedule) does the actual AI extraction and writes the review-screen draft. This keeps the webhook itself fast and reliable, and means a slow AI call never causes a dropped or duplicated email.
2. **Supabase Row Level Security (RLS) needs to be correct, not just present**, given cleaners must only see their assigned properties. This deserves its own review pass before launch (see Section 13) rather than being treated as a checkbox.

Additions worth making now, not swaps:
- **An inbound email provider** (Postmark or Mailgun are both solid; Postmark's inbound parsing is particularly easy to work with) for the forwarding pipeline in Section 3.
- **Supabase Storage** for screenshots/receipts/photos (already implied by your stack choice, no new tool needed).

I would not add a separate backend service, a state-management library beyond React's built-ins, or a queueing system heavier than a simple database table + scheduled function. All of those solve problems this app doesn't have yet.

---

## 9. Essential Claude Skills, Extensions, Plugins, and MCP Connections

**Essential for Phase 1:**

| Tool | What it does | Cost | Credentials needed | Risk | When |
|---|---|---|---|---|---|
| GitHub MCP | Repo operations (branches, PRs, issues) from Claude Code | Free | Personal access token, repo-scoped | Low if scoped to this repo only | Now |
| Playwright (already in your stack) | Browser-based e2e testing | Free | None | None | Now |
| Supabase CLI/migrations (local tooling, not necessarily an MCP) | Schema migrations, local dev DB | Free | Local/dev project key only | Low if never pointed at production | Now |

**Helpful but optional:**

| Tool | What it does | Cost | Credentials | Risk | When |
|---|---|---|---|---|---|
| Vercel MCP | Check deploy status/logs from Claude Code | Free tier available | Vercel token | Low | When deploys become frequent enough to be annoying to check manually |
| Error monitoring (e.g., Sentry) | Production error visibility | Free tier, paid at scale | DSN key (not secret-sensitive) | Low | Worth adding around Milestone 4–5, once real users hit the app |
| Supabase MCP (project-management level) | Direct schema/data operations from Claude Code | Free | Service role key | **Medium** — service role key bypasses RLS; only use against a dev/staging project, never production | Later, once you have a real dev environment separated from production |

**Not needed yet (and I'd actively avoid connecting these until you have a stated reason):**
- Gmail/Outlook connectors — not needed, since Phase 1 uses inbound forwarding, not connected inbox (Section 3)
- Carrier tracking API connector as an MCP — this is better as a plain server-side API integration than something Claude Code needs interactive access to
- Any general-purpose "screenshot/document analysis" plugin — this isn't a separate tool to install; it's Claude's built-in ability to read images and PDFs, called directly from your app's backend via the Anthropic API. Don't add a third-party OCR service on top of it for Phase 1.

**General principle:** every credential you connect to a coding assistant is a credential that assistant can act on unsupervised. Keep the essential list short, point anything with write access at dev/staging environments only, and add the "helpful" tier only when you actually feel the friction they solve.

---

## 10. Proposed User Workflows

**Manager adds an order (happy path):**
1. Order confirmation email auto-forwards from the retailer-domain filter (or manager forwards manually)
2. App extracts retailer, order #, items, quantities, price, expected delivery, tracking # (if present)
3. Manager opens the review screen, corrects anything wrong, assigns the property
4. Order appears in Active Orders for that property

**Shipment update arrives:**
1. Carrier/retailer sends a "shipped"/"delivered" email → auto-forwarded
2. App matches it to the order/package by tracking number or order number
3. Package status updates automatically; if match confidence is low, it goes to the review queue instead
4. Manager occasionally clears the review queue (should be rare if matching logic is solid)

**Cleaner confirms a delivery:**
1. Cleaner opens the app, sees "needs confirmation" for their assigned properties
2. Taps the order, sees expected items/quantities
3. One-tap "everything correct" for the common case, or selects a specific issue (missing/wrong/damaged/partial) with a quantity adjuster and optional photo
4. Order updates; if there's an issue, it's flagged Requires Attention for a manager

**Manager resolves an issue:**
1. Manager sees Requires Attention list
2. Reviews cleaner's note/photo, contacts retailer if needed, marks resolved (or requests reorder — manually, outside the app in Phase 1)

---

## 11. Proposed Database Structure

Kept intentionally flat — no premature abstraction for future inventory features (see Section 15 on that).

- **users** — id, name, email, role (admin/cleaner), active
- **properties** — id, name, address, status, notes
- **cleaner_property_assignments** — user_id, property_id
- **retailers** — id, name, domain (for email-sender matching)
- **orders** — id, retailer_id, property_id, order_number, order_date, total_amount, status (derived, see Section 6), requires_attention (bool), source (email/manual/screenshot/pdf), created_by
- **order_items** — id, order_id, name, expected_quantity, unit_price
- **packages** — id, order_id, tracking_number, carrier, status, expected_delivery_date, delivered_at, delivered_source (retailer_email/carrier_api/manual), confidence_score
- **package_items** — id, package_id, order_item_id, expected_quantity (an order item can be split across packages)
- **delivery_events** — id, package_id, event_type, event_source, event_timestamp, raw_payload_ref
- **imported_emails** — id, raw_email_ref (storage pointer, not full body duplicated everywhere), sender, subject, received_at, parsed_type, match_status
- **unmatched_updates** — id, imported_email_id, reason, resolved_by, resolved_at
- **cleaner_confirmations** — id, package_id, cleaner_id, confirmed_at, outcome (correct/missing/partial/wrong/damaged/not_put_away), notes
- **confirmation_item_results** — id, confirmation_id, order_item_id, received_quantity
- **photos** — id, confirmation_id, storage_ref, uploaded_at
- **activity_log** — id, entity_type, entity_id, actor (user or "system"), action, previous_value, new_value, timestamp, source, confidence (nullable)

**Future-proofing for inventory (minimum needed now, nothing more):** keep `order_items` referencing a normalized-ish `name` rather than a free-text blob per order, so a future `products` table can be introduced and backfilled without a painful migration. Don't build the `products` table yet — just don't make item names so unstructured that a future join is impossible.

**Built (M0–M5) — real differences from the table list above, not just naming:**
- `users` → Supabase `auth.users` + a `profiles` table (`id`, `name`, `role`, `active`) — `auth.users` already exists and holds credentials, no reason to duplicate that.
- `cleaner_confirmations` / `confirmation_item_results` / `photos` → `package_confirmations` (one row per confirmation attempt, any outcome — insert-only audit log) + `package_confirmation_items` (per-item actual quantity, captured regardless of outcome). No separate `photos` table: a confirmation has at most one photo in practice, so `package_confirmations.photo_path` is a plain nullable column, not a one-to-many join.
- **`delivery_events` and `activity_log` were never built.** Shipping-update emails update `packages` directly (no separate event log of every scan/status change), and there's no unified cross-entity audit table — `imported_emails`/`csv_imports`/`unmatched_updates` audit the pipeline side, `package_confirmations` audits the cleaner side, and `packages.delivered_source`/`confirmed_source`/`confirmed_by` record provenance for those two specific columns, but nothing ties it together the way Section 13 assumes `activity_log` does. Flagged as a real gap in `CLAUDE.md`, not silently dropped — worth a decision (build the unified log, or accept the scattered-per-table approach) before calling Phase 1 done.
- `orders.owner_id`/owner billing (M3.5) and `orders.retailer_order_status` (M3.5, raw CSV passthrough) aren't in the list above at all — added mid-build for the owner billing report milestone, which itself wasn't part of the original milestone plan in Section 16.
- `packages.confirmed_at`/`confirmed_source`/`confirmed_by` (M4/M5) parallel the existing `delivered_at`/`delivered_source` columns for the confirmed-received transition specifically, distinguishing an admin's manual override (`confirmed_source = 'admin_manual'`) from a real cleaner confirmation (`'cleaner_app'`).

---

## 12. Proposed Application Screens

**Shared:** Login, simple onboarding/property list

**Admin/Manager:**
- Dashboard (arriving today, delayed, requires attention — the "urgent glance" view)
- Active Orders (filterable by property)
- Order Review screen (post-AI-extraction correction + property assignment)
- Order Detail (full package/item breakdown, activity history)
- Unmatched Updates queue
- Past Orders (search/filter)
- Properties list → Property detail (everything in flight there)
- User/cleaner management, property assignment

**Cleaner:**
- My Properties → deliveries needing confirmation (this is effectively their home screen)
- Confirm Delivery screen (large buttons, quantity steppers, optional photo)
- Recently confirmed (their own recent activity, for reassurance/reference)

Cleaners never see a screen with pricing or company-wide spend, consistent with your role requirements.

**Built (M0–M5):** matches this closely, with two differences worth noting. First, "deliveries needing confirmation is effectively their home screen" was taken literally in the end — `/confirmations` is the actual post-login landing page for cleaners (not `/properties`), decided during M5 rather than left as just a prominent list within the properties view; `/properties` remains one tap away via nav for browsing by property directly. Second, there's no separate Active Orders "dashboard" route for admins — `/orders` itself was enhanced in place (needs-review section on top, an active-order sub-label added per M4) rather than building the standalone dashboard screen this section implies; a distinct search/filter-oriented view is planned for M6 (Past Orders) instead. The admin Order Detail screen also grew a "Confirmation history" section (M5) showing each cleaner confirmation's outcome, note, photo, and per-item actual-vs-expected — not explicitly listed above, but the natural place for a flagged order to actually be reviewable rather than just showing a red badge.

---

## 13. Security Requirements

- **RLS as the actual enforcement layer**, not just app-level role checks — cleaners' database access should be restricted to their assigned properties at the query level, so a bug in the UI can't leak another property's data.
- **Least-privilege email access:** inbound-only email processing (the forwarding model in Section 3) means you never hold a password or OAuth grant to a real inbox at all — this is a meaningful security simplification versus connected inbox, worth restating here.
- **Secure file storage:** screenshots/receipts/photos in Supabase Storage with access rules mirroring the RLS on the related order/property — a cleaner shouldn't be able to browse another property's photos by guessing a URL.
- **API key handling:** AI extraction, email-provider, and tracking-API keys live server-side only, never shipped to the client bundle.
- **Audit logging:** the `activity_log` table above covers this — every status change records actor, source, and confidence. **Not actually built (see Section 11/16) — this is currently only true per-feature**, not as a unified log: `imported_emails`/`csv_imports`/`unmatched_updates` cover the pipeline side, `package_confirmations` covers the cleaner-confirmation side, and `packages.delivered_source`/`confirmed_source`/`confirmed_by` cover provenance for those two columns specifically. Revisit before treating this requirement as satisfied.
- **Data retention:** define how long raw forwarded emails and screenshots are kept once an order is fully resolved (I'd suggest a default like 12–24 months, configurable) — this is a decision for you, not something I'd hard-code.
- **Dev vs. production separation:** separate Supabase projects for dev/staging vs. production, with Claude Code and any MCP tooling pointed only at dev by default, exactly as you specified. Production access should be a deliberate, separate step, not the default working environment.
- **Backups:** Supabase's built-in point-in-time recovery (on paid tiers) is sufficient for this scale — no custom backup tooling needed in Phase 1.

---

## 14. Likely Product & Technical Problems

| Problem | Phase 1 or later? | Simplest solution |
|---|---|---|
| Retailer changes email format | Phase 1 (will happen eventually) | AI extraction (not brittle regex) + mandatory human review screen before saving. Extraction failures degrade to "fill in manually," not silent bad data. |
| Tracking info missing from confirmation email | Phase 1 | Order still imports; package created without tracking number, status stays "Expected" until a later email or manual update supplies it |
| One order splits into multiple packages | Phase 1 (core requirement) | Package-level status model, already designed for this |
| Multiple orders share a tracking number (rare but happens, e.g., consolidated shipments) | Phase 1, handled by design | Match by tracking number *and* order number together where both are present; if ambiguous, route to review queue rather than guessing |
| Duplicate forwarded emails | Phase 1 | Fingerprint/dedupe logic in Section 3 |
| Retailer status ≠ carrier status | Phase 1 | This is exactly why "delivered by carrier" ≠ "confirmed by cleaner" is a hard rule, not a suggestion |
| Carrier marks delivered too early | Phase 1 | Cleaner confirmation is the actual source of truth; a false "delivered" just means the cleaner reports "not found" and it flags for attention |
| Package delivered to wrong location | Phase 1 | Cleaner reports "not found," flows into Requires Attention with notes/photo |
| Cleaner doesn't confirm delivery | Phase 1 | Simple reminder — see below, don't overbuild this |
| Cleaner confirms wrong order | Phase 1, mitigated not eliminated | Confirmation screen shows property + retailer + item photos/names clearly; can't fully prevent human error, only make it visible via audit log |
| Multiple cleaners at one property | Phase 1 | Any assigned cleaner can confirm; log records which one did |
| Partial quantities | Phase 1 (core requirement) | Per-item received-quantity field, already designed for this |
| Substituted products | Phase 1 | Covered by "wrong item received" outcome + note field |
| Cancelled/refunded items | Phase 1 | Status email updates package to Cancelled; order rollup accounts for it |
| AI extracts wrong quantity/price | Phase 1 | Mandatory review screen is the mitigation — never auto-save AI extraction without a human glance |
| Orders spanning multiple properties in one cart | Phase 1, needs a decision from you | Simplest approach: require splitting into per-property orders at review time if this happens, rather than building multi-property order support. Ask whoever places orders to check out separately per property if practical. |
| Manual purchases with no email (Costco/Home Depot in-store) | Phase 1 | This is exactly what screenshot/receipt-photo upload is for — treat it as the primary path for these two retailers, not a rare fallback |
| Notification overload | Phase 1, keep simple | A daily digest ("3 items need confirmation at Property X") beats granular per-event pushes — see next section |
| Poor internet at a property | Phase 1 | Keep the confirmation form lightweight, show clear loading/offline states, don't require large uploads to proceed (photo can be optional/retry) |

**On reminders specifically:** your spec asks for "a reasonable and simple reminder process without creating excessive notifications." I'd resist the urge to build a configurable rules engine here. Start with: if a package has been "delivered by carrier" for more than a set number of hours (e.g., 24) without cleaner confirmation, it appears in a daily digest to that cleaner and to the manager. That's it — no escalation tiers, no per-user notification preferences, in Phase 1. Add complexity only if real usage shows the simple version isn't enough.

---

## 15. Simpler Alternatives to Complicated Ideas — Summary

Consolidating the pushback from above so it's easy to reference:

1. **Connected Gmail/Outlook inbox → forwarding address + auto-filter rule.** Same practical outcome, far less privacy/security surface.
2. **Independent order-status and package-status enums → package status as source of truth, order status as a derived rollup + a separate Requires Attention flag.** Fewer states that can't drift out of sync.
3. **Retailer APIs → email-based ingestion.** The APIs you'd want don't actually exist for this use case; email is the primary source, not a fallback.
4. **Configurable reminder/escalation engine → a simple time-threshold daily digest.** Add sophistication only if the simple version proves insufficient in practice.
5. **Multi-property orders as a first-class case → ask for per-property checkout, handle the rare exception at review time.** Building true multi-property order-splitting is a lot of schema and UI complexity for an edge case you can mostly avoid operationally.
6. **Building inventory scaffolding now → don't.** The one preparation worth making is keeping item names reasonably normalized; everything else about inventory can be designed fresh when you actually build that phase, with real Phase 1 usage data informing it.

---

## 16. Milestone-Based Build Plan

- **M0 — Foundation:** repo setup, Next.js + Supabase + Tailwind scaffold, auth, RLS skeleton for the two roles, deployed to Vercel (empty-but-working). Playwright installed with one smoke test.
  ✅ **Done.** Local dev only — not yet deployed to Vercel.
- **M1 — Core entities:** Properties, users, cleaner-property assignments. Admin can create properties and assign cleaners. Basic screens, no orders yet.
  ✅ **Done.**
- **M2 — Manual order entry + review screen:** the "fallback" path is actually the fastest thing to build first, and it exercises the whole orders/items/packages schema without needing the email pipeline yet.
  ✅ **Done.** `orders`/`order_items`/`packages`/`package_items` schema, `create_manual_order` RPC, review screen.
- **M2.5 — Supply requests** *(added mid-build, not part of the original list above):* cleaner-initiated supply requests (item name, quantity, note), manually resolved by an admin via order creation — never auto-matched to a specific order.
  ✅ **Done.**
- **M3 — Email import pipeline:** inbound email provider wired up, webhook → storage → queue → AI extraction → review screen (reusing M2's review UI). Dedupe/fingerprint logic. Test against real sample order confirmations from your actual retailers.
  ✅ **Done.** Also picked up a second ingestion path not originally scoped to this milestone specifically: CSV import of the Amazon Business "Orders" report, sharing the same review screen and upsert logic (`upsert_order_from_pipeline`) as the email pipeline. `/unmatched-updates` review queue built alongside it, since both pipelines route low-confidence shipping-update matches there. The email classifier's heuristic is still unvalidated against a real Amazon confirmation/shipping email — see `CLAUDE.md` known gaps.
- **M3.5 — Owner billing report** *(added mid-build, not part of the original list above):* `owners` table, `properties.owner_id` (one owner, many properties), `/reports/owner-billing` with property/date/owner/retailer filters and owner-level rollup, CSV/Excel export. Excludes cancelled orders and refunded items from spend totals (checked against a real Amazon Business export: no refund signal exists in that data at all, so refunds are admin-marked, not auto-detected); flags — never silently includes — orders still requiring attention.
  ✅ **Done.**
- **M4 — Active Orders + package status + shipment-update matching:** the matching/confidence logic from Section 4, the unmatched-updates review queue, the Active Orders dashboard.
  ✅ **Done**, with the matching/confidence logic and unmatched-updates queue actually landing in M3 above (they were needed together with the email pipeline, not deferred to M4). What M4 actually added: an admin manual package-status-update UI (Layer 3 from Section 4 — tracking/carrier/status/expected-delivery, for cases the pipeline can't catch); multi-package support (a shipping-update email whose tracking number doesn't match any existing package on the order, where every existing package already has a *different* tracking number, now creates a second package row instead of overwriting the first and losing its tracking data — ambiguous no-tracking-number updates against multiple packages route to the unmatched-updates queue rather than guessing); and, rather than a separate Active Orders dashboard route, `/orders` was enhanced in place with a derived sub-label per active order (Delayed / Waiting on cleaner / In transit / Awaiting shipment / Attention needed) computed from its packages' least-resolved status.
- **M5 — Cleaner confirmation flow:** the mobile-first confirmation screens, quantity adjusters, photo upload, Requires Attention flagging.
  ✅ **Done.** `/confirmations` (list of packages delivered-but-not-confirmed across the cleaner's assigned properties, grouped by property) and `/confirmations/[packageId]` (expected items, a one-tap "everything correct" fast path, or one of six problem outcomes — package not found / items missing / incorrect quantity / wrong item / damaged / received-not-put-away — each revealing quantity steppers, an optional note, and an optional photo). `/confirmations` is the actual post-login landing page for cleaners, not just a prominent list (a deliberate decision, taking "effectively their home screen" literally — see Section 12). `requires_attention`, dead since M2, is now live: a database trigger recomputes it from package state after every confirmation, so application code never sets it directly. A second trigger restricts a cleaner's package update to exactly `status`/`confirmed_at`/`confirmed_source`/`confirmed_by`, and only into `confirmed_received`/`requires_attention` — enforced at the database level (not just the app UI), so a direct API call can't bypass it. First real use of Supabase Storage in this app (`confirmation-photos` bucket, private, RLS-scoped by property assignment); photos are capped at 5MB with client-side canvas-based compression before that check, so an oversized phone photo gets resized rather than rejected outright.
- **M6 — Past Orders + search/filter, activity history views.**
  Not yet started.
- **M7 — Carrier tracking API integration (supplemental signal) + the simple daily-digest reminder.**
  Not yet started.
- **M8 — Hardening pass:** RLS audit, PWA install/manifest polish, mobile performance pass on a real low-end phone, error monitoring wired in, data-retention job for old raw emails/screenshots.
  Not yet started. Note the `activity_log` gap surfaced in Section 11 — worth resolving before calling this pass complete, since it's what Section 13's audit-logging requirement currently assumes exists.

Each milestone should end in a working, demoable state and a git commit — nothing merges as "half a feature."

---

## 17. Draft CLAUDE.md

See the separate `CLAUDE.md` file — it's meant to be dropped directly into your repo root.

---

## 18. Risks, Limitations, and Decisions You Need to Make

**Open decisions (I've made a default recommendation for each, but they're yours to confirm):**

1. **Inbound email provider** — I'd default to Postmark (clean inbound-parse API, good docs) unless you already use SendGrid/Mailgun for something else.
2. **Carrier tracking API vendor** — evaluate AfterShip vs. EasyPost against a real batch of your tracking numbers before committing; pricing tiers vary by shipment volume and it's cheap to test both.
3. **Reminder threshold** — is 24 hours after "delivered by carrier" the right window before it shows up in the digest, or does your operation want something tighter/looser?
4. **Data retention period** for raw emails/screenshots — 12 months? 24? Indefinite (with a storage-cost tradeoff)?
5. **Multi-property carts** — how often does this actually happen today? If it's rare, the "split at review time" approach in Section 15 is fine; if it's common, we should talk about it before M2.
6. **Which retailer domains** to include in the initial auto-forward filter rule (confirm the exact sending domains you see for Amazon, Walmart, Home Depot, Costco order/shipping emails).
7. **Cleaner devices** — company-owned or BYOD? This affects how much you can rely on push notifications and whether there are any photo-privacy considerations worth documenting for cleaners.

**Known limitations to accept going in, not defects to fix later:**
- iOS PWA push notifications are less reliable than native — design the in-app "needs attention" list as the primary mechanism (Section 7).
- AI extraction will occasionally get something wrong — the review screen is the permanent safety net, not a launch-phase training-wheels step to remove later.
- The match-confidence queue will never hit zero — a small trickle of manual review is the correct steady state for an email-based system, not a bug.

I'd suggest starting at M0 once you've confirmed items 1–3 above, since they affect early schema/config choices.
