# CLAUDE.md

## Project

A mobile-first order tracking app for a short-term rental property management company. It tracks purchases (Amazon, Walmart, Home Depot, Costco, etc.) from order placement through cleaner-confirmed receipt at the correct property. Full context lives in `docs/order-tracking-app-plan.md` — read it before making architectural decisions.

## Non-negotiable product rules

- **An order never moves to Completed/Past just because a retailer or carrier says "delivered."** It stays Active until a cleaner confirms actual received quantities. This is the most important rule in the app — do not "simplify" it away.
- **Package status is the source of truth. Order status is a derived rollup**, plus a separate `requires_attention` flag. Do not add independent order-level status fields that can drift out of sync with package status.
- **Never auto-apply a low-confidence email match to an order.** Route it to the unmatched-updates review queue instead. Silently misapplying an update is worse than a manager clearing a small queue.
- **AI-extracted order data is never saved without a human review step.** The review screen is permanent, not a launch-phase shortcut.
- **Cleaners only ever see their assigned properties.** This must be enforced by Supabase RLS, not just app-layer checks.

## Scope discipline

Phase 1 is defined in `docs/order-tracking-app-plan.md`. Explicitly out of scope right now: inventory/reorder features, connected Gmail/Outlook inbox, retailer APIs, native mobile app, analytics beyond basic filters, chat features, PMS/accounting integration.

**If a task seems to require one of the above, stop and flag it instead of building around it.** Don't quietly add scope to solve a problem — surface the tradeoff first.

## Working style

- **Challenge complexity.** If an approach I ask for is unnecessarily complicated, unreliable, hard to maintain, or has a simpler alternative, say so explicitly before implementing it. Don't default to agreement.
- **Identify risks before implementing a feature.** Before writing code for a new feature, briefly state: what can fail, what data might be missing/malformed, what happens on partial success, and whether there's a simpler version that gets 90% of the value.
- **Stay in scope.** Don't refactor or touch files unrelated to the current task. If you notice something else that should change, mention it separately rather than folding it into the current change.
- **Explain database migrations before running them.** State what's changing, why, and whether it's backward-compatible, before applying a migration — even in the dev database.
- **Never point write-capable tooling (Supabase service role key, migrations, etc.) at the production project.** Dev/staging only unless a human explicitly says otherwise for a specific, one-time action.

## Testing requirements

- Every milestone (see plan doc, Section 16) should end in a working, demoable state with a passing Playwright smoke test for the new flow.
- Any change to the email-matching or status-rollup logic needs a test covering at least: a clean match, a low-confidence/ambiguous match (should route to review queue, not auto-apply), and a duplicate email (should not create a duplicate order).
- Mobile UI changes should be checked at a narrow viewport (~375px) before considering the task done — this app is mobile-first, and desktop-looking-fine is not sufficient.
- Run relevant tests and report results before declaring a task complete. Don't mark something done based on "it should work."

## Git discipline

- Commit after each working milestone, not mid-feature.
- Commit messages should state what changed and why in one line, not just "update files."
- Don't force-push over shared history.

## Reusable skills to create (see `.claude/skills/` or your skills directory)

- **order-email-parsing** — instructions for extracting retailer, order number, items, quantities, prices, expected delivery, and tracking info from order confirmation emails across Amazon/Walmart/Home Depot/Costco formats, with explicit guidance to flag low-confidence fields for human review rather than guessing.
- **shipment-update-parsing** — instructions for classifying and extracting data from shipping/delivery status emails (shipped, out for delivery, delivered, delayed, cancelled) and identifying the matching key (tracking number vs. order number).
- **screenshot-order-extraction** — vision-based extraction from screenshots/receipt photos, with guidance on handling partial/blurry images gracefully (flag for manual entry rather than fabricating data).
- **duplicate-order-detection** — fingerprinting logic and edge cases (resent confirmations, near-identical manual re-entries).
- **order-to-package-matching** — the confidence-scoring logic from the plan doc's Section 4; what counts as a confident match vs. what must go to the review queue.
- **db-migration-review** — checklist for reviewing a migration before it runs: backward compatibility, RLS policy impact, whether it touches production-adjacent config.
- **mobile-ui-review** — checklist for confirming a new/changed screen meets the mobile-first requirements (touch target size, no horizontal scroll, contrast, minimal typing).
- **access-control-review** — checklist for confirming a new feature respects the admin/cleaner RLS boundary before merging.
- **e2e-testing** — how to write and run the Playwright tests for this project's key flows (order import → review → active → confirmation → past).
- **bug-fixing** — reproduce first, write a failing test, fix, confirm the test passes, check for related cases.
- **release-readiness** — pre-deploy checklist: migrations explained and applied to dev first, tests passing, mobile check done, no secrets in client bundle.

Each skill file should be short and concrete — a checklist or a set of rules, not prose. Keep them scoped to their one job.
