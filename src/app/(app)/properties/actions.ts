"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";

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
  if (!name || !address) return;

  const supabase = await createClient();
  await supabase
    .from("properties")
    .update({ name, address, status, notes: notes || null })
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
