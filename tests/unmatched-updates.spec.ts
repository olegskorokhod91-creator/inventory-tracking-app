import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "http://127.0.0.1:54321";
// Fixed local Supabase dev key (identical for every `supabase start`, not a
// real secret). Used to promote test users to admin and to seed
// pipeline-only rows (unmatched_updates/imported_emails have no UI to
// create them directly - they're only ever written by the email pipeline).
const SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

async function signUp(page: Page, name: string, email: string) {
  await page.goto("/signup");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Sign up" }).click();
  // Generous timeout: under parallel test load against a single local
  // Supabase instance, signup can occasionally take longer than the 5s default.
  await expect(page).toHaveURL("/properties", { timeout: 15000 });
}

async function promoteToAdmin(name: string) {
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { error } = await adminClient
    .from("profiles")
    .update({ role: "admin" })
    .eq("name", name);
  if (error) throw error;
}

async function forceCleanerRole(name: string) {
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { error } = await adminClient
    .from("profiles")
    .update({ role: "cleaner" })
    .eq("name", name);
  if (error) throw error;
}

test("admin resolves an unmatched update by manually picking the order, and dismisses another", async ({
  page,
}) => {
  const stamp = Date.now();
  const adminName = `Admin ${stamp}`;
  const orderNumber = `ORD-${stamp}`;

  await signUp(page, adminName, `admin-${stamp}@example.com`);
  await promoteToAdmin(adminName);

  const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: retailer } = await serviceClient
    .from("retailers")
    .select("id")
    .eq("name", "Amazon")
    .single();

  const { data: order } = await serviceClient
    .from("orders")
    .insert({
      retailer_id: retailer!.id,
      order_number: orderNumber,
      order_date: "2026-07-20",
      source: "manual",
    })
    .select("id")
    .single();
  await serviceClient.from("packages").insert({ order_id: order!.id, status: "expected" });

  const { data: emailToResolve } = await serviceClient
    .from("imported_emails")
    .insert({
      message_id: `resolve-test-${stamp}@amazon.com`,
      sender: "shipment-tracking@amazon.com",
      subject: "Your package has shipped",
      received_at: new Date().toISOString(),
      parsed_type: "shipping_update",
      match_status: "unmatched",
    })
    .select("id")
    .single();

  const { data: updateToResolve } = await serviceClient
    .from("unmatched_updates")
    .insert({
      imported_email_id: emailToResolve!.id,
      reason: `No order number found for test ${stamp}`,
      extracted_tracking_number: `TRACK-${stamp}`,
      extracted_carrier: "UPS",
      extracted_status: "shipped",
    })
    .select("id")
    .single();

  const { data: emailToDismiss } = await serviceClient
    .from("imported_emails")
    .insert({
      message_id: `dismiss-test-${stamp}@amazon.com`,
      sender: "shipment-tracking@amazon.com",
      subject: "An update on your shipment",
      received_at: new Date().toISOString(),
      parsed_type: "shipping_update",
      match_status: "unmatched",
    })
    .select("id")
    .single();

  await serviceClient.from("unmatched_updates").insert({
    imported_email_id: emailToDismiss!.id,
    reason: `Nothing extractable ${stamp}`,
  });

  await page.goto("/unmatched-updates");
  await expect(page.getByText(`TRACK-${stamp}`)).toBeVisible();
  await expect(page.getByText(`Nothing extractable ${stamp}`)).toBeVisible();

  // Resolve the first one against the seeded order.
  const resolveCard = page.locator("li", { hasText: `TRACK-${stamp}` });
  await resolveCard.locator('select[name="order_id"]').selectOption(order!.id);
  await resolveCard.getByRole("button", { name: "Apply" }).click();

  await expect(page.getByText(`TRACK-${stamp}`)).not.toBeVisible();

  // Package now shows the applied tracking info.
  await page.goto(`/orders/${order!.id}`);
  await expect(page.getByText(`Tracking: TRACK-${stamp} (UPS)`)).toBeVisible();
  await expect(page.getByText("shipped")).toBeVisible();

  // Dismiss the second one without applying anything.
  await page.goto("/unmatched-updates");
  await expect(page.getByText(`Nothing extractable ${stamp}`)).toBeVisible();
  const dismissCard = page.locator("li", { hasText: `Nothing extractable ${stamp}` });
  await dismissCard.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByText(`Nothing extractable ${stamp}`)).not.toBeVisible();

  const { data: resolvedUpdate } = await serviceClient
    .from("unmatched_updates")
    .select("resolved_order_id, resolved_at")
    .eq("id", updateToResolve!.id)
    .single();
  expect(resolvedUpdate?.resolved_order_id).toBe(order!.id);
  expect(resolvedUpdate?.resolved_at).not.toBeNull();
});

test("cleaners cannot access /unmatched-updates", async ({ page }) => {
  const stamp = Date.now();
  const cleanerName = `Cleaner ${stamp}`;
  await signUp(page, cleanerName, `cleaner-${stamp}@example.com`);
  await forceCleanerRole(cleanerName);

  await page.goto("/unmatched-updates");
  await expect(page).toHaveURL("/properties");
});
