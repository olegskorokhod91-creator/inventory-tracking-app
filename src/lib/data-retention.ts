import type { SupabaseClient } from "@supabase/supabase-js";

// M8: a package_confirmations row is never deleted (insert-only audit log,
// same reasoning as everywhere else in this schema - see M5) - only the
// heavier/more sensitive photo binary ages out. The cleaner-confirmation
// flow itself was later removed (product-owner-directed simplification -
// orders are done the instant an admin marks them ordered, no confirmation
// step exists anymore), so no new package_confirmations rows are created
// going forward, but any historical ones still age out correctly here.
export const RETENTION_MONTHS = 12;

export type RetentionSummary = {
  photosDeleted: number;
};

function cutoffIso(now: Date): string {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - RETENTION_MONTHS);
  return cutoff.toISOString();
}

export async function deleteOldConfirmationPhotos(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<number> {
  const { data: rows, error } = await supabase
    .from("package_confirmations")
    .select("id, photo_path")
    .not("photo_path", "is", null)
    .lt("created_at", cutoffIso(now));
  if (error) throw error;
  if (!rows || rows.length === 0) return 0;

  const paths = rows.map((r) => r.photo_path as string);
  const { error: removeError } = await supabase.storage.from("confirmation-photos").remove(paths);
  if (removeError) throw removeError;

  const { error: updateError } = await supabase
    .from("package_confirmations")
    .update({ photo_path: null })
    .in(
      "id",
      rows.map((r) => r.id),
    );
  if (updateError) throw updateError;

  return rows.length;
}

export async function runDataRetention(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<RetentionSummary> {
  const photosDeleted = await deleteOldConfirmationPhotos(supabase, now);
  return { photosDeleted };
}
