"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";

type DraftItem = {
  name?: string;
  expected_quantity?: number | string;
  unit_price?: string;
};

type FieldChange = { field: string; oldValue: unknown; newValue: unknown };

// Records who changed what on an admin hand-edit path (order fields, package
// manual overrides, refund toggle) - the three write paths in this file that
// have no other audit trail, unlike the pipeline/confirmation tables. Only
// inserts a row per field that actually changed value.
async function logAuditChanges(
  supabase: Awaited<ReturnType<typeof createClient>>,
  actorId: string,
  tableName: string,
  rowId: string,
  changes: FieldChange[],
) {
  const rows = changes
    .filter((c) => c.oldValue !== c.newValue)
    .map((c) => ({
      actor_id: actorId,
      table_name: tableName,
      row_id: rowId,
      field_name: c.field,
      old_value: c.oldValue === null || c.oldValue === undefined ? null : String(c.oldValue),
      new_value: c.newValue === null || c.newValue === undefined ? null : String(c.newValue),
    }));

  if (rows.length > 0) await supabase.from("audit_log").insert(rows);
}

export async function createOrder(formData: FormData) {
  await requireAdmin();

  const retailerId = String(formData.get("retailer_id") ?? "");
  const propertyId = String(formData.get("property_id") ?? "");
  const orderNumber = String(formData.get("order_number") ?? "").trim();
  const orderDate = String(formData.get("order_date") ?? "");
  const totalAmountRaw = String(formData.get("total_amount") ?? "").trim();
  if (!retailerId || !propertyId || !orderDate) return;

  let draftItems: DraftItem[];
  try {
    draftItems = JSON.parse(String(formData.get("items") ?? "[]"));
  } catch {
    return;
  }

  const items = draftItems
    .map((item) => ({
      name: (item.name ?? "").trim(),
      expected_quantity: Number(item.expected_quantity) || 1,
      unit_price: item.unit_price ?? "",
    }))
    .filter((item) => item.name.length > 0);

  if (items.length === 0) return;

  let resolvedRequestIds: string[];
  try {
    resolvedRequestIds = JSON.parse(
      String(formData.get("resolved_request_ids") ?? "[]"),
    );
  } catch {
    resolvedRequestIds = [];
  }

  const supabase = await createClient();
  const { data: orderId, error } = await supabase.rpc("create_manual_order", {
    p_retailer_id: retailerId,
    p_property_id: propertyId,
    p_order_number: orderNumber || null,
    p_order_date: orderDate,
    p_total_amount: totalAmountRaw ? Number(totalAmountRaw) : null,
    p_items: items,
    p_resolved_request_ids: resolvedRequestIds,
  });

  if (error || !orderId) {
    console.error("create_manual_order failed:", error);
    return;
  }

  revalidatePath("/orders");
  redirect(`/orders/${orderId}`);
}

export async function setItemRefunded(itemId: string, refunded: boolean) {
  const profile = await requireAdmin();

  const supabase = await createClient();
  const { data: item } = await supabase
    .from("order_items")
    .select("order_id, is_refunded")
    .eq("id", itemId)
    .single();

  await supabase
    .from("order_items")
    .update({ is_refunded: refunded })
    .eq("id", itemId);

  if (item) {
    await logAuditChanges(supabase, profile.id, "order_items", itemId, [
      { field: "is_refunded", oldValue: item.is_refunded, newValue: refunded },
    ]);
    revalidatePath(`/orders/${item.order_id}`);
  }
}

export async function deleteOrderItem(
  itemId: string,
): Promise<{ success: boolean; error?: string }> {
  const profile = await requireAdmin();

  const supabase = await createClient();
  const { data: item } = await supabase
    .from("order_items")
    .select("order_id, name, expected_quantity")
    .eq("id", itemId)
    .single();
  if (!item) return { success: false, error: "Item not found." };

  const { error } = await supabase.from("order_items").delete().eq("id", itemId);

  if (error) {
    // package_confirmation_items references order_items with no cascade,
    // deliberately - a cleaner's confirmed-received history is never
    // deleted. Refunded is the right tool once an item has real delivery
    // history; removal is only for a mistake that never got that far.
    if (error.code === "23503") {
      return {
        success: false,
        error:
          "This item has already been confirmed as received and can't be removed — use Refunded instead.",
      };
    }
    console.error("deleteOrderItem failed:", error);
    return { success: false, error: "Failed to remove item." };
  }

  await logAuditChanges(supabase, profile.id, "order_items", itemId, [
    { field: "deleted", oldValue: `${item.name} x${item.expected_quantity}`, newValue: null },
  ]);

  revalidatePath(`/orders/${item.order_id}`);
  return { success: true };
}

// requires_attention is excluded deliberately - that package status is
// earned only through a cleaner's own confirmation-flow report (M5), not
// something an admin sets by hand.
const ADMIN_SETTABLE_PACKAGE_STATUSES = [
  "expected",
  "shipped",
  "out_for_delivery",
  "delayed",
  "delivered",
  "cancelled",
  "confirmed_received",
];

export async function updatePackage(packageId: string, formData: FormData) {
  const profile = await requireAdmin();

  const status = String(formData.get("status") ?? "");
  if (!ADMIN_SETTABLE_PACKAGE_STATUSES.includes(status)) return;

  const trackingNumber = String(formData.get("tracking_number") ?? "").trim();
  const carrier = String(formData.get("carrier") ?? "").trim();
  const expectedDeliveryDate = String(formData.get("expected_delivery_date") ?? "").trim();

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("packages")
    .select("order_id, status, tracking_number, carrier, expected_delivery_date")
    .eq("id", packageId)
    .single();
  if (!existing) return;

  const update: Record<string, unknown> = {
    status,
    tracking_number: trackingNumber || null,
    carrier: carrier || null,
    expected_delivery_date: expectedDeliveryDate || null,
  };

  // Only stamp the transition timestamp/source when actually entering that
  // status this save, not on every edit while it happens to stay there
  // (e.g. fixing a typo'd carrier on an already-delivered package shouldn't
  // reset delivered_at).
  if (status === "delivered" && existing.status !== "delivered") {
    update.delivered_at = new Date().toISOString();
    update.delivered_source = "manual";
  }
  if (status === "confirmed_received" && existing.status !== "confirmed_received") {
    update.confirmed_at = new Date().toISOString();
    update.confirmed_source = "admin_manual";
  }

  await supabase.from("packages").update(update).eq("id", packageId);

  await logAuditChanges(supabase, profile.id, "packages", packageId, [
    { field: "status", oldValue: existing.status, newValue: update.status },
    { field: "tracking_number", oldValue: existing.tracking_number, newValue: update.tracking_number },
    { field: "carrier", oldValue: existing.carrier, newValue: update.carrier },
    {
      field: "expected_delivery_date",
      oldValue: existing.expected_delivery_date,
      newValue: update.expected_delivery_date,
    },
  ]);

  revalidatePath(`/orders/${existing.order_id}`);
  revalidatePath("/orders");
}

export async function updateOrder(orderId: string, formData: FormData) {
  const profile = await requireAdmin();

  const retailerId = String(formData.get("retailer_id") ?? "");
  const propertyId = String(formData.get("property_id") ?? "");
  const orderNumber = String(formData.get("order_number") ?? "").trim();
  const orderDate = String(formData.get("order_date") ?? "");
  const totalAmountRaw = String(formData.get("total_amount") ?? "").trim();
  if (!retailerId || !propertyId || !orderDate) return;

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("orders")
    .select("retailer_id, property_id, order_number, order_date, total_amount")
    .eq("id", orderId)
    .single();

  const update = {
    retailer_id: retailerId,
    property_id: propertyId,
    order_number: orderNumber || null,
    order_date: orderDate,
    total_amount: totalAmountRaw ? Number(totalAmountRaw) : null,
  };

  await supabase.from("orders").update(update).eq("id", orderId);

  if (existing) {
    await logAuditChanges(supabase, profile.id, "orders", orderId, [
      { field: "retailer_id", oldValue: existing.retailer_id, newValue: update.retailer_id },
      { field: "property_id", oldValue: existing.property_id, newValue: update.property_id },
      { field: "order_number", oldValue: existing.order_number, newValue: update.order_number },
      { field: "order_date", oldValue: existing.order_date, newValue: update.order_date },
      { field: "total_amount", oldValue: existing.total_amount, newValue: update.total_amount },
    ]);
  }

  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/orders");
}
