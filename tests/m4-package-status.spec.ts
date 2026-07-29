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
  await expect(page).toHaveURL("/properties", { timeout: 15000 });
}

async function promoteToAdmin(name: string) {
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { error } = await adminClient.from("profiles").update({ role: "admin" }).eq("name", name);
  if (error) throw error;
}

test("admin manually edits a package, and a second tracking number creates a new package instead of overwriting", async ({
  page,
}) => {
  const stamp = `${Date.now()}-${test.info().project.name}`;
  const adminName = `Admin ${stamp}`;
  const orderNumber = `ORD-MULTI-${stamp}`;

  await signUp(page, adminName, `admin-${stamp}@example.com`);
  await promoteToAdmin(adminName);

  const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: retailer } = await serviceClient
    .from("retailers")
    .select("id")
    .eq("name", "Amazon")
    .single();

  // Seed via the same pipeline RPC used elsewhere - creates the order plus
  // its one starting package (status 'expected', no tracking yet).
  const { data: orderId } = await serviceClient.rpc("upsert_order_from_pipeline", {
    p_source: "csv",
    p_retailer_id: retailer!.id,
    p_order_number: orderNumber,
    p_order_date: "2026-07-20",
    p_total_amount: 20,
    p_po_number: null,
    p_items: [{ name: "Widget", expected_quantity: 1, unit_price: "20.00" }],
  });

  // First shipping update: no existing package has a tracking number yet,
  // so this fills in the one that's there rather than creating a second.
  const { data: firstPackageId, error: firstError } = await serviceClient.rpc(
    "apply_shipping_update",
    {
      p_order_number: orderNumber,
      p_tracking_number: `TRACK-A-${stamp}`,
      p_carrier: "UPS",
      p_status: "shipped",
      p_expected_delivery_date: null,
    },
  );
  expect(firstError).toBeNull();

  const { data: packagesAfterFirst } = await serviceClient
    .from("packages")
    .select("id, status, tracking_number")
    .eq("order_id", orderId);
  expect(packagesAfterFirst).toHaveLength(1);
  expect(packagesAfterFirst![0].id).toBe(firstPackageId);
  expect(packagesAfterFirst![0].tracking_number).toBe(`TRACK-A-${stamp}`);

  // Second shipping update: a *different* tracking number for the same
  // order - every existing package already has a different tracking number,
  // so this is a genuinely new box and must create a second package.
  const { data: secondPackageId, error: secondError } = await serviceClient.rpc(
    "apply_shipping_update",
    {
      p_order_number: orderNumber,
      p_tracking_number: `TRACK-B-${stamp}`,
      p_carrier: "FedEx",
      p_status: "shipped",
      p_expected_delivery_date: null,
    },
  );
  expect(secondError).toBeNull();
  expect(secondPackageId).not.toBe(firstPackageId);

  const { data: packagesAfterSecond } = await serviceClient
    .from("packages")
    .select("id, status, tracking_number")
    .eq("order_id", orderId)
    .order("created_at");
  expect(packagesAfterSecond).toHaveLength(2);
  expect(packagesAfterSecond![0].tracking_number).toBe(`TRACK-A-${stamp}`);
  expect(packagesAfterSecond![1].tracking_number).toBe(`TRACK-B-${stamp}`);

  // Re-sending the first tracking number again updates package #1 in place -
  // still only 2 packages, not 3.
  await serviceClient.rpc("apply_shipping_update", {
    p_order_number: orderNumber,
    p_tracking_number: `TRACK-A-${stamp}`,
    p_carrier: "UPS",
    p_status: "delivered",
    p_expected_delivery_date: null,
  });
  const { data: packagesAfterThird } = await serviceClient
    .from("packages")
    .select("id, status, tracking_number")
    .eq("order_id", orderId)
    .order("created_at");
  expect(packagesAfterThird).toHaveLength(2);
  expect(packagesAfterThird![0].status).toBe("delivered");
  expect(packagesAfterThird![1].status).toBe("shipped");

  // Ambiguous case: a status update with no tracking number and more than
  // one already-tracked package can't know which box it's about - must not
  // guess (returns null, same "never auto-apply a low-confidence match"
  // rule as the rest of this pipeline).
  const { data: ambiguousResult, error: ambiguousError } = await serviceClient.rpc(
    "apply_shipping_update",
    {
      p_order_number: orderNumber,
      p_tracking_number: null,
      p_carrier: null,
      p_status: "delayed",
      p_expected_delivery_date: null,
    },
  );
  expect(ambiguousError).toBeNull();
  expect(ambiguousResult).toBeNull();

  // Both packages show up as separate editable cards in the UI, and the
  // admin manual-edit form persists a change.
  await page.goto(`/orders/${orderId}`);
  await expect(page.locator('input[name="tracking_number"]')).toHaveCount(2);

  const secondPackageCard = page.locator("li", { has: page.locator(`input[value="TRACK-B-${stamp}"]`) });
  await secondPackageCard.locator('select[name="status"]').selectOption("delayed");
  await secondPackageCard.locator('input[name="carrier"]').fill("USPS");
  await secondPackageCard.getByRole("button", { name: "Save package" }).click();

  // The server action's completion isn't tied to a Playwright-visible
  // navigation event (Next.js intercepts the form submit via client JS), so
  // poll the DB directly rather than assert immediately after the click.
  await expect
    .poll(async () => {
      const { data } = await serviceClient
        .from("packages")
        .select("status, carrier")
        .eq("id", secondPackageId)
        .single();
      return data;
    })
    .toMatchObject({ status: "delayed", carrier: "USPS" });

  // Manually marking a package confirmed_received (the phone-report case)
  // stamps confirmed_source/confirmed_at rather than leaving them null.
  const firstPackageCard = page.locator("li", { has: page.locator(`input[value="TRACK-A-${stamp}"]`) });
  await firstPackageCard.locator('select[name="status"]').selectOption("confirmed_received");
  await firstPackageCard.getByRole("button", { name: "Save package" }).click();

  await expect
    .poll(async () => {
      const { data } = await serviceClient
        .from("packages")
        .select("status, confirmed_source, confirmed_at")
        .eq("id", firstPackageId)
        .single();
      return data;
    })
    .toMatchObject({ status: "confirmed_received", confirmed_source: "admin_manual" });

  const { data: packageAAfterConfirm } = await serviceClient
    .from("packages")
    .select("confirmed_at")
    .eq("id", firstPackageId)
    .single();
  expect(packageAAfterConfirm?.confirmed_at).not.toBeNull();
});

test("Active Orders shows a sub-label derived from the least-resolved package", async ({ page }) => {
  const stamp = `${Date.now()}-${test.info().project.name}`;
  const adminName = `Admin ${stamp}`;
  const propertyName = `Sub-label Property ${stamp}`;

  await signUp(page, adminName, `admin-${stamp}@example.com`);
  await promoteToAdmin(adminName);

  const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: retailer } = await serviceClient
    .from("retailers")
    .select("id")
    .eq("name", "Amazon")
    .single();
  const { data: property } = await serviceClient
    .from("properties")
    .insert({ name: propertyName, address: "1 Sub-label St" })
    .select("id")
    .single();

  const cases: { status: string; orderNumber: string; expectedLabel: string }[] = [
    { status: "delayed", orderNumber: `SUB-DELAYED-${stamp}`, expectedLabel: "Delayed" },
    { status: "delivered", orderNumber: `SUB-DELIVERED-${stamp}`, expectedLabel: "Waiting on cleaner" },
    { status: "shipped", orderNumber: `SUB-SHIPPED-${stamp}`, expectedLabel: "In transit" },
    { status: "expected", orderNumber: `SUB-EXPECTED-${stamp}`, expectedLabel: "Awaiting shipment" },
  ];

  for (const c of cases) {
    const { data: orderId } = await serviceClient.rpc("upsert_order_from_pipeline", {
      p_source: "csv",
      p_retailer_id: retailer!.id,
      p_order_number: c.orderNumber,
      p_order_date: "2026-07-20",
      p_total_amount: 10,
      p_po_number: null,
      p_items: [{ name: "Item", expected_quantity: 1, unit_price: "10.00" }],
    });
    await serviceClient.from("orders").update({ property_id: property!.id }).eq("id", orderId);
    await serviceClient.from("packages").update({ status: c.status }).eq("order_id", orderId);
  }

  await page.goto("/orders");
  for (const c of cases) {
    const row = page.locator("li", { hasText: c.orderNumber });
    // Scoped to the badge <span> - the enclosing <a>'s accessible name
    // also contains this text, which would otherwise be a second match.
    await expect(row.locator("span", { hasText: c.expectedLabel })).toBeVisible();
  }
});

