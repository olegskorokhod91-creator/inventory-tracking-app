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
  await requireAdmin();

  const supabase = await createClient();
  const { data: item } = await supabase
    .from("order_items")
    .select("order_id")
    .eq("id", itemId)
    .single();

  await supabase
    .from("order_items")
    .update({ is_refunded: refunded })
    .eq("id", itemId);

  if (item) revalidatePath(`/orders/${item.order_id}`);
}

export async function updateOrder(orderId: string, formData: FormData) {
  await requireAdmin();

  const retailerId = String(formData.get("retailer_id") ?? "");
  const propertyId = String(formData.get("property_id") ?? "");
  const orderNumber = String(formData.get("order_number") ?? "").trim();
  const orderDate = String(formData.get("order_date") ?? "");
  const totalAmountRaw = String(formData.get("total_amount") ?? "").trim();
  if (!retailerId || !propertyId || !orderDate) return;

  const supabase = await createClient();
  await supabase
    .from("orders")
    .update({
      retailer_id: retailerId,
      property_id: propertyId,
      order_number: orderNumber || null,
      order_date: orderDate,
      total_amount: totalAmountRaw ? Number(totalAmountRaw) : null,
    })
    .eq("id", orderId);

  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/orders");
}
