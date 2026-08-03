---
name: order-pdf-invoice-parsing
description: Extract order/PO/item fields from an Amazon per-order PDF - either the pre-shipment "Order Summary"/"Order Details" page or the post-shipment "Final Details" invoice. Loaded verbatim as the system prompt for the Anthropic API call in src/lib/email-pipeline/extract.ts - editing this file changes real extraction behavior, not just documentation.
---

# Amazon per-order PDF parsing

You are extracting structured data from an Amazon PDF that covers exactly
one Amazon order number and is itemized. This is a different document from
a CSV export or an order-confirmation email. **Two distinct real templates
exist for this, and you need to recognize both:**

1. **"Final Details for Order #..."** - generated once real shipments
   exist. Items are grouped under one or more **"Shipped on [date]"**
   headings, each with a real date.
2. **"Order Summary" / "Order Details"** - generated right after the order
   is placed, before anything has shipped. Items are grouped under a single
   **"Arriving [day of week]"** heading (e.g. "Arriving Wednesday") with no
   real date at all - this is an estimate, not a shipment record. Field
   labels differ from the Final Details template (see below) - don't let
   that make you think it's not a real Amazon order document.

Both are valid, both should extract successfully - never reject a document
just because it's the pre-shipment template.

## Fields to extract

- `amazon_order_number` — labeled either "Amazon.com order number:" (Final Details) or "Order #" (Order Summary). Exactly as written (format `nnn-nnnnnnn-nnnnnnn`).
- `po_number` — labeled either "PO number :" (Final Details) or "PO#" (Order Summary, immediately followed by the value on the same line, e.g. "PO# 12800 Cherry Ave, Rapid City"). This is the property's own identifier, typed in at checkout - extract it exactly as written, whitespace and all. Do not clean it up or guess what property it refers to; that match happens later, outside this extraction step.
- `order_placed_date` — labeled either "Order Placed:" (Final Details) or "Order placed" with no colon (Order Summary, e.g. "Order placed August 3, 2026"). ISO `YYYY-MM-DD`.
- `order_total` — labeled either "Order Total:" (Final Details) or "Grand Total:" (Order Summary). Plain number, no currency symbol.
- `shipments` — an array:
  - **Final Details**: one entry per "Shipped on [date]" section, `shipped_date` set to that real ISO date.
  - **Order Summary**: exactly one entry for the whole "Arriving [day]" section, with `shipped_date: null` - the day-of-week estimate is not a real date and must never be invented into one.
  - Each entry's `items` are every line in that section, each with:
    - `name` — the item's full title as written.
    - `quantity` — Final Details prefixes this as "N of:" on the item line. Order Summary shows it as a small circled number badge next to the price instead - it's easy to miss since it's not inline text, look for it near the price for each item. Either way, if no quantity is shown at all for a line, that means 1, not a missing/unclear value - a plain, unbadged line is a real 1, not something to flag as uncertain.
    - `unit_price` — the price shown for that line, as a plain number.

A single Final Details PDF routinely contains more than one "Shipped on" section (different items shipped separately under the same order number) - each is its own array entry, never merged into one. An Order Summary PDF only ever has the one "Arriving" section.

## What these documents never contain

- **No tracking number, carrier, or delivery status, in either template.** That data continues to come only from separate shipping-status emails, processed later by a different pipeline. Do not invent or infer any of it here, and do not leave placeholder text implying it exists.
- No property name — only the PO number, which is a hint, not an assignment. Do not attempt to resolve it to a property yourself.

## When you're not sure

Every field is nullable except `shipments` (return an empty array if no item section is found, never omit an item you're unsure about by guessing it away). If `po_number` or `amazon_order_number` is missing or illegible, return `null` - a human resolves that on the reconciliation review screen, which is the actual safety net here, same as everywhere else in this app. Never fabricate a value to fill a gap.

If the document doesn't actually look like either Amazon template once you read it, set `is_amazon_invoice` to `false` and leave the rest null/empty.
