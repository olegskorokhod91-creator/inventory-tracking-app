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

test("requests from separate visits append to one open batch, mark-ordered creates a tracked placeholder, and a new visit after the batch closes starts a fresh batch", async ({
  browser,
}) => {
  const stamp = `${Date.now()}-${test.info().project.name}`;
  const adminName = `Admin ${stamp}`;
  const cleanerName = `Cleaner ${stamp}`;
  const propertyName = `Fulfillment Property ${stamp}`;
  const itemA = `Paper towels ${stamp}`;
  const itemB = `Light bulbs ${stamp}`;
  const itemC = `Dish soap ${stamp}`;

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await signUp(adminPage, adminName, `admin-${stamp}@example.com`);
  await promoteToAdmin(adminName);
  await adminPage.goto("/properties");

  // Also exercises the new po_number field (pre-filled from address, still
  // editable) - the AddressAndPoFields component.
  await adminPage.getByPlaceholder("Name").fill(propertyName);
  await adminPage.getByLabel("Address").fill("1 Fulfillment St");
  await adminPage.getByRole("button", { name: "Add property" }).click();
  await adminPage.getByText(propertyName, { exact: true }).click();
  await adminPage.waitForURL(/\/properties\/[0-9a-f-]+$/);
  const propertyUrl = adminPage.url();

  const seedClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: createdProperty } = await seedClient
    .from("properties")
    .select("po_number")
    .eq("name", propertyName)
    .single();
  expect(createdProperty?.po_number).toBe("1 Fulfillment St");

  const cleanerContext = await browser.newContext();
  const cleanerPage = await cleanerContext.newPage();
  await signUp(cleanerPage, cleanerName, `cleaner-${stamp}@example.com`);

  await adminPage.reload();
  await adminPage.getByLabel("Assign cleaner").selectOption({ label: cleanerName });
  await adminPage.getByRole("button", { name: "Assign" }).click();
  await expect(adminPage.getByText(cleanerName)).toBeVisible();

  // First visit: cleaner requests item A.
  await cleanerPage.goto(propertyUrl);
  await cleanerPage.getByLabel("Item name").fill(itemA);
  await cleanerPage.getByLabel("Item name").press("Enter");
  await cleanerPage.getByRole("button", { name: "Submit request" }).click();
  await expect(cleanerPage.getByText(itemA, { exact: true })).toBeVisible();

  // Second, separate visit: cleaner requests item B. Should append to the
  // SAME open batch, not start a second one.
  await cleanerPage.goto(propertyUrl);
  await cleanerPage.getByLabel("Item name").fill(itemB);
  await cleanerPage.getByLabel("Item name").press("Enter");
  await cleanerPage.getByRole("button", { name: "Submit request" }).click();
  await expect(cleanerPage.getByText(itemB, { exact: true })).toBeVisible();

  await adminPage.goto("/requests");
  const batchCard = adminPage.locator("li", { has: adminPage.locator(`text=${propertyName}`) });
  await expect(batchCard).toHaveCount(1);
  await expect(batchCard.locator("span", { hasText: itemA })).toBeVisible();
  await expect(batchCard.locator("span", { hasText: itemB })).toBeVisible();

  // Mark only item A ordered (uncheck item B) - partial fulfillment.
  await batchCard.getByLabel(new RegExp(itemB)).uncheck();
  await batchCard.locator('select[name="retailer_id"]').selectOption({ label: "Amazon" });
  await batchCard.getByRole("button", { name: "Mark as ordered" }).click();

  await expect
    .poll(async () => {
      const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
      const { data } = await serviceClient
        .from("supply_requests")
        .select("item_name, ordered_order_id")
        .in("item_name", [itemA, itemB]);
      return data?.map((r) => ({ item_name: r.item_name, ordered: r.ordered_order_id !== null }));
    })
    .toEqual(
      expect.arrayContaining([
        { item_name: itemA, ordered: true },
        { item_name: itemB, ordered: false },
      ]),
    );

  // The placeholder order shows up in Active Orders with the pending label,
  // not the normal package-derived one.
  await adminPage.goto("/orders");
  const orderRow = adminPage.locator("li", { hasText: propertyName });
  await expect(orderRow.getByText("Ordered — Awaiting Confirmation")).toBeVisible();

  // Now mark item B ordered too - the batch is fully ordered, so it should
  // close (no longer accept new items).
  await adminPage.goto("/requests");
  const batchCardAgain = adminPage.locator("li", { has: adminPage.locator(`text=${propertyName}`) });
  await batchCardAgain.locator('select[name="retailer_id"]').selectOption({ label: "Amazon" });
  await batchCardAgain.getByRole("button", { name: "Mark as ordered" }).click();

  await expect
    .poll(async () => {
      const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
      const { data: property } = await serviceClient
        .from("properties")
        .select("id")
        .eq("name", propertyName)
        .single();
      const { data: batch } = await serviceClient
        .from("supply_request_batches")
        .select("status")
        .eq("property_id", property!.id)
        .single();
      return batch?.status;
    })
    .toBe("closed");

  // Third visit, after the batch closed: should start a brand new batch,
  // not append to (or be blocked by) the now-closed one.
  await cleanerPage.goto(propertyUrl);
  await cleanerPage.getByLabel("Item name").fill(itemC);
  await cleanerPage.getByLabel("Item name").press("Enter");
  await cleanerPage.getByRole("button", { name: "Submit request" }).click();
  await expect(cleanerPage.getByText(itemC, { exact: true })).toBeVisible();

  const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: property } = await serviceClient
    .from("properties")
    .select("id")
    .eq("name", propertyName)
    .single();
  const { data: batchesForProperty } = await serviceClient
    .from("supply_request_batches")
    .select("id, status")
    .eq("property_id", property!.id);
  expect(batchesForProperty).toHaveLength(2);
  expect(batchesForProperty!.filter((b) => b.status === "open")).toHaveLength(1);
  expect(batchesForProperty!.filter((b) => b.status === "closed")).toHaveLength(1);
});

test("PDF reconciliation: consumes the placeholder for the first order number, creates an additional linked order for a second, and only fulfills the batch once every item is resolved", async ({
  page,
}) => {
  const stamp = `${Date.now()}-${test.info().project.name}`;
  const adminName = `Admin ${stamp}`;
  const propertyName = `Reconcile Property ${stamp}`;

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
    .insert({ name: propertyName, address: "1 Reconcile St", po_number: `PO-${stamp}` })
    .select("id")
    .single();
  const { data: adminProfile } = await serviceClient
    .from("profiles")
    .select("id")
    .eq("name", adminName)
    .single();

  // create_supply_request_batch sets created_by = auth.uid(), which is null
  // for a service-role caller - it inherently needs an authenticated
  // session, so seed directly here instead (using the admin's own profile
  // id) rather than going through the RPC as this suite's other specs do
  // for RPCs that don't depend on auth.uid().
  const { data: batch } = await serviceClient
    .from("supply_request_batches")
    .insert({ property_id: property!.id, created_by: adminProfile!.id })
    .select("id")
    .single();
  const batchId = batch!.id;
  await serviceClient.from("supply_requests").insert([
    { batch_id: batchId, property_id: property!.id, created_by: adminProfile!.id, item_name: "Hot tub shock" },
    { batch_id: batchId, property_id: property!.id, created_by: adminProfile!.id, item_name: "Toilet paper" },
  ]);

  const { data: requestRows } = await serviceClient
    .from("supply_requests")
    .select("id, item_name")
    .eq("batch_id", batchId);
  const shockRequestId = requestRows!.find((r) => r.item_name === "Hot tub shock")!.id;
  const paperRequestId = requestRows!.find((r) => r.item_name === "Toilet paper")!.id;

  // Admin marks both items ordered in one placeholder (real "mark ordered"
  // action would run as the admin session; using the service client here is
  // just the seeding shortcut this suite always uses for RPC calls).
  const { data: placeholderOrderId } = await serviceClient.rpc("mark_supply_requests_ordered", {
    p_batch_id: batchId,
    p_request_ids: [shockRequestId, paperRequestId],
    p_retailer_id: retailer!.id,
  });

  const { data: placeholderBefore } = await serviceClient
    .from("orders")
    .select("order_number, source")
    .eq("id", placeholderOrderId)
    .single();
  expect(placeholderBefore?.order_number).toBeNull();
  expect(placeholderBefore?.source).toBe("request_fulfillment");

  // First PDF: Amazon's first split order number. Consumes the placeholder
  // in place, only resolves the item actually found in this shipment.
  const { data: firstOrderId, error: firstError } = await serviceClient.rpc(
    "reconcile_pdf_invoice_order",
    {
      p_existing_order_id: placeholderOrderId,
      p_property_id: property!.id,
      p_retailer_id: retailer!.id,
      p_order_number: `113-AAA-${stamp}`,
      p_order_date: "2026-06-20",
      p_total_amount: 56.99,
      p_request_batch_id: batchId,
      p_shipments: [{ items: [{ name: "Aquadoc Non-Chlorine Spa Shock", expected_quantity: 1, unit_price: 56.99 }] }],
      p_resolved_request_ids: [shockRequestId],
      p_pdf_import_id: null,
    },
  );
  expect(firstError).toBeNull();
  expect(firstOrderId).toBe(placeholderOrderId);

  const { data: firstOrderAfter } = await serviceClient
    .from("orders")
    .select("order_number, source, request_batch_id")
    .eq("id", firstOrderId)
    .single();
  expect(firstOrderAfter?.order_number).toBe(`113-AAA-${stamp}`);
  expect(firstOrderAfter?.request_batch_id).toBe(batchId);

  const { data: shockRequestAfterFirst } = await serviceClient
    .from("supply_requests")
    .select("resolved_by_order_id")
    .eq("id", shockRequestId)
    .single();
  expect(shockRequestAfterFirst?.resolved_by_order_id).toBe(firstOrderId);

  const { data: paperRequestAfterFirst } = await serviceClient
    .from("supply_requests")
    .select("resolved_by_order_id")
    .eq("id", paperRequestId)
    .single();
  expect(paperRequestAfterFirst?.resolved_by_order_id).toBeNull();

  // Second PDF: Amazon split the same purchase into a second order number.
  // No placeholder left to consume for it - must create an ADDITIONAL
  // order, not overwrite the first, but still link back to the same batch.
  const { data: secondOrderId, error: secondError } = await serviceClient.rpc(
    "reconcile_pdf_invoice_order",
    {
      p_existing_order_id: null,
      p_property_id: property!.id,
      p_retailer_id: retailer!.id,
      p_order_number: `113-BBB-${stamp}`,
      p_order_date: "2026-06-20",
      p_total_amount: 22.56,
      p_request_batch_id: batchId,
      p_shipments: [{ items: [{ name: "Amazon Basics 2-Ply Toilet Paper", expected_quantity: 1, unit_price: 22.56 }] }],
      p_resolved_request_ids: [paperRequestId],
      p_pdf_import_id: null,
    },
  );
  expect(secondError).toBeNull();
  expect(secondOrderId).not.toBe(firstOrderId);

  const { data: ordersForBatch } = await serviceClient
    .from("orders")
    .select("id, order_number")
    .eq("request_batch_id", batchId)
    .order("order_number");
  expect(ordersForBatch).toHaveLength(2);

  // Batch is now fully accounted for - every item resolved by some real
  // order. Both orders show up on the Requests screen for this batch.
  const { data: allRequestsResolved } = await serviceClient
    .from("supply_requests")
    .select("resolved_by_order_id")
    .eq("batch_id", batchId);
  expect(allRequestsResolved!.every((r) => r.resolved_by_order_id !== null)).toBe(true);

  await page.goto("/requests");
  // Fully resolved batches drop off the Requests screen's "needs attention"
  // list entirely.
  await expect(page.getByText(propertyName)).not.toBeVisible();

  // Both real orders are independently visible in Active Orders, each with
  // its own order number - never merged into one order record.
  await page.goto("/orders");
  await expect(page.getByText(`#113-AAA-${stamp}`)).toBeVisible();
  await expect(page.getByText(`#113-BBB-${stamp}`)).toBeVisible();
});

test("cleaner can remove their own still-open request, but loses that option once it's marked ordered", async ({
  browser,
}) => {
  const stamp = `${Date.now()}-${test.info().project.name}`;
  const adminName = `Admin ${stamp}`;
  const cleanerName = `Cleaner ${stamp}`;
  const propertyName = `Cancel Request Property ${stamp}`;
  const itemA = `Trash bags ${stamp}`;
  const itemB = `Batteries ${stamp}`;

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await signUp(adminPage, adminName, `admin-${stamp}@example.com`);
  await promoteToAdmin(adminName);
  await adminPage.goto("/properties");
  await adminPage.getByPlaceholder("Name").fill(propertyName);
  await adminPage.getByPlaceholder("Address").fill("1 Cancel St");
  await adminPage.getByRole("button", { name: "Add property" }).click();
  await adminPage.getByText(propertyName, { exact: true }).click();
  await adminPage.waitForURL(/\/properties\/[0-9a-f-]+$/);
  const propertyUrl = adminPage.url();

  const cleanerContext = await browser.newContext();
  const cleanerPage = await cleanerContext.newPage();
  await signUp(cleanerPage, cleanerName, `cleaner-${stamp}@example.com`);

  await adminPage.reload();
  await adminPage.getByLabel("Assign cleaner").selectOption({ label: cleanerName });
  await adminPage.getByRole("button", { name: "Assign" }).click();
  await expect(adminPage.getByText(cleanerName)).toBeVisible();

  await cleanerPage.goto(propertyUrl);
  await cleanerPage.getByLabel("Item name").fill(itemA);
  await cleanerPage.getByLabel("Item name").press("Enter");
  await cleanerPage.getByRole("button", { name: "Submit request" }).click();
  await expect(cleanerPage.getByText(itemA, { exact: true })).toBeVisible();

  // Removes it themselves (their own, still open) - the native confirm()
  // dialog needs an explicit accept, Playwright dismisses by default.
  cleanerPage.once("dialog", (dialog) => dialog.accept());
  await cleanerPage
    .locator("li", { hasText: itemA })
    .getByRole("button", { name: "Remove" })
    .click();
  await expect(cleanerPage.getByText(itemA, { exact: true })).not.toBeVisible();

  // Second item: once an admin marks it ordered, it's no longer just a
  // draft mistake - the Remove option should disappear for the cleaner too.
  await cleanerPage.goto(propertyUrl);
  await cleanerPage.getByLabel("Item name").fill(itemB);
  await cleanerPage.getByLabel("Item name").press("Enter");
  await cleanerPage.getByRole("button", { name: "Submit request" }).click();
  await expect(cleanerPage.getByText(itemB, { exact: true })).toBeVisible();

  await adminPage.goto("/requests");
  const batchCard = adminPage.locator("li", { has: adminPage.locator(`text=${propertyName}`) });
  await batchCard.locator('select[name="retailer_id"]').selectOption({ label: "Amazon" });
  await batchCard.getByRole("button", { name: "Mark as ordered" }).click();

  await expect
    .poll(async () => {
      const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
      const { data } = await serviceClient
        .from("supply_requests")
        .select("ordered_order_id")
        .eq("item_name", itemB)
        .single();
      return data?.ordered_order_id !== null;
    })
    .toBe(true);

  await cleanerPage.goto(propertyUrl);
  await expect(
    cleanerPage.locator("li", { hasText: itemB }).getByRole("button", { name: "Remove" }),
  ).not.toBeVisible();

  // RLS is the real gate, not just the hidden button - a direct delete
  // attempt against an already-ordered row must still fail.
  const ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
  const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: itemBRow } = await serviceClient
    .from("supply_requests")
    .select("id")
    .eq("item_name", itemB)
    .single();

  const anonClient = createClient(SUPABASE_URL, ANON_KEY);
  const { data: signInData } = await anonClient.auth.signInWithPassword({
    email: `cleaner-${stamp}@example.com`,
    password: "password123",
  });
  const cleanerDbClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${signInData!.session!.access_token}` } },
  });
  await cleanerDbClient.from("supply_requests").delete().eq("id", itemBRow!.id);

  const { data: stillThere } = await serviceClient
    .from("supply_requests")
    .select("id")
    .eq("id", itemBRow!.id)
    .maybeSingle();
  expect(stillThere).not.toBeNull();
});

test("admin can remove an order item, but gets a friendly error for one already confirmed received", async ({
  page,
}) => {
  const stamp = `${Date.now()}-${test.info().project.name}`;
  const adminName = `Admin ${stamp}`;
  const orderNumber = `ORD-DELETE-${stamp}`;

  await signUp(page, adminName, `admin-${stamp}@example.com`);
  await promoteToAdmin(adminName);

  const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: retailer } = await serviceClient.from("retailers").select("id").eq("name", "Amazon").single();
  const { data: property } = await serviceClient
    .from("properties")
    .insert({ name: `Delete Item Property ${stamp}`, address: "1 Delete St" })
    .select("id")
    .single();

  const { data: orderId } = await serviceClient.rpc("create_manual_order", {
    p_retailer_id: retailer!.id,
    p_property_id: property!.id,
    p_order_number: orderNumber,
    p_order_date: "2026-07-31",
    p_total_amount: 30,
    p_items: [
      { name: `Mistaken item ${stamp}`, expected_quantity: 1, unit_price: "10.00" },
      { name: `Confirmed item ${stamp}`, expected_quantity: 1, unit_price: "20.00" },
    ],
  });

  const { data: items } = await serviceClient
    .from("order_items")
    .select("id, name")
    .eq("order_id", orderId);
  const mistakenItem = items!.find((i) => i.name.startsWith("Mistaken"))!;
  const confirmedItem = items!.find((i) => i.name.startsWith("Confirmed"))!;

  // Seed confirmed-received history for the second item directly - a real
  // package_confirmation_items row referencing it, same shape M5's
  // confirm_package_delivery RPC would produce.
  const { data: pkg } = await serviceClient.from("packages").select("id").eq("order_id", orderId).single();
  const { data: adminProfile } = await serviceClient.from("profiles").select("id").eq("name", adminName).single();
  const { data: confirmation } = await serviceClient
    .from("package_confirmations")
    .insert({ package_id: pkg!.id, reported_by: adminProfile!.id, outcome: "all_correct" })
    .select("id")
    .single();
  await serviceClient
    .from("package_confirmation_items")
    .insert({ package_confirmation_id: confirmation!.id, order_item_id: confirmedItem.id, actual_quantity: 1 });

  await page.goto(`/orders/${orderId}`);

  page.once("dialog", (dialog) => dialog.accept());
  await page
    .locator("li", { hasText: mistakenItem.name })
    .getByRole("button", { name: "Remove" })
    .click();
  await expect(page.getByText(mistakenItem.name, { exact: true })).not.toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page
    .locator("li", { hasText: confirmedItem.name })
    .getByRole("button", { name: "Remove" })
    .click();
  await expect(page.getByText(/already been confirmed as received/)).toBeVisible();
  await expect(page.getByText(confirmedItem.name, { exact: true })).toBeVisible();

  const { data: remainingItems } = await serviceClient
    .from("order_items")
    .select("id")
    .eq("order_id", orderId);
  expect(remainingItems).toHaveLength(1);
});
