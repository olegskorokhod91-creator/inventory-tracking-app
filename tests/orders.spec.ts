import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "http://127.0.0.1:54321";
// Fixed local Supabase dev key (identical for every `supabase start`, not a
// real secret). Used only to promote a freshly-signed-up test user to admin,
// bypassing RLS as a test-fixture shortcut. Local Docker only.
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

// Guards against the (parallel-test) race where this signup happens to be
// the very first ever in the DB and the bootstrap trigger makes it admin
// instead of the cleaner this test needs.
async function forceCleanerRole(name: string) {
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { error } = await adminClient
    .from("profiles")
    .update({ role: "cleaner" })
    .eq("name", name);
  if (error) throw error;
}

test("admin creates a manual order and it shows correct derived status", async ({
  page,
}) => {
  const stamp = `${Date.now()}-${test.info().project.name}`;
  const adminName = `Admin ${stamp}`;
  const propertyName = `Order Test Property ${stamp}`;

  await signUp(page, adminName, `admin-${stamp}@example.com`);
  await promoteToAdmin(adminName);
  await page.reload();

  await page.getByPlaceholder("Name").fill(propertyName);
  await page.getByPlaceholder("Address").fill("1 Order St");
  await page.getByRole("button", { name: "Add property" }).click();
  await expect(page.getByText(propertyName)).toBeVisible();

  await page.goto("/orders/new");
  await page.getByLabel("Retailer").selectOption({ label: "Amazon" });
  await page.getByLabel("Property").selectOption({ label: propertyName });
  await page.getByLabel("Order number (optional)").fill("AMZ-12345");
  await page.getByLabel("Item 1 name").fill("Paper towels");
  await page.getByLabel("Item 1 quantity").fill("2");
  await page.getByLabel("Item 1 unit price").fill("9.99");
  await page.getByRole("button", { name: "Create order" }).click();

  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]+$/);
  await expect(page.getByText("active")).toBeVisible();
  await expect(page.getByText("Paper towels")).toBeVisible();
  await expect(page.getByText("x2")).toBeVisible();
  await expect(page.locator('select[name="status"]')).toHaveValue("expected");
  await expect(page.locator('input[name="tracking_number"]')).toHaveValue("");

  await page.goto("/orders");
  await expect(page.getByText(`Amazon — ${propertyName}`)).toBeVisible();
});

test("cleaners cannot access /orders", async ({ page }) => {
  const stamp = `${Date.now()}-${test.info().project.name}`;
  const cleanerName = `Cleaner ${stamp}`;
  await signUp(page, cleanerName, `cleaner-${stamp}@example.com`);
  await forceCleanerRole(cleanerName);

  await page.goto("/orders");
  await expect(page).toHaveURL("/properties");
});
