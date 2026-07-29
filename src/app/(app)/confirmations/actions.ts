"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";

export async function confirmPackageDelivery(
  packageId: string,
  formData: FormData,
): Promise<{ error: string } | undefined> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const outcome = String(formData.get("outcome") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  const photo = formData.get("photo");

  let itemsPayload: unknown[];
  try {
    itemsPayload = JSON.parse(String(formData.get("items") ?? "[]"));
  } catch {
    itemsPayload = [];
  }

  const supabase = await createClient();

  const { data: pkg } = await supabase
    .from("packages")
    .select("order_id")
    .eq("id", packageId)
    .single();

  // Uploaded under the user's own session (not service role), so the
  // Storage RLS policies apply exactly as they would for a direct upload -
  // the path's leading segment is the package id, which the policy checks
  // against the cleaner's own assignments.
  let photoPath: string | null = null;
  if (photo instanceof File && photo.size > 0) {
    const path = `${packageId}/${Date.now()}-${photo.name}`;
    const { error: uploadError } = await supabase.storage
      .from("confirmation-photos")
      .upload(path, photo, { contentType: photo.type });
    if (uploadError) {
      return { error: `Photo upload failed: ${uploadError.message}` };
    }
    photoPath = path;
  }

  const { error } = await supabase.rpc("confirm_package_delivery", {
    p_package_id: packageId,
    p_outcome: outcome,
    p_note: note || null,
    p_photo_path: photoPath,
    p_items: itemsPayload,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/confirmations");
  revalidatePath("/orders");
  if (pkg) revalidatePath(`/orders/${pkg.order_id}`);
}
