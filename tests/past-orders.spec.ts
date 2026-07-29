import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "http://127.0.0.1:54321";
// Fixed local Supabase dev key (identical for every `supabase start`, not a
// real secret) - same fixture shortcut used across this project's other specs.
const SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

async function signUp(page: Page, name: string, email: string) {
  await page.goto("/signup");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/(properties|confirmations)/, { timeout: 15000 });
}

async function promoteToAdmin(name: string) {
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { error } = await adminClient.from("profiles").update({ role: "admin" }).eq("name", name);
  if (error) throw error;
}

// Guards against the (parallel-test) race where this signup happens to be
// the very first ever in the DB and the bootstrap trigger makes it admin
// instead of the cleaner this test needs.
async function forceCleanerRole(name: string) {
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { error } = await adminClient.from("profiles").update({ role: "cleaner" }).eq("name", name);
  if (error) throw error;
}

test("Past Orders lists only fully resolved orders, keeps cancelled-as-resolved, tracks issue history, and filters narrow correctly", async ({
  page,
}) => {
  const stamp = `${Date.now()}-${test.info().project.name}`;
  const adminName = `Admin ${stamp}`;
  const cleanerName = `Cleaner ${stamp}`;
  const propertyName = `Past Orders Property ${stamp}`;

  await signUp(page, adminName, `admin-${stamp}@example.com`);
  await promoteToAdmin(adminName);
  await page.goto("/properties");

  const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: property } = await serviceClient
    .from("properties")
    .insert({ name: propertyName, address: "1 Past Orders St" })
    .select("id")
    .single();
  const { data: retailer } = await serviceClient
    .from("retailers")
    .select("id")
    .eq("name", "Amazon")
    .single();

  // Separate browser context so the cleaner signup doesn't disturb the
  // admin session already navigated above.
  const cleanerContext = await page.context().browser()!.newContext();
  const cleanerPage = await cleanerContext.newPage();
  await signUp(cleanerPage, cleanerName, `cleaner-${stamp}@example.com`);
  await forceCleanerRole(cleanerName);
  const { data: cleaner } = await serviceClient.from("profiles").select("id").eq("name", cleanerName).single();
  await serviceClient
    .from("cleaner_property_assignments")
    .insert({ property_id: property!.id, user_id: cleaner!.id });

  async function seedOrder(orderNumber: string, itemName: string, expectedQty: number) {
    const { data: orderId, error } = await serviceClient.rpc("create_manual_order", {
      p_retailer_id: retailer!.id,
      p_property_id: property!.id,
      p_order_number: orderNumber,
      p_order_date: "2026-07-15",
      p_total_amount: 30,
      p_items: [{ name: itemName, expected_quantity: expectedQty, unit_price: "15.00" }],
      p_resolved_request_ids: [],
    });
    if (error) throw error;
    const { data: pkg } = await serviceClient
      .from("packages")
      .select("id")
      .eq("order_id", orderId as string)
      .single();
    const { data: item } = await serviceClient
      .from("order_items")
      .select("id")
      .eq("order_id", orderId as string)
      .single();
    return { orderId: orderId as string, packageId: pkg!.id as string, itemId: item!.id as string };
  }

  // Order A: happy path, cleaner confirmed everything correct.
  const received = await seedOrder(`PAST-RECEIVED-${stamp}`, "Paper Towels", 2);
  await serviceClient.from("package_confirmations").insert({
    package_id: received.packageId,
    reported_by: cleaner!.id,
    outcome: "all_correct",
  });
  await serviceClient
    .from("packages")
    .update({
      status: "confirmed_received",
      confirmed_at: new Date().toISOString(),
      confirmed_source: "cleaner_app",
      confirmed_by: cleaner!.id,
    })
    .eq("id", received.packageId);

  // Order B: cleaner reported damage (short quantity), admin later resolved
  // it manually. requires_attention is false again by now, but the issue
  // must still surface via had_issue.
  const damaged = await seedOrder(`PAST-DAMAGED-${stamp}`, "Damaged Widget", 3);
  const { data: damagedConfirmation } = await serviceClient
    .from("package_confirmations")
    .insert({
      package_id: damaged.packageId,
      reported_by: cleaner!.id,
      outcome: "damaged",
      note: "Box was crushed",
    })
    .select("id")
    .single();
  await serviceClient.from("package_confirmation_items").insert({
    package_confirmation_id: damagedConfirmation!.id,
    order_item_id: damaged.itemId,
    actual_quantity: 1,
    item_note: "2 units unusable",
  });
  await serviceClient.from("packages").update({ status: "requires_attention" }).eq("id", damaged.packageId);
  // Admin resolves it manually (M4 override path) - confirmed_by stays null.
  await serviceClient
    .from("packages")
    .update({
      status: "confirmed_received",
      confirmed_at: new Date().toISOString(),
      confirmed_source: "admin_manual",
    })
    .eq("id", damaged.packageId);

  // Order C: cancelled - must count as resolved, same as confirmed_received.
  const cancelled = await seedOrder(`PAST-CANCELLED-${stamp}`, "Cancelled Gadget", 1);
  await serviceClient.from("packages").update({ status: "cancelled" }).eq("id", cancelled.packageId);

  // Order D: still active - must never appear in Past Orders.
  const active = await seedOrder(`ACTIVE-STILL-${stamp}`, "Paper Towels", 2);
  await serviceClient.from("packages").update({ status: "shipped" }).eq("id", active.packageId);

  await page.goto("/orders/past");
  await expect(page.getByText(`#PAST-RECEIVED-${stamp}`)).toBeVisible();
  await expect(page.getByText(`#PAST-DAMAGED-${stamp}`)).toBeVisible();
  await expect(page.getByText(`#PAST-CANCELLED-${stamp}`)).toBeVisible();
  await expect(page.getByText(`#ACTIVE-STILL-${stamp}`)).not.toBeVisible();

  // Item name filter narrows to the matching order only.
  await page.goto(`/orders/past?item=${encodeURIComponent("Damaged Widget")}`);
  await expect(page.getByText(`#PAST-DAMAGED-${stamp}`)).toBeVisible();
  await expect(page.getByText(`#PAST-RECEIVED-${stamp}`)).not.toBeVisible();

  // Had-an-issue filter finds the resolved-but-once-damaged order and only that one.
  await page.goto("/orders/past?had_issue=1");
  await expect(page.getByText(`#PAST-DAMAGED-${stamp}`)).toBeVisible();
  await expect(page.getByText(`#PAST-RECEIVED-${stamp}`)).not.toBeVisible();
  await expect(page.getByText(`#PAST-CANCELLED-${stamp}`)).not.toBeVisible();

  // Delivery status filter distinguishes cancelled from received.
  await page.goto("/orders/past?delivery_status=cancelled");
  await expect(page.getByText(`#PAST-CANCELLED-${stamp}`)).toBeVisible();
  await expect(page.getByText(`#PAST-RECEIVED-${stamp}`)).not.toBeVisible();
  await expect(page.getByText(`#PAST-DAMAGED-${stamp}`)).not.toBeVisible();

  // Cleaner filter matches orders that cleaner ever reported on, including
  // the one later resolved by an admin.
  await page.goto(`/orders/past?cleaner_id=${cleaner!.id}`);
  await expect(page.getByText(`#PAST-RECEIVED-${stamp}`)).toBeVisible();
  await expect(page.getByText(`#PAST-DAMAGED-${stamp}`)).toBeVisible();
  await expect(page.getByText(`#PAST-CANCELLED-${stamp}`)).not.toBeVisible();

  // Order detail page shows the historical provenance/quantity-diff fields
  // that Past Orders' "link to the original order" relies on.
  await page.goto(`/orders/${damaged.orderId}`);
  await expect(page.getByText(/by admin \(manual override\)/)).toBeVisible();
  await expect(page.getByText(/expected x3/)).toBeVisible();
  await expect(page.getByText("short")).toBeVisible();

  await cleanerContext.close();
});
