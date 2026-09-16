"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";

// Whole-batch and partial-item "mark ordered" are the same action - the
// checklist defaults every still-open item to checked, so submitting
// without unchecking anything is "mark the whole batch," and unchecking
// whatever wasn't actually bought this trip is the partial case. One form,
// no separate buttons.
//
// One click = done, immediately (product-owner-directed simplification):
// mark_supply_requests_ordered now stamps the order's package as
// confirmed_received/admin_manual and the requests as fully resolved in
// the same call - no separate confirmation, tracking, or "mark resolved"
// step exists anymore. Price is optional per item (input name
// `price_<requestId>`) - an admin can type it by hand here instead of
// ever touching PDF reconciliation; skipping it just leaves that item
// unpriced, same as before.
export async function markRequestsOrdered(batchId: string, formData: FormData) {
  await requireAdmin();

  const retailerId = String(formData.get("retailer_id") ?? "");
  const requestIds = formData.getAll("request_ids").map(String);
  if (!retailerId || requestIds.length === 0) return;

  const itemPrices: Record<string, string> = {};
  for (const requestId of requestIds) {
    const price = String(formData.get(`price_${requestId}`) ?? "").trim();
    if (price) itemPrices[requestId] = price;
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_supply_requests_ordered", {
    p_batch_id: batchId,
    p_request_ids: requestIds,
    p_retailer_id: retailerId,
    p_item_prices: itemPrices,
  });

  if (error) {
    console.error("mark_supply_requests_ordered failed:", error);
    return;
  }

  revalidatePath("/requests");
  revalidatePath("/orders");
  revalidatePath("/orders/past");
  revalidatePath("/reports/owner-billing");
  // The nav badge (open batch count) lives in the shared (app)/layout.tsx.
  // '/' resolves through a separate root page *outside* the (app) route
  // group, so revalidating it never touches that layout - has to be a path
  // actually inside the group, with type 'layout' to bust the layout
  // itself rather than just this one page.
  revalidatePath("/requests", "layout");
}
