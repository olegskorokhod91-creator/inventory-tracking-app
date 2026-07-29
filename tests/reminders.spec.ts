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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function seedDeliveredPackage(serviceClient: any, propertyId: string, orderNumber: string) {
  const { data: retailer } = await serviceClient.from("retailers").select("id").eq("name", "Amazon").single();
  const { data: orderId } = await serviceClient.rpc("upsert_order_from_pipeline", {
    p_source: "csv",
    p_retailer_id: retailer!.id,
    p_order_number: orderNumber,
    p_order_date: "2026-07-29",
    p_total_amount: 25,
    p_po_number: null,
    p_items: [{ name: "Paper Towels", expected_quantity: 1, unit_price: "25.00" }],
  });
  await serviceClient.from("orders").update({ property_id: propertyId }).eq("id", orderId as string);
  const { data: pkg } = await serviceClient
    .from("packages")
    .select("id")
    .eq("order_id", orderId as string)
    .single();
  // Real code paths (apply_shipping_update, the admin manual-override
  // action) always stamp delivered_at alongside the status transition -
  // mirror that here so a "fresh" seed genuinely reads as just-delivered.
  await serviceClient
    .from("packages")
    .update({ status: "delivered", delivered_at: new Date().toISOString() })
    .eq("id", pkg!.id);
  return { orderId: orderId as string, packageId: pkg!.id as string };
}

test("a package delivered over 24h ago with no confirmation surfaces as Overdue for the cleaner and in the admin digest, and drops off both once confirmed", async ({
  browser,
}) => {
  const stamp = `${Date.now()}-${test.info().project.name}`;
  const adminName = `Admin ${stamp}`;
  const cleanerName = `Cleaner ${stamp}`;
  const propertyName = `Reminder Property ${stamp}`;

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await signUp(adminPage, adminName, `admin-${stamp}@example.com`);
  await promoteToAdmin(adminName);
  await adminPage.goto("/properties");

  const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: property } = await serviceClient
    .from("properties")
    .insert({ name: propertyName, address: "1 Reminder St" })
    .select("id")
    .single();

  const cleanerContext = await browser.newContext();
  const cleanerPage = await cleanerContext.newPage();
  await signUp(cleanerPage, cleanerName, `cleaner-${stamp}@example.com`);
  await forceCleanerRole(cleanerName);

  const { data: cleaner } = await serviceClient.from("profiles").select("id").eq("name", cleanerName).single();
  await serviceClient
    .from("cleaner_property_assignments")
    .insert({ property_id: property!.id, user_id: cleaner!.id });

  // Overdue: delivered 25 hours ago, still un-confirmed.
  const overdue = await seedDeliveredPackage(serviceClient, property!.id as string, `OVERDUE-${stamp}`);
  await serviceClient
    .from("packages")
    .update({ delivered_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() })
    .eq("id", overdue.packageId);

  // Fresh: delivered moments ago, well under the 24h threshold.
  await seedDeliveredPackage(serviceClient, property!.id as string, `FRESH-${stamp}`);

  // Cleaner's list: both appear (M5 behavior unchanged), but only the
  // overdue one gets the Overdue badge, and it sorts first (oldest first).
  await cleanerPage.goto("/confirmations");
  await expect(cleanerPage.getByText(`#OVERDUE-${stamp}`)).toBeVisible();
  await expect(cleanerPage.getByText(`#FRESH-${stamp}`)).toBeVisible();
  await expect(cleanerPage.getByText(/Overdue — Delivered 1 day ago/)).toBeVisible();
  await expect(cleanerPage.getByText("Delivered just now")).toBeVisible();

  const itemTexts = await cleanerPage.locator("main li").allTextContents();
  const overdueIndex = itemTexts.findIndex((t) => t.includes(`OVERDUE-${stamp}`));
  const freshIndex = itemTexts.findIndex((t) => t.includes(`FRESH-${stamp}`));
  expect(overdueIndex).toBeGreaterThanOrEqual(0);
  expect(overdueIndex).toBeLessThan(freshIndex);

  // Admin digest on /properties: only the overdue one shows, grouped under
  // the property with the assigned cleaner's name, linking to order detail.
  await adminPage.goto("/properties");
  await expect(adminPage.getByText("Overdue confirmations")).toBeVisible();
  await expect(adminPage.getByText(`Assigned: ${cleanerName}`)).toBeVisible();
  await expect(adminPage.getByText(`Amazon #OVERDUE-${stamp}`)).toBeVisible();
  await expect(adminPage.getByText(`FRESH-${stamp}`)).not.toBeVisible();

  // Confirming it (the only real way it ever becomes confirmed_received)
  // removes it from both surfaces.
  await cleanerPage.goto(`/confirmations/${overdue.packageId}`);
  await cleanerPage.getByRole("button", { name: "Everything received correctly" }).click();
  await expect(cleanerPage).toHaveURL("/confirmations");
  await expect(cleanerPage.getByText(`#OVERDUE-${stamp}`)).not.toBeVisible();

  // Scoped to this test's own order number, not "the whole section is gone"
  // - another parallel project (chromium/mobile-375) running this same spec
  // concurrently may still have its own unconfirmed overdue package up.
  await adminPage.goto("/properties");
  await expect(adminPage.getByText(propertyName, { exact: false }).first()).toBeVisible();
  await expect(adminPage.getByText(`Amazon #OVERDUE-${stamp}`)).not.toBeVisible();

  await adminContext.close();
  await cleanerContext.close();
});
