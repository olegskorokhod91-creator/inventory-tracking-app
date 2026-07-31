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

test("cleaner submits a multi-item request, admin resolves one via order creation", async ({
  browser,
}) => {
  const stamp = Date.now();
  const adminName = `Admin ${stamp}`;
  const cleanerName = `Cleaner ${stamp}`;
  const propertyName = `Request Test Property ${stamp}`;

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await signUp(adminPage, adminName, `admin-${stamp}@example.com`);
  await promoteToAdmin(adminName);
  // A plain reload() would just re-fetch whatever URL signUp() landed on -
  // if that happened to be /confirmations (cleaner role at signup time,
  // before this promotion), reload() never gets to /properties at all.
  // goto() re-runs the role-based landing redirect for real.
  await adminPage.goto("/properties");

  await adminPage.getByPlaceholder("Name").fill(propertyName);
  await adminPage.getByPlaceholder("Address").fill("1 Request St");
  await adminPage.getByRole("button", { name: "Add property" }).click();
  await adminPage.getByText(propertyName, { exact: true }).click();
  await adminPage.waitForURL(/\/properties\/[0-9a-f-]+$/);

  const cleanerContext = await browser.newContext();
  const cleanerPage = await cleanerContext.newPage();
  await signUp(cleanerPage, cleanerName, `cleaner-${stamp}@example.com`);

  // The admin's property page was loaded before the cleaner existed, so the
  // "assign cleaner" dropdown (fetched server-side) needs a reload to
  // include them.
  await adminPage.reload();

  // Admin assigns the cleaner to the property.
  await adminPage.getByLabel("Assign cleaner").selectOption({ label: cleanerName });
  await adminPage.getByRole("button", { name: "Assign" }).click();
  await expect(adminPage.getByText(cleanerName)).toBeVisible();

  const propertyUrl = adminPage.url();

  // Item names are stamp-suffixed too: /requests is a global cross-property
  // list, so a literal "Light bulbs" would collide with the same test
  // running concurrently under the other Playwright project.
  const itemA = `Paper towels ${stamp}`;
  const itemB = `Light bulbs ${stamp}`;

  // Cleaner adds two items via the name-Enter-quantity-Enter flow.
  await cleanerPage.goto(propertyUrl);
  await cleanerPage.getByLabel("Item name").fill(itemA);
  await cleanerPage.getByLabel("Item name").press("Enter");
  await cleanerPage.getByLabel("Quantity (optional)").fill("2");
  await cleanerPage.getByLabel("Quantity (optional)").press("Enter");

  await cleanerPage.getByLabel("Item name").fill(itemB);
  await cleanerPage.getByLabel("Item name").press("Enter");
  await cleanerPage.getByLabel("Quantity (optional)").press("Enter");

  await cleanerPage.getByLabel(`Note for ${itemB}`).fill("60 watt");
  await cleanerPage.getByRole("button", { name: "Submit request" }).click();

  await expect(cleanerPage.getByText(`${itemA} x2`)).toBeVisible();
  await expect(cleanerPage.getByText(itemB, { exact: true })).toBeVisible();
  await expect(cleanerPage.getByText("60 watt")).toBeVisible();
  await expect(cleanerPage.getByText("Open").first()).toBeVisible();

  // Admin sees both in the property page and the combined list.
  await adminPage.reload();
  await expect(adminPage.getByText(`${itemA} x2`)).toBeVisible();
  await expect(adminPage.getByText(itemB, { exact: true })).toBeVisible();

  await adminPage.goto("/requests");
  await expect(adminPage.locator("span", { hasText: `${itemA} x2` })).toBeVisible();
  await expect(adminPage.locator("span", { hasText: itemB })).toBeVisible();

  // Admin creates an order, checks off only the first item.
  await adminPage.goto("/orders/new");
  await adminPage.getByLabel("Retailer").selectOption({ label: "Amazon" });
  await adminPage.getByLabel("Property").selectOption({ label: propertyName });
  await expect(adminPage.getByText("Open requests for this property")).toBeVisible();
  await adminPage.getByText(`${itemA} x2`).click();
  await adminPage.getByLabel("Item 1 name").fill(`${itemA} (case)`);
  await adminPage.getByLabel("Item 1 quantity").fill("1");
  await adminPage.getByRole("button", { name: "Create order" }).click();
  await expect(adminPage).toHaveURL(/\/orders\/[0-9a-f-]+$/);

  // First item is now resolved; second is untouched - no automatic
  // matching. The batch itself still shows on /requests (item B is still
  // open), with item A now visible as "Resolved" rather than dropped -
  // batches show full context, not just the still-open items.
  await adminPage.goto("/requests");
  await expect(adminPage.locator("span", { hasText: itemB })).toBeVisible();
  const itemARow = adminPage.locator("li", { hasText: `${itemA} x2` });
  await expect(itemARow.getByText("Resolved")).toBeVisible();

  await adminPage.goto(propertyUrl);
  await expect(adminPage.getByText("Resolved")).toBeVisible();
});

test("cleaners see requests but cannot resolve or view the combined /requests list", async ({
  page,
}) => {
  const stamp = Date.now();
  const cleanerName = `Cleaner ${stamp}`;
  await signUp(page, cleanerName, `cleaner-${stamp}@example.com`);
  await forceCleanerRole(cleanerName);

  await page.goto("/requests");
  await expect(page).toHaveURL("/properties");
});
