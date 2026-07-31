"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, requireAdmin } from "@/lib/auth";

export async function createProperty(formData: FormData) {
  await requireAdmin();

  const name = String(formData.get("name") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  if (!name || !address) return;

  // Pre-filled from the address on the client (see PropertyForm) since
  // that's literally what gets typed into Amazon's PO field in practice -
  // but stored as its own editable column, not derived, since addresses
  // sometimes have formatting Amazon's PO field doesn't take cleanly.
  const poNumber = String(formData.get("po_number") ?? "").trim();

  const supabase = await createClient();
  await supabase.from("properties").insert({ name, address, po_number: poNumber || null });
  revalidatePath("/properties");
}

export async function updateProperty(propertyId: string, formData: FormData) {
  await requireAdmin();

  const name = String(formData.get("name") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  const status = String(formData.get("status") ?? "active");
  const notes = String(formData.get("notes") ?? "").trim();
  const ownerId = String(formData.get("owner_id") ?? "").trim();
  const poNumber = String(formData.get("po_number") ?? "").trim();
  if (!name || !address) return;

  const supabase = await createClient();
  await supabase
    .from("properties")
    .update({
      name,
      address,
      status,
      notes: notes || null,
      owner_id: ownerId || null,
      po_number: poNumber || null,
    })
    .eq("id", propertyId);

  revalidatePath(`/properties/${propertyId}`);
  revalidatePath("/properties");
}

export async function assignCleaner(propertyId: string, formData: FormData) {
  await requireAdmin();

  const userId = String(formData.get("userId") ?? "");
  if (!userId) return;

  const supabase = await createClient();
  await supabase
    .from("cleaner_property_assignments")
    .insert({ property_id: propertyId, user_id: userId });

  revalidatePath(`/properties/${propertyId}`);
}

export async function unassignCleaner(propertyId: string, userId: string) {
  await requireAdmin();

  const supabase = await createClient();
  await supabase
    .from("cleaner_property_assignments")
    .delete()
    .eq("property_id", propertyId)
    .eq("user_id", userId);

  revalidatePath(`/properties/${propertyId}`);
}

type DraftRequestItem = { item_name?: string; quantity?: string; note?: string };
export type SupplyRequestFormState = { success: boolean } | undefined;

export async function createSupplyRequests(
  propertyId: string,
  _prevState: SupplyRequestFormState,
  formData: FormData,
): Promise<SupplyRequestFormState> {
  const profile = await getCurrentProfile();
  if (!profile) return { success: false };

  let draftItems: DraftRequestItem[];
  try {
    draftItems = JSON.parse(String(formData.get("items") ?? "[]"));
  } catch {
    return { success: false };
  }

  const items = draftItems
    .map((item) => ({
      item_name: (item.item_name ?? "").trim(),
      quantity: item.quantity ? Number(item.quantity) : null,
      note: (item.note ?? "").trim() || null,
    }))
    .filter((item) => item.item_name.length > 0);

  if (items.length === 0) return { success: false };

  // create_supply_request_batch finds the property's already-open batch and
  // appends to it, only creating a new one if none is open - RLS on both
  // supply_request_batches and supply_requests (assigned-property checks)
  // is the actual gate, this RPC runs as the caller (security invoker).
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_supply_request_batch", {
    p_property_id: propertyId,
    p_items: items,
  });

  // The nav badge (open batch count) lives in (app)/layout.tsx, a shared
  // layout above this page - revalidating this path with type 'page' only
  // busts that one page, not the layout. type 'layout', on a path that's
  // actually inside the (app) route group, busts the shared layout itself
  // ('/' resolves through a separate root src/app/page.tsx *outside* that
  // group, so revalidating '/' never touches it at all).
  revalidatePath(`/properties/${propertyId}`, "layout");
  return { success: !error };
}

// RLS ("Cleaners can delete their own open requests") is the actual gate -
// own row, and only while still untouched (not ordered, not resolved). An
// admin has acted on anything past that point, so it's no longer just a
// draft mistake to quietly remove.
export async function cancelSupplyRequest(
  requestId: string,
  propertyId: string,
): Promise<{ success: boolean }> {
  const supabase = await createClient();
  const { data: request } = await supabase
    .from("supply_requests")
    .select("batch_id")
    .eq("id", requestId)
    .single();

  const { error } = await supabase
    .from("supply_requests")
    .delete()
    .eq("id", requestId);

  // The batch-status trigger only fires when ordered_order_id *changes* -
  // deleting a row outright never touches it, so an emptied batch would
  // otherwise sit around forever still marked 'open'. Clean it up directly
  // if this was its last remaining request.
  if (!error && request?.batch_id) {
    const { count } = await supabase
      .from("supply_requests")
      .select("id", { count: "exact", head: true })
      .eq("batch_id", request.batch_id);
    if ((count ?? 0) === 0) {
      await supabase.from("supply_request_batches").delete().eq("id", request.batch_id);
    }
  }

  revalidatePath(`/properties/${propertyId}`, "layout");
  return { success: !error };
}
