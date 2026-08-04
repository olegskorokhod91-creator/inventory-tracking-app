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

async function forceCleanerRole(name: string) {
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { error } = await adminClient.from("profiles").update({ role: "cleaner" }).eq("name", name);
  if (error) throw error;
}

test("cleaner fans a request out to other assigned houses in one submission, and never sees houses she isn't assigned to", async ({
  browser,
}) => {
  const stamp = `${Date.now()}-${test.info().project.name}`;
  const adminName = `Admin ${stamp}`;
  const cleanerName = `Cleaner ${stamp}`;
  const propertyA = `Pine House ${stamp}`;
  const propertyB = `Oak House ${stamp}`;
  const propertyC = `Elm House ${stamp}`;
  const propertyD = `Unassigned House ${stamp}`;
  const itemName = `Toilet paper ${stamp}`;

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await signUp(adminPage, adminName, `admin-${stamp}@example.com`);
  await promoteToAdmin(adminName);

  const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const propertyIds: Record<string, string> = {};
  for (const name of [propertyA, propertyB, propertyC, propertyD]) {
    const { data } = await serviceClient
      .from("properties")
      .insert({ name, address: `1 ${name}` })
      .select("id")
      .single();
    propertyIds[name] = data!.id;
  }

  const cleanerContext = await browser.newContext();
  const cleanerPage = await cleanerContext.newPage();
  await signUp(cleanerPage, cleanerName, `cleaner-${stamp}@example.com`);
  await forceCleanerRole(cleanerName);
  const { data: cleanerProfile } = await serviceClient
    .from("profiles")
    .select("id")
    .eq("name", cleanerName)
    .single();

  // Assigned to A, B, C - deliberately not D.
  await serviceClient.from("cleaner_property_assignments").insert([
    { property_id: propertyIds[propertyA], user_id: cleanerProfile!.id },
    { property_id: propertyIds[propertyB], user_id: cleanerProfile!.id },
    { property_id: propertyIds[propertyC], user_id: cleanerProfile!.id },
  ]);

  await cleanerPage.goto(`/properties/${propertyIds[propertyA]}`);

  // The "also request for" checklist only ever offers her own assigned
  // properties - D must never appear as an option.
  await expect(cleanerPage.getByText(propertyB, { exact: true })).toBeVisible();
  await expect(cleanerPage.getByText(propertyC, { exact: true })).toBeVisible();
  await expect(cleanerPage.getByText(propertyD, { exact: true })).not.toBeVisible();

  await cleanerPage.getByLabel("Item name").fill(itemName);
  await cleanerPage.getByLabel("Item name").press("Enter");
  await cleanerPage.getByLabel(propertyB, { exact: true }).check();
  await cleanerPage.getByLabel(propertyC, { exact: true }).check();
  await cleanerPage.getByRole("button", { name: "Submit request" }).click();
  await expect(cleanerPage.getByText(itemName, { exact: true })).toBeVisible();

  // All three (current + two fanned-out) got the item, each in its own
  // property-scoped batch - never a shared cross-property batch.
  for (const name of [propertyA, propertyB, propertyC]) {
    const { data: rows } = await serviceClient
      .from("supply_requests")
      .select("id, batch_id, supply_request_batches(property_id)")
      .eq("item_name", itemName)
      .eq("property_id", propertyIds[name]);
    expect(rows).toHaveLength(1);
  }
  const { data: dRows } = await serviceClient
    .from("supply_requests")
    .select("id")
    .eq("item_name", itemName)
    .eq("property_id", propertyIds[propertyD]);
  expect(dRows).toHaveLength(0);
});

test("cleaner can view but not edit order status for her assigned properties, and never sees pricing", async ({
  browser,
}) => {
  const stamp = `${Date.now()}-${test.info().project.name}`;
  const adminName = `Admin ${stamp}`;
  const cleanerName = `Cleaner ${stamp}`;
  const orderNumber = `ORD-VIEW-${stamp}`;
  const itemName = `Viewable item ${stamp}`;

  const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: retailer } = await serviceClient.from("retailers").select("id").eq("name", "Amazon").single();
  const { data: assignedProperty } = await serviceClient
    .from("properties")
    .insert({ name: `Assigned Property ${stamp}`, address: "1 Assigned St" })
    .select("id")
    .single();
  const { data: otherProperty } = await serviceClient
    .from("properties")
    .insert({ name: `Other Property ${stamp}`, address: "1 Other St" })
    .select("id")
    .single();

  const { data: viewableOrderId } = await serviceClient.rpc("create_manual_order", {
    p_retailer_id: retailer!.id,
    p_property_id: assignedProperty!.id,
    p_order_number: orderNumber,
    p_order_date: "2026-08-01",
    p_total_amount: 123.45,
    p_items: [{ name: itemName, expected_quantity: 3, unit_price: "41.15" }],
  });
  const { data: hiddenOrderId } = await serviceClient.rpc("create_manual_order", {
    p_retailer_id: retailer!.id,
    p_property_id: otherProperty!.id,
    p_order_number: `ORD-HIDDEN-${stamp}`,
    p_order_date: "2026-08-01",
    p_total_amount: 50,
    p_items: [{ name: `Hidden item ${stamp}`, expected_quantity: 1, unit_price: "50.00" }],
  });

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await signUp(adminPage, adminName, `admin-${stamp}@example.com`);
  await promoteToAdmin(adminName);

  const cleanerContext = await browser.newContext();
  const cleanerPage = await cleanerContext.newPage();
  await signUp(cleanerPage, cleanerName, `cleaner-${stamp}@example.com`);
  await forceCleanerRole(cleanerName);
  const { data: cleanerProfile } = await serviceClient
    .from("profiles")
    .select("id")
    .eq("name", cleanerName)
    .single();
  await serviceClient
    .from("cleaner_property_assignments")
    .insert({ property_id: assignedProperty!.id, user_id: cleanerProfile!.id });

  // Nav shows an "Orders" link for the cleaner.
  await cleanerPage.goto("/properties");
  await cleanerPage.getByLabel("Menu").click();
  await expect(cleanerPage.getByRole("link", { name: "Orders" })).toBeVisible();

  // List page: sees the order for her assigned property, never the total.
  await cleanerPage.goto("/my-orders");
  await expect(cleanerPage.getByText(`#${orderNumber}`)).toBeVisible();
  await expect(cleanerPage.getByText("123.45")).not.toBeVisible();
  await expect(cleanerPage.getByText(`ORD-HIDDEN-${stamp}`)).not.toBeVisible();

  // Detail page: sees item name/quantity and status, never price. No edit
  // forms/buttons anywhere - read-only really means read-only.
  await cleanerPage.goto(`/my-orders/${viewableOrderId}`);
  await expect(cleanerPage.getByText(itemName, { exact: true })).toBeVisible();
  await expect(cleanerPage.getByText("x3", { exact: true })).toBeVisible();
  await expect(cleanerPage.getByText("41.15")).not.toBeVisible();
  await expect(cleanerPage.getByText("123.45")).not.toBeVisible();
  await expect(cleanerPage.getByRole("button", { name: /save/i })).not.toBeVisible();
  await expect(cleanerPage.getByRole("button", { name: "Remove" })).not.toBeVisible();
  await expect(cleanerPage.locator('select[name="status"]')).toHaveCount(0);
  await expect(cleanerPage.locator('input[name="retailer_id"], select[name="retailer_id"]')).toHaveCount(0);

  // RLS is the real gate, not just this page not linking to it - a property
  // she isn't assigned to must 404, not leak data.
  await cleanerPage.goto(`/my-orders/${hiddenOrderId}`);
  await expect(cleanerPage.getByText("404")).toBeVisible();

  // Admin's own /orders/[id] is untouched - still fully editable.
  await adminPage.goto(`/orders/${viewableOrderId}`);
  await expect(adminPage.getByRole("button", { name: "Save", exact: true })).toBeVisible();
});
