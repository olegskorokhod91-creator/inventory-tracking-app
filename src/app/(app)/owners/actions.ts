"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";

export async function createOwner(formData: FormData) {
  await requireAdmin();

  const name = String(formData.get("name") ?? "").trim();
  const contactEmail = String(formData.get("contact_email") ?? "").trim();
  const contactPhone = String(formData.get("contact_phone") ?? "").trim();
  if (!name) return;

  const supabase = await createClient();
  await supabase.from("owners").insert({
    name,
    contact_email: contactEmail || null,
    contact_phone: contactPhone || null,
  });

  revalidatePath("/owners");
}

export async function updateOwner(ownerId: string, formData: FormData) {
  await requireAdmin();

  const name = String(formData.get("name") ?? "").trim();
  const contactEmail = String(formData.get("contact_email") ?? "").trim();
  const contactPhone = String(formData.get("contact_phone") ?? "").trim();
  if (!name) return;

  const supabase = await createClient();
  await supabase
    .from("owners")
    .update({
      name,
      contact_email: contactEmail || null,
      contact_phone: contactPhone || null,
    })
    .eq("id", ownerId);

  revalidatePath("/owners");
}
