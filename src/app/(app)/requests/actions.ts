"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";

// Whole-batch and partial-item "mark ordered" are the same action - the
// checklist defaults every still-open item to checked, so submitting
// without unchecking anything is "mark the whole batch," and unchecking
// whatever wasn't actually bought this trip is the partial case. One form,
// no separate buttons.
export async function markRequestsOrdered(batchId: string, formData: FormData) {
  await requireAdmin();

  const retailerId = String(formData.get("retailer_id") ?? "");
  const requestIds = formData.getAll("request_ids").map(String);
  if (!retailerId || requestIds.length === 0) return;

  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_supply_requests_ordered", {
    p_batch_id: batchId,
    p_request_ids: requestIds,
    p_retailer_id: retailerId,
  });

  if (error) {
    console.error("mark_supply_requests_ordered failed:", error);
    return;
  }

  revalidatePath("/requests");
  revalidatePath("/orders");
  // The nav badge (open batch count) lives in the shared (app)/layout.tsx.
  // '/' resolves through a separate root page *outside* the (app) route
  // group, so revalidating it never touches that layout - has to be a path
  // actually inside the group, with type 'layout' to bust the layout
  // itself rather than just this one page.
  revalidatePath("/requests", "layout");
}

// Stopgap for items stuck "Ordered" from before the reconcile-invoice
// checklist actually pre-checked plausible matches (it claimed to but
// didn't - see ReconcileForm.tsx) - those items are already tied to a
// real, invoiced order via ordered_order_id, so this just records that
// same order as the one that resolved the request instead of making the
// admin redo the whole PDF reconciliation to fix the checkbox.
export async function markRequestResolved(requestId: string) {
  await requireAdmin();

  const supabase = await createClient();
  const { data: request } = await supabase
    .from("supply_requests")
    .select("ordered_order_id")
    .eq("id", requestId)
    .single();

  if (!request?.ordered_order_id) return;

  const { error } = await supabase
    .from("supply_requests")
    .update({
      resolved_by_order_id: request.ordered_order_id,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", requestId);

  if (error) {
    console.error("markRequestResolved failed:", error);
    return;
  }

  revalidatePath("/requests");
  revalidatePath("/requests", "layout");
}

// One-click version of the same stopgap, scoped to a whole batch - clicking
// "Mark resolved" on every stuck item individually doesn't actually solve
// the tedium the checklist bug caused in the first place. Only resolves
// items whose ordered_order_id points to a *real, fully-reconciled* order
// (order_number is not null) - a request-fulfillment placeholder order
// ("Ordered — Awaiting Confirmation", order_number still null) hasn't
// actually gone through invoice reconciliation yet, so marking those
// resolved would hide requests that genuinely aren't done.
export async function markBatchResolved(batchId: string) {
  await requireAdmin();

  const supabase = await createClient();
  const { data: requests } = await supabase
    .from("supply_requests")
    .select("id, ordered_order_id, orders:ordered_order_id(order_number)")
    .eq("batch_id", batchId)
    .is("resolved_by_order_id", null)
    .not("ordered_order_id", "is", null)
    .returns<{ id: string; ordered_order_id: string; orders: { order_number: string | null } | null }[]>();

  const resolvable = (requests ?? []).filter((r) => r.orders?.order_number);
  if (resolvable.length === 0) return;

  const resolvedAt = new Date().toISOString();
  // resolved_by_order_id varies per row (an item's own ordered_order_id),
  // so this can't be one shared-value bulk update - one update per row,
  // run concurrently since they're independent rows.
  const results = await Promise.all(
    resolvable.map((r) =>
      supabase
        .from("supply_requests")
        .update({ resolved_by_order_id: r.ordered_order_id, resolved_at: resolvedAt })
        .eq("id", r.id),
    ),
  );
  const firstError = results.find((r) => r.error)?.error;
  if (firstError) {
    console.error("markBatchResolved failed:", firstError);
    return;
  }

  revalidatePath("/requests");
  revalidatePath("/requests", "layout");
}
