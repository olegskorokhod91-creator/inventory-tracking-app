"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, requireAdmin } from "@/lib/auth";

export async function createProperty(formData: FormData) {
  await requireAdmin();

  const name = String(formData.get("name") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  if (!name || !address) return;

  const supabase = await createClient();
  await supabase.from("properties").insert({ name, address });
  revalidatePath("/properties");
}

export async function updateProperty(propertyId: string, formData: FormData) {
  await requireAdmin();

  const name = String(formData.get("name") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  const status = String(formData.get("status") ?? "active");
  const notes = String(formData.get("notes") ?? "").trim();
  const ownerId = String(formData.get("owner_id") ?? "").trim();
  if (!name || !address) return;

  const supabase = await createClient();
  await supabase
    .from("properties")
    .update({ name, address, status, notes: notes || null, owner_id: ownerId || null })
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

  const rows = draftItems
    .map((item) => ({
      property_id: propertyId,
      created_by: profile.id,
      item_name: (item.item_name ?? "").trim(),
      quantity: item.quantity ? Number(item.quantity) : null,
      note: (item.note ?? "").trim() || null,
    }))
    .filter((row) => row.item_name.length > 0);

  if (rows.length === 0) return { success: false };

  // RLS ("Cleaners can create requests for assigned properties") is the
  // actual gate here - this insert simply fails for anyone not assigned.
  const supabase = await createClient();
  const { error } = await supabase.from("supply_requests").insert(rows);

  revalidatePath(`/properties/${propertyId}`);
  return { success: !error };
}
