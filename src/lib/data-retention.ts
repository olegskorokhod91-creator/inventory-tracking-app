import type { SupabaseClient } from "@supabase/supabase-js";

// M8: a package_confirmations row is never deleted (insert-only audit log,
// same reasoning as everywhere else in this schema - see M5) - only the
// heavier/more sensitive photo binary ages out. imported_emails rows are
// treated the same way for symmetry, even though nothing populates
// raw_storage_path yet (see the comment on deleteOldRawEmails below).
export const RETENTION_MONTHS = 12;

export type RetentionSummary = {
  photosDeleted: number;
  rawEmailsDeleted: number;
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

// Correct now, but currently a no-op in practice: imported_emails.
// raw_storage_path has never been populated by anything (no Supabase
// Storage integration exists yet for raw forwarded emails - see CLAUDE.md's
// known gaps). The select below will find zero rows until that's built, so
// the (currently nonexistent) storage bucket is never actually touched.
// Written now so the retention job is complete and ready rather than
// needing a second migration/deploy once raw-email storage lands.
export async function deleteOldRawEmails(supabase: SupabaseClient, now: Date = new Date()): Promise<number> {
  const { data: rows, error } = await supabase
    .from("imported_emails")
    .select("id, raw_storage_path")
    .not("raw_storage_path", "is", null)
    .lt("received_at", cutoffIso(now));
  if (error) throw error;
  if (!rows || rows.length === 0) return 0;

  const paths = rows.map((r) => r.raw_storage_path as string);
  const { error: removeError } = await supabase.storage.from("raw-emails").remove(paths);
  if (removeError) throw removeError;

  const { error: updateError } = await supabase
    .from("imported_emails")
    .update({ raw_storage_path: null })
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
  const [photosDeleted, rawEmailsDeleted] = await Promise.all([
    deleteOldConfirmationPhotos(supabase, now),
    deleteOldRawEmails(supabase, now),
  ]);
  return { photosDeleted, rawEmailsDeleted };
}
