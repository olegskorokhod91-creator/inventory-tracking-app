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
}
