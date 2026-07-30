import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "http://127.0.0.1:54321";
// Fixed local Supabase dev key (identical for every `supabase start`, not a
// real secret) - same fixture shortcut used across this project's other specs.
const SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

test("data retention deletes confirmation photos older than 12 months, keeps recent ones, and never deletes the audit row itself", async ({
  request,
}) => {
  const stamp = `${Date.now()}-${test.info().project.name}`;
  const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: property } = await serviceClient
    .from("properties")
    .insert({ name: `Retention Property ${stamp}`, address: "1 Retention St" })
    .select("id")
    .single();
  const { data: retailer } = await serviceClient.from("retailers").select("id").eq("name", "Amazon").single();
  const { data: order } = await serviceClient
    .from("orders")
    .insert({
      retailer_id: retailer!.id,
      property_id: property!.id,
      order_number: `RETENTION-${stamp}`,
      order_date: "2026-07-29",
      total_amount: 10,
      source: "manual",
    })
    .select("id")
    .single();
  const { data: pkg } = await serviceClient
    .from("packages")
    .insert({ order_id: order!.id, status: "confirmed_received" })
    .select("id")
    .single();

  // Needs a real profile for reported_by - created via the admin API
  // (pre-confirmed, same reason as scripts/rls-audit.mjs: no public signup
  // path needed for a throwaway fixture account).
  const { data: created } = await serviceClient.auth.admin.createUser({
    email: `retention-cleaner-${stamp}@rls-audit.test`,
    password: `RetentionPass!${stamp}`,
    email_confirm: true,
  });
  const cleanerId = created!.user!.id;

  const oldPath = `${pkg!.id}/old-${stamp}.jpg`;
  const freshPath = `${pkg!.id}/fresh-${stamp}.jpg`;
  const photoBytes = Buffer.from("fake-photo-bytes");
  await serviceClient.storage.from("confirmation-photos").upload(oldPath, photoBytes, { contentType: "image/jpeg" });
  await serviceClient.storage.from("confirmation-photos").upload(freshPath, photoBytes, { contentType: "image/jpeg" });

  const thirteenMonthsAgo = new Date();
  thirteenMonthsAgo.setMonth(thirteenMonthsAgo.getMonth() - 13);

  const { data: oldConfirmation } = await serviceClient
    .from("package_confirmations")
    .insert({
      package_id: pkg!.id,
      reported_by: cleanerId,
      outcome: "all_correct",
      photo_path: oldPath,
      created_at: thirteenMonthsAgo.toISOString(),
    })
    .select("id")
    .single();
  const { data: freshConfirmation } = await serviceClient
    .from("package_confirmations")
    .insert({
      package_id: pkg!.id,
      reported_by: cleanerId,
      outcome: "all_correct",
      photo_path: freshPath,
    })
    .select("id")
    .single();

  const response = await request.get("/api/cron/data-retention");
  expect(response.ok()).toBe(true);
  const summary = await response.json();
  expect(summary.photosDeleted).toBeGreaterThanOrEqual(1);
  // Correct-but-currently-a-no-op, per M8 scope: nothing has ever populated
  // imported_emails.raw_storage_path, so this side always finds zero rows.
  expect(summary.rawEmailsDeleted).toBe(0);

  const { data: oldAfter } = await serviceClient
    .from("package_confirmations")
    .select("id, photo_path")
    .eq("id", oldConfirmation!.id)
    .single();
  expect(oldAfter?.photo_path).toBeNull();
  // The audit row itself survives - only the photo blob/path ages out.
  expect(oldAfter?.id).toBe(oldConfirmation!.id);

  const { data: freshAfter } = await serviceClient
    .from("package_confirmations")
    .select("photo_path")
    .eq("id", freshConfirmation!.id)
    .single();
  expect(freshAfter?.photo_path).toBe(freshPath);

  const { error: oldDownloadError } = await serviceClient.storage.from("confirmation-photos").download(oldPath);
  expect(oldDownloadError).not.toBeNull();

  const { data: freshDownload, error: freshDownloadError } = await serviceClient.storage
    .from("confirmation-photos")
    .download(freshPath);
  expect(freshDownloadError).toBeNull();
  expect(freshDownload).not.toBeNull();

  // Cleanup.
  await serviceClient.from("orders").delete().eq("id", order!.id);
  await serviceClient.from("properties").delete().eq("id", property!.id);
  await serviceClient.storage.from("confirmation-photos").remove([freshPath]);
  await serviceClient.auth.admin.deleteUser(cleanerId);
});
