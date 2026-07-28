import path from "path";
import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// Playwright's test transform doesn't support import.meta - resolve
// relative to the repo root (where `npx playwright test` is always run
// from in this project) instead of __dirname.
const SAMPLE_CSV = path.join(process.cwd(), "tests", "fixtures", "sample-amazon-orders.csv");

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

test("CSV import creates draft orders, review screen surfaces suggestion, re-upload is idempotent", async ({
  page,
}) => {
  const stamp = `${Date.now()}-${test.info().project.name}`;
  const adminName = `Admin ${stamp}`;
  const propertyAlpha = `Test Property Alpha ${stamp}`;
  const propertyBeta = `Test Property Beta ${stamp}`;

  await signUp(page, adminName, `admin-${stamp}@example.com`);
  await promoteToAdmin(adminName);
  await page.reload();

  for (const [name, address] of [
    [propertyAlpha, "1 Alpha St"],
    [propertyBeta, "2 Beta Ave"],
  ]) {
    await page.goto("/properties");
    await page.getByPlaceholder("Name").fill(name);
    await page.getByPlaceholder("Address").fill(address);
    await page.getByRole("button", { name: "Add property" }).click();
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  }

  // The fixture's PO Number values are literally "Test Property Alpha" /
  // "Test Property Beta" (no stamp), so the suggestion heuristic needs a
  // stamp-free copy of the CSV rewritten to point at these exact property
  // names for this test run.
  const fs = await import("fs");
  const csvTemplate = fs.readFileSync(SAMPLE_CSV, "utf-8");
  const csvForThisRun = csvTemplate
    .replaceAll("Test Property Alpha", propertyAlpha)
    .replaceAll("Test Property Beta", propertyBeta)
    .replaceAll("TEST-ORDER-SINGLE-001", `TEST-ORDER-SINGLE-001-${stamp}`)
    .replaceAll("TEST-ORDER-MULTI-002", `TEST-ORDER-MULTI-002-${stamp}`);
  const tmpCsvPath = path.join(process.cwd(), "tests", "fixtures", `.tmp-${stamp}.csv`);
  fs.writeFileSync(tmpCsvPath, csvForThisRun);

  await page.goto("/orders/import-csv");
  await page.locator('input[type="file"]').setInputFiles(tmpCsvPath);
  await page.getByRole("button", { name: "Import" }).click();
  await expect(page.getByText("2 created, 0 updated")).toBeVisible({
    timeout: 15000,
  });

  await page.goto("/orders");
  await expect(page.getByText("Needs review")).toBeVisible();
  await expect(
    page.getByText(`suggests "${propertyAlpha}"`),
  ).toBeVisible();

  await page.getByText(`#TEST-ORDER-SINGLE-001-${stamp}`).click();
  await expect(page.getByText("This order needs review")).toBeVisible();
  await expect(page.getByText("Paper Towels 12-Pack")).toBeVisible();
  await expect(page.getByText("expected")).toBeVisible();
  await expect(page.getByText("No tracking number yet")).toBeVisible();

  const selectedOption = await page
    .locator('select[name="property_id"]')
    .evaluate((el: HTMLSelectElement) => el.options[el.selectedIndex]?.text);
  expect(selectedOption).toBe(propertyAlpha);

  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("active")).toBeVisible();
  await expect(page.getByText("This order needs review")).not.toBeVisible();

  // Now in the regular list (no longer "Needs property"), not the review section.
  await page.goto("/orders");
  await expect(
    page
      .getByText(`#TEST-ORDER-SINGLE-001-${stamp}`)
      .locator("xpath=ancestor::a"),
  ).not.toContainText("Needs property");

  // Multi-item order grouped all three rows under one order.
  await page.getByText(`#TEST-ORDER-MULTI-002-${stamp}`).click();
  await expect(page.getByText("Trash Bags 80ct")).toBeVisible();
  await expect(page.getByText("Coffee Filters 200ct")).toBeVisible();
  await expect(page.getByText("Dish Soap")).toBeVisible();

  // Re-upload the same file: idempotent, no duplicate orders/items.
  await page.goto("/orders/import-csv");
  await page.locator('input[type="file"]').setInputFiles(tmpCsvPath);
  await page.getByRole("button", { name: "Import" }).click();
  await expect(page.getByText("0 created, 2 updated")).toBeVisible({
    timeout: 15000,
  });

  fs.unlinkSync(tmpCsvPath);
});

test("cleaners cannot access CSV import", async ({ page }) => {
  const stamp = `${Date.now()}-${test.info().project.name}`;
  const cleanerName = `Cleaner ${stamp}`;

  await signUp(page, cleanerName, `cleaner-${stamp}@example.com`);

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  await adminClient.from("profiles").update({ role: "cleaner" }).eq("name", cleanerName);

  await page.goto("/orders/import-csv");
  await expect(page).toHaveURL("/properties");
});
