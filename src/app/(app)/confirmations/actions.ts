"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";

// One-tap path for the common case, straight from the list (/confirmations)
// - no need to open the package detail screen just to tap the same green
// "Everything received correctly" button that's already there. Fetches the
// package's own expected items server-side and submits exactly the same
// all_correct payload ConfirmationForm's button would, through the same
// confirm_package_delivery RPC - the item-by-item review flow (and its
// quantity/photo/note capture) still exists for the "something's wrong"
// case, just via /confirmations/[packageId] as before, unchanged.
export async function confirmAllCorrectFromList(packageId: string): Promise<void> {
  const profile = await getCurrentProfile();
  if (!profile) return;

  const supabase = await createClient();

  const { data: pkg } = await supabase
    .from("packages")
    .select("order_id")
    .eq("id", packageId)
    .single();

  const { data: items } = await supabase
    .from("package_items")
    .select("order_item_id, expected_quantity")
    .eq("package_id", packageId);

  const itemsPayload = (items ?? []).map((i) => ({
    order_item_id: i.order_item_id,
    actual_quantity: i.expected_quantity,
    item_note: null,
  }));

  const { error } = await supabase.rpc("confirm_package_delivery", {
    p_package_id: packageId,
    p_outcome: "all_correct",
    p_note: null,
    p_photo_path: null,
    p_items: itemsPayload,
  });

  if (error) {
    // Plain server-action form (no useActionState here) - same pattern as
    // markRequestsOrdered/markRequestResolved: log for diagnosis, leave the
    // list unrevalidated so it silently still shows the package as pending
    // rather than claiming success it didn't have. A cleaner hitting this
    // can still fall back to "Report an issue" -> the full detail screen.
    console.error("confirmAllCorrectFromList failed:", error);
    return;
  }

  revalidatePath("/confirmations");
  revalidatePath("/orders");
  if (pkg) revalidatePath(`/orders/${pkg.order_id}`);
}

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
