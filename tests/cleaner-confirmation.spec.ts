import path from "path";
import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "http://127.0.0.1:54321";
// Fixed local Supabase dev key (identical for every `supabase start`, not a
// real secret) - same fixture shortcut used across this project's other specs.
const SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const CONFIRMATION_PHOTO = path.join(process.cwd(), "tests", "fixtures", "confirmation-photo.jpg");

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function seedDeliveredPackage(serviceClient: any, propertyId: string, orderNumber: string) {
  const { data: retailer } = await serviceClient.from("retailers").select("id").eq("name", "Amazon").single();
  const { data: orderId } = await serviceClient.rpc("upsert_order_from_pipeline", {
    p_source: "csv",
    p_retailer_id: retailer!.id,
    p_order_number: orderNumber,
    p_order_date: "2026-07-29",
    p_total_amount: 40,
    p_po_number: null,
    p_items: [
      { name: "Paper Towels", expected_quantity: 2, unit_price: "10.00" },
      { name: "Trash Bags", expected_quantity: 1, unit_price: "20.00" },
    ],
  });
  await serviceClient.from("orders").update({ property_id: propertyId }).eq("id", orderId as string);
  const { data: pkg } = await serviceClient
    .from("packages")
    .select("id")
    .eq("order_id", orderId as string)
    .single();
  await serviceClient.from("packages").update({ status: "delivered" }).eq("id", pkg!.id);
  return { orderId: orderId as string, packageId: pkg!.id as string };
}

test("cleaner confirms everything correct - fast path sets confirmed_received, never touches requires_attention", async ({
  browser,
}) => {
  const stamp = `${Date.now()}-${test.info().project.name}`;
  const adminName = `Admin ${stamp}`;
  const cleanerName = `Cleaner ${stamp}`;
  const propertyName = `Confirm Property ${stamp}`;

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await signUp(adminPage, adminName, `admin-${stamp}@example.com`);
  await promoteToAdmin(adminName);
  // A plain reload() would just re-fetch whatever URL signUp() landed on -
  // if that happened to be /confirmations (cleaner role at signup time,
  // before this promotion), reload() never gets to /properties at all.
  // goto() re-runs the role-based landing redirect for real.
  await adminPage.goto("/properties");

  const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: property } = await serviceClient
    .from("properties")
    .insert({ name: propertyName, address: "1 Confirm St" })
    .select("id")
    .single();

  const cleanerContext = await browser.newContext();
  const cleanerPage = await cleanerContext.newPage();
  await signUp(cleanerPage, cleanerName, `cleaner-${stamp}@example.com`);

  const { data: cleaner } = await serviceClient.from("profiles").select("id").eq("name", cleanerName).single();
  await serviceClient
    .from("cleaner_property_assignments")
    .insert({ property_id: property!.id, user_id: cleaner!.id });

  const { orderId, packageId } = await seedDeliveredPackage(
    serviceClient,
    property!.id as string,
    `CONFIRM-OK-${stamp}`,
  );

  // Cleaners land here directly post-login (M5) - re-navigate to pick up
  // the just-created assignment/package rather than relying on stale state
  // from signup.
  await cleanerPage.goto("/confirmations");
  await expect(cleanerPage.getByText(propertyName)).toBeVisible();
  await expect(cleanerPage.getByText(`#CONFIRM-OK-${stamp}`)).toBeVisible();

  await cleanerPage.goto(`/confirmations/${packageId}`);
  await expect(cleanerPage.getByText("Paper Towels")).toBeVisible();
  await cleanerPage.getByRole("button", { name: "Everything received correctly" }).click();
  await expect(cleanerPage).toHaveURL("/confirmations");
  await expect(cleanerPage.getByText(propertyName)).not.toBeVisible();

  await expect
    .poll(async () => {
      const { data } = await serviceClient
        .from("packages")
        .select("status, confirmed_source, confirmed_by")
        .eq("id", packageId)
        .single();
      return data;
    })
    .toMatchObject({ status: "confirmed_received", confirmed_source: "cleaner_app" });

  const { data: order } = await serviceClient
    .from("orders")
    .select("requires_attention")
    .eq("id", orderId)
    .single();
  expect(order?.requires_attention).toBe(false);

  await adminContext.close();
  await cleanerContext.close();
});

test("cleaner reports damaged items with quantities, a note, and a photo - trigger sets requires_attention, admin sees full history", async ({
  browser,
}) => {
  const stamp = `${Date.now()}-${test.info().project.name}`;
  const adminName = `Admin ${stamp}`;
  const cleanerName = `Cleaner ${stamp}`;
  const propertyName = `Damaged Property ${stamp}`;

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await signUp(adminPage, adminName, `admin-${stamp}@example.com`);
  await promoteToAdmin(adminName);
  // A plain reload() would just re-fetch whatever URL signUp() landed on -
  // if that happened to be /confirmations (cleaner role at signup time,
  // before this promotion), reload() never gets to /properties at all.
  // goto() re-runs the role-based landing redirect for real.
  await adminPage.goto("/properties");

  const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: property } = await serviceClient
    .from("properties")
    .insert({ name: propertyName, address: "1 Damaged St" })
    .select("id")
    .single();

  const cleanerContext = await browser.newContext();
  const cleanerPage = await cleanerContext.newPage();
  await signUp(cleanerPage, cleanerName, `cleaner-${stamp}@example.com`);

  const { data: cleaner } = await serviceClient.from("profiles").select("id").eq("name", cleanerName).single();
  await serviceClient
    .from("cleaner_property_assignments")
    .insert({ property_id: property!.id, user_id: cleaner!.id });

  const { orderId, packageId } = await seedDeliveredPackage(
    serviceClient,
    property!.id as string,
    `CONFIRM-DAMAGED-${stamp}`,
  );

  await cleanerPage.goto(`/confirmations/${packageId}`);
  await cleanerPage.getByRole("button", { name: "Damaged items" }).click();
  await cleanerPage.getByLabel("Note for Paper Towels").fill("1 roll torn open");
  await cleanerPage.getByLabel("Note (optional)").fill("Box was crushed in transit");
  await cleanerPage.locator('input[type="file"]').setInputFiles(CONFIRMATION_PHOTO);
  await cleanerPage.getByRole("button", { name: "Submit" }).click();
  await expect(cleanerPage).toHaveURL("/confirmations");

  await expect
    .poll(async () => {
      const { data } = await serviceClient.from("packages").select("status").eq("id", packageId).single();
      return data?.status;
    })
    .toBe("requires_attention");

  const { data: order } = await serviceClient
    .from("orders")
    .select("requires_attention")
    .eq("id", orderId)
    .single();
  expect(order?.requires_attention).toBe(true);

  const { data: confirmation } = await serviceClient
    .from("package_confirmations")
    .select("outcome, note, photo_path, reported_by, package_confirmation_items(actual_quantity, item_note)")
    .eq("package_id", packageId)
    .single();
  expect(confirmation?.outcome).toBe("damaged");
  expect(confirmation?.photo_path).toContain(packageId);
  expect(confirmation?.reported_by).toBe(cleaner!.id);

  // Admin sees the full confirmation history, including the photo.
  await adminPage.goto(`/orders/${orderId}`);
  await expect(adminPage.getByText("Requires attention")).toBeVisible();
  await expect(adminPage.getByText("Confirmation history")).toBeVisible();
  await expect(adminPage.getByText("Box was crushed in transit")).toBeVisible();
  await expect(adminPage.getByText("1 roll torn open")).toBeVisible();
  await expect(adminPage.getByAltText("Confirmation photo")).toBeVisible();

  await adminContext.close();
  await cleanerContext.close();
});

test("a photo over the 5MB bucket limit is compressed client-side and still uploads", async ({ browser }) => {
  const stamp = `${Date.now()}-${test.info().project.name}`;
  const adminName = `Admin ${stamp}`;
  const cleanerName = `Cleaner ${stamp}`;
  const propertyName = `Compress Property ${stamp}`;

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await signUp(adminPage, adminName, `admin-${stamp}@example.com`);
  await promoteToAdmin(adminName);
  await adminPage.goto("/properties");

  const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: property } = await serviceClient
    .from("properties")
    .insert({ name: propertyName, address: "1 Compress St" })
    .select("id")
    .single();

  const cleanerContext = await browser.newContext();
  const cleanerPage = await cleanerContext.newPage();
  await signUp(cleanerPage, cleanerName, `cleaner-${stamp}@example.com`);

  const { data: cleaner } = await serviceClient.from("profiles").select("id").eq("name", cleanerName).single();
  await serviceClient
    .from("cleaner_property_assignments")
    .insert({ property_id: property!.id, user_id: cleaner!.id });

  const { packageId } = await seedDeliveredPackage(serviceClient, property!.id as string, `COMPRESS-${stamp}`);

  await cleanerPage.goto(`/confirmations/${packageId}`);
  await cleanerPage.getByRole("button", { name: "Damaged items" }).click();
  // Source fixture is ~7.8MB - over the bucket's 5MB cap. If client-side
  // compression didn't run (or failed), the upload itself would error and
  // the confirmation would never reach package_confirmations at all.
  await cleanerPage
    .locator('input[type="file"]')
    .setInputFiles(path.join(process.cwd(), "tests", "fixtures", "large-confirmation-photo.jpg"));
  await expect(cleanerPage.getByText("Processing photo…")).not.toBeVisible({ timeout: 15000 });
  await cleanerPage.getByRole("button", { name: "Submit" }).click();
  await expect(cleanerPage).toHaveURL("/confirmations");

  const { data: confirmation } = await serviceClient
    .from("package_confirmations")
    .select("photo_path")
    .eq("package_id", packageId)
    .single();
  expect(confirmation?.photo_path).not.toBeNull();

  const { data: downloaded, error: downloadError } = await serviceClient.storage
    .from("confirmation-photos")
    .download(confirmation!.photo_path as string);
  expect(downloadError).toBeNull();
  expect(downloaded!.size).toBeLessThanOrEqual(5 * 1024 * 1024);

  await adminContext.close();
  await cleanerContext.close();
});

test("cleaners only see and can confirm packages for assigned properties, never others", async ({ browser }) => {
  const stamp = `${Date.now()}-${test.info().project.name}`;
  const adminName = `Admin ${stamp}`;
  const cleanerName = `Cleaner ${stamp}`;
  const assignedPropertyName = `RLS Assigned Property ${stamp}`;
  const otherPropertyName = `RLS Other Property ${stamp}`;

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await signUp(adminPage, adminName, `admin-${stamp}@example.com`);
  await promoteToAdmin(adminName);
  // A plain reload() would just re-fetch whatever URL signUp() landed on -
  // if that happened to be /confirmations (cleaner role at signup time,
  // before this promotion), reload() never gets to /properties at all.
  // goto() re-runs the role-based landing redirect for real.
  await adminPage.goto("/properties");

  const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: assignedProperty } = await serviceClient
    .from("properties")
    .insert({ name: assignedPropertyName, address: "1 Assigned St" })
    .select("id")
    .single();
  const { data: otherProperty } = await serviceClient
    .from("properties")
    .insert({ name: otherPropertyName, address: "1 Other St" })
    .select("id")
    .single();

  const cleanerContext = await browser.newContext();
  const cleanerPage = await cleanerContext.newPage();
  await signUp(cleanerPage, cleanerName, `cleaner-${stamp}@example.com`);

  const { data: cleaner } = await serviceClient.from("profiles").select("id").eq("name", cleanerName).single();
  await serviceClient
    .from("cleaner_property_assignments")
    .insert({ property_id: assignedProperty!.id, user_id: cleaner!.id });

  const { packageId: assignedPackageId } = await seedDeliveredPackage(
    serviceClient,
    assignedProperty!.id as string,
    `RLS-ASSIGNED-${stamp}`,
  );
  const { packageId: otherPackageId } = await seedDeliveredPackage(
    serviceClient,
    otherProperty!.id as string,
    `RLS-OTHER-${stamp}`,
  );

  await cleanerPage.goto("/confirmations");
  await expect(cleanerPage.getByText(assignedPropertyName)).toBeVisible();
  await expect(cleanerPage.getByText(otherPropertyName)).not.toBeVisible();

  // Direct navigation to an unassigned property's package - RLS blocks the
  // underlying select, so the page treats it as not found.
  await cleanerPage.goto(`/confirmations/${otherPackageId}`);
  await expect(cleanerPage.getByText("This page could not be found")).toBeVisible();

  // A raw RPC call as the cleaner against the unassigned package is also
  // rejected - not just hidden from the UI.
  const cleanerClient = createClient(
    SUPABASE_URL,
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0",
  );
  await cleanerClient.auth.signInWithPassword({
    email: `cleaner-${stamp}@example.com`,
    password: "password123",
  });
  const { error } = await cleanerClient.rpc("confirm_package_delivery", {
    p_package_id: otherPackageId,
    p_outcome: "all_correct",
    p_note: null,
    p_photo_path: null,
    p_items: [],
  });
  expect(error).not.toBeNull();

  // The assigned package still confirms normally.
  await cleanerPage.goto(`/confirmations/${assignedPackageId}`);
  await cleanerPage.getByRole("button", { name: "Everything received correctly" }).click();
  await expect(cleanerPage).toHaveURL("/confirmations");

  await adminContext.close();
  await cleanerContext.close();
});

test("cleaner tamper guard rejects a direct update to a disallowed status or column", async () => {
  const stamp = `${Date.now()}-${test.info().project.name}`;
  const cleanerName = `Cleaner ${stamp}`;
  const propertyName = `Guard Property ${stamp}`;

  const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: property } = await serviceClient
    .from("properties")
    .insert({ name: propertyName, address: "1 Guard St" })
    .select("id")
    .single();

  const anonClient = createClient(
    SUPABASE_URL,
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0",
  );
  const email = `cleaner-${stamp}@example.com`;
  await anonClient.auth.signUp({ email, password: "password123", options: { data: { name: cleanerName } } });
  await serviceClient.from("profiles").update({ role: "cleaner" }).eq("name", cleanerName);

  const { data: cleaner } = await serviceClient.from("profiles").select("id").eq("name", cleanerName).single();
  await serviceClient
    .from("cleaner_property_assignments")
    .insert({ property_id: property!.id, user_id: cleaner!.id });

  const { packageId } = await seedDeliveredPackage(serviceClient, property!.id as string, `GUARD-${stamp}`);

  const cleanerClient = createClient(
    SUPABASE_URL,
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0",
  );
  await cleanerClient.auth.signInWithPassword({ email, password: "password123" });

  // Not one of the two statuses a cleaner may set.
  const { error: badStatusError } = await cleanerClient
    .from("packages")
    .update({ status: "cancelled" })
    .eq("id", packageId);
  expect(badStatusError).not.toBeNull();

  // A valid status, but also tampering with tracking_number in the same call.
  const { error: badColumnError } = await cleanerClient
    .from("packages")
    .update({ status: "confirmed_received", tracking_number: "FAKE-TRACKING" })
    .eq("id", packageId);
  expect(badColumnError).not.toBeNull();

  const { data: pkgAfter } = await serviceClient
    .from("packages")
    .select("status, tracking_number")
    .eq("id", packageId)
    .single();
  expect(pkgAfter?.status).toBe("delivered");
  expect(pkgAfter?.tracking_number).toBeNull();
});
