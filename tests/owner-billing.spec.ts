import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "http://127.0.0.1:54321";
// Fixed local Supabase dev key (identical for every `supabase start`, not a
// real secret) - same fixture shortcut used across this project's other
// specs, local Docker only.
const SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

async function signUp(page: Page, name: string, email: string) {
  await page.goto("/signup");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Sign up" }).click();
  // Role-based landing (M5): admins land on /properties, cleaners on
  // /confirmations - this helper is used for both, so accept either.
  await expect(page).toHaveURL(/\/(properties|confirmations)/, { timeout: 15000 });
}

async function promoteToAdmin(name: string) {
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { error } = await adminClient
    .from("profiles")
    .update({ role: "admin" })
    .eq("name", name);
  if (error) throw error;
}

test("owner billing report excludes cancelled orders and refunded items, rolls up by owner, and exports what's shown", async ({
  page,
}) => {
  const stamp = `${Date.now()}-${test.info().project.name}`;
  const adminName = `Admin ${stamp}`;
  const propertyA = `Property Alpha ${stamp}`;
  const propertyB = `Property Beta ${stamp}`;
  const ownerName = `Owner ${stamp}`;

  await signUp(page, adminName, `admin-${stamp}@example.com`);
  await promoteToAdmin(adminName);
  // A plain reload() would just re-fetch whatever URL signUp() landed on -
  // if that happened to be /confirmations (cleaner role at signup time,
  // before this promotion), reload() never gets to /properties at all.
  // goto() re-runs the role-based landing redirect for real.
  await page.goto("/properties");

  // Two properties, one owner spanning both - exercises the owner roll-up.
  for (const [name, address] of [
    [propertyA, "1 Alpha St"],
    [propertyB, "2 Beta Ave"],
  ]) {
    await page.goto("/properties");
    await page.getByPlaceholder("Name").fill(name);
    await page.getByPlaceholder("Address").fill(address);
    await page.getByRole("button", { name: "Add property" }).click();
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  }

  await page.goto("/owners");
  await page.getByPlaceholder("Name").fill(ownerName);
  await page.getByRole("button", { name: "Add owner" }).click();
  await expect(page.getByText(ownerName, { exact: true })).toBeVisible();

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: owner } = await adminClient
    .from("owners")
    .select("id")
    .eq("name", ownerName)
    .single();
  const { data: properties } = await adminClient
    .from("properties")
    .select("id, name")
    .in("name", [propertyA, propertyB]);
  const propA = properties!.find((p) => p.name === propertyA)!;
  const propB = properties!.find((p) => p.name === propertyB)!;

  await adminClient
    .from("properties")
    .update({ owner_id: owner!.id })
    .in("id", [propA.id, propB.id]);

  // Seed orders via the same RPC the CSV pipeline uses, covering: a normal
  // order, a cancelled one (must be excluded entirely), a second property's
  // order flagged requires_attention (must show but be flagged, not
  // silently treated as final), and a multi-item order with one item
  // refunded (must drop only that item's cost/qty, not the whole order).
  const { data: retailer } = await adminClient
    .from("retailers")
    .select("id")
    .eq("name", "Amazon")
    .single();

  const orderDefs = [
    {
      p_order_number: `NORMAL-A-${stamp}`,
      p_order_date: "2026-07-20",
      p_total_amount: 26.5,
      p_po_number: propertyA,
      p_items: [{ name: "Paper Towels", expected_quantity: 1, unit_price: "25.00" }],
      p_retailer_order_status: "Closed",
      property: propA.id,
      requiresAttention: false,
    },
    {
      p_order_number: `CANCELLED-A-${stamp}`,
      p_order_date: "2026-07-21",
      p_total_amount: 0,
      p_po_number: propertyA,
      p_items: [{ name: "Cancelled Coffee Maker", expected_quantity: 1, unit_price: "50.00" }],
      p_retailer_order_status: "Cancelled",
      property: propA.id,
      requiresAttention: false,
    },
    {
      p_order_number: `NORMAL-B-${stamp}`,
      p_order_date: "2026-07-22",
      p_total_amount: 15.9,
      p_po_number: propertyB,
      p_items: [{ name: "Trash Bags", expected_quantity: 1, unit_price: "15.00" }],
      p_retailer_order_status: "Closed",
      property: propB.id,
      requiresAttention: true,
    },
    {
      p_order_number: `REFUND-A-${stamp}`,
      p_order_date: "2026-07-23",
      p_total_amount: 40,
      p_po_number: propertyA,
      p_items: [
        { name: "Refunded Item", expected_quantity: 1, unit_price: "10.00" },
        { name: "Kept Item", expected_quantity: 2, unit_price: "15.00" },
      ],
      p_retailer_order_status: "Closed",
      property: propA.id,
      requiresAttention: false,
    },
  ];

  let refundOrderId = "";
  for (const def of orderDefs) {
    const { data: orderId, error } = await adminClient.rpc("upsert_order_from_pipeline", {
      p_source: "csv",
      p_retailer_id: retailer!.id,
      p_order_number: def.p_order_number,
      p_order_date: def.p_order_date,
      p_total_amount: def.p_total_amount,
      p_po_number: def.p_po_number,
      p_items: def.p_items,
      p_retailer_order_status: def.p_retailer_order_status,
    });
    if (error) throw error;

    await adminClient
      .from("orders")
      .update({ property_id: def.property, requires_attention: def.requiresAttention })
      .eq("id", orderId);

    if (def.p_order_number.startsWith("REFUND-A")) refundOrderId = orderId;
  }

  // Mark "Refunded Item" as refunded through the real UI toggle - this is
  // the one manual-entry point the pipeline can't populate on its own.
  await page.goto(`/orders/${refundOrderId}`);
  await expect(page.getByText("Refunded Item")).toBeVisible();
  const refundedRow = page.locator("li", { hasText: "Refunded Item" });
  await refundedRow.getByRole("checkbox").check();
  await expect(page.getByText("Refunded Item")).toHaveClass(/line-through/);

  // Filtered to this test's own owner - the dev DB may carry other
  // properties/orders (from manual testing or other spec runs), and the
  // report deliberately aggregates everything when no filter narrows it.
  await page.goto(`/reports/owner-billing?owner_id=${owner!.id}`);

  // Cancelled order and the refunded item are gone; the owner-spanning
  // properties are rolled up with a subtotal; requires_attention is flagged
  // rather than silently swallowed.
  // 25 (A) + 15 (B) + 30 (kept item) - scoped to the summary card's <p>,
  // since the owner roll-up subtotal happens to show the same total here
  // (this owner's only two properties are both in the filtered result).
  await expect(
    page.locator("p", { hasText: /^Total spend$/ }).locator("xpath=following-sibling::p"),
  ).toHaveText("$70.00");
  // Scoped to <p> tags specifically - the nav bar also has "Orders" as a
  // link, which would otherwise collide with the summary card's label.
  await expect(
    page.locator("p", { hasText: /^Orders$/ }).locator("xpath=following-sibling::p"),
  ).toHaveText("3");
  await expect(
    page.locator("p", { hasText: /^Items$/ }).locator("xpath=following-sibling::p"),
  ).toHaveText("4");
  await expect(page.getByText("Cancelled Coffee Maker")).not.toBeVisible();
  await expect(page.getByText("Refunded Item", { exact: true })).not.toBeVisible();
  await expect(page.getByText("Kept Item")).toBeVisible();
  await expect(page.getByRole("heading", { name: ownerName })).toBeVisible();
  await expect(page.getByText("Requires attention")).toBeVisible();

  // Export matches exactly what's on screen for the applied filters.
  const csvResponse = await page.request.get(
    `/api/reports/owner-billing/export?format=csv&owner_id=${owner!.id}`,
  );
  expect(csvResponse.ok()).toBe(true);
  const csvBody = await csvResponse.text();
  expect(csvBody).toContain("Kept Item");
  expect(csvBody).not.toContain("Cancelled Coffee Maker");
  expect(csvBody).not.toContain("Refunded Item");

  const xlsxResponse = await page.request.get(
    `/api/reports/owner-billing/export?format=xlsx&owner_id=${owner!.id}`,
  );
  expect(xlsxResponse.ok()).toBe(true);
  expect(xlsxResponse.headers()["content-type"]).toContain("spreadsheetml");
});

test("cleaners cannot access the owner billing report or export", async ({ page }) => {
  const stamp = `${Date.now()}-${test.info().project.name}`;
  const cleanerName = `Cleaner ${stamp}`;

  await signUp(page, cleanerName, `cleaner-${stamp}@example.com`);

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  await adminClient.from("profiles").update({ role: "cleaner" }).eq("name", cleanerName);

  await page.goto("/reports/owner-billing");
  await expect(page).toHaveURL("/properties");

  const csvResponse = await page.request.get("/api/reports/owner-billing/export?format=csv");
  expect(csvResponse.status()).toBe(403);
});
