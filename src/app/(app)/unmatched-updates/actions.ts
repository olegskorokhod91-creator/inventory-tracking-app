"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";

export async function resolveUnmatchedUpdate(updateId: string, formData: FormData) {
  const profile = await requireAdmin();

  const orderId = String(formData.get("order_id") ?? "");
  if (!orderId) return;

  const supabase = await createClient();

  const [{ data: update }, { data: order }] = await Promise.all([
    supabase
      .from("unmatched_updates")
      .select("extracted_tracking_number, extracted_carrier, extracted_status")
      .eq("id", updateId)
      .single(),
    supabase.from("orders").select("order_number").eq("id", orderId).single(),
  ]);

  if (!update || !order) return;

  // Reuses the same matching function the automated pipeline calls - the
  // admin's manual pick just supplies the order_number directly instead of
  // it coming from an extracted guess.
  await supabase.rpc("apply_shipping_update", {
    p_order_number: order.order_number,
    p_tracking_number: update.extracted_tracking_number,
    p_carrier: update.extracted_carrier,
    p_status: update.extracted_status,
    p_expected_delivery_date: null,
  });

  await supabase
    .from("unmatched_updates")
    .update({
      resolved_order_id: orderId,
      resolved_by: profile.id,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", updateId);

  revalidatePath("/unmatched-updates");
}

export async function dismissUnmatchedUpdate(updateId: string) {
  const profile = await requireAdmin();
  const supabase = await createClient();

  await supabase
    .from("unmatched_updates")
    .update({ resolved_by: profile.id, resolved_at: new Date().toISOString() })
    .eq("id", updateId);

  revalidatePath("/unmatched-updates");
}
