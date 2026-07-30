import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "http://127.0.0.1:54321";
// Fixed local Supabase dev key (identical for every `supabase start`, not a
// real secret). Used only to promote a freshly-signed-up test user to admin,
// bypassing RLS as a test-fixture shortcut for what the real
// first-signup-becomes-admin trigger does. Local Docker only — never use
// this key against a hosted project.
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

test("cleaners only see properties they're assigned to", async ({
  browser,
}) => {
  const stamp = `${Date.now()}-${test.info().project.name}`;
  const adminName = `Admin ${stamp}`;
  const cleanerName = `Cleaner ${stamp}`;
  const assignedPropertyName = `Property Alpha ${stamp}`;
  const unassignedPropertyName = `Property Beta ${stamp}`;

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await signUp(adminPage, adminName, `admin-${stamp}@example.com`);
  await promoteToAdmin(adminName);
  // A plain reload() would just re-fetch whatever URL signUp() landed on -
  // if that happened to be /confirmations (cleaner role at signup time,
  // before this promotion), reload() never gets to /properties at all.
  // goto() re-runs the role-based landing redirect for real.
  await adminPage.goto("/properties");

  for (const name of [assignedPropertyName, unassignedPropertyName]) {
    await adminPage.goto("/properties");
    await adminPage.getByPlaceholder("Name").fill(name);
    await adminPage.getByPlaceholder("Address").fill("1 Test St");
    await adminPage.getByRole("button", { name: "Add property" }).click();
    await expect(adminPage.getByText(name)).toBeVisible();
  }

  const cleanerContext = await browser.newContext();
  const cleanerPage = await cleanerContext.newPage();
  await signUp(cleanerPage, cleanerName, `cleaner-${stamp}@example.com`);
  // Cleaners land on /confirmations post-signup (M5), not /properties - this
  // test is specifically about the properties list, so navigate explicitly.
  await cleanerPage.goto("/properties");

  // Before any assignment, the cleaner sees neither property.
  await expect(cleanerPage.getByText(assignedPropertyName)).not.toBeVisible();
  await expect(
    cleanerPage.getByText(unassignedPropertyName),
  ).not.toBeVisible();

  // Admin assigns the cleaner to one property only.
  await adminPage.goto("/properties");
  await adminPage.getByText(assignedPropertyName).click();
  await adminPage
    .getByLabel("Assign cleaner")
    .selectOption({ label: cleanerName });
  await adminPage.getByRole("button", { name: "Assign" }).click();
  await expect(adminPage.getByText(cleanerName)).toBeVisible();

  // Cleaner now sees the assigned property, but never the unassigned one.
  await cleanerPage.reload();
  await expect(cleanerPage.getByText(assignedPropertyName)).toBeVisible();
  await expect(
    cleanerPage.getByText(unassignedPropertyName),
  ).not.toBeVisible();

  // Cleaner has no admin affordances (no add-property form, no Users nav
  // link once the menu is opened - not just "not visible because the menu
  // happens to be closed").
  await expect(
    cleanerPage.getByRole("button", { name: "Add property" }),
  ).not.toBeVisible();
  await cleanerPage.getByRole("button", { name: "Menu" }).click();
  await expect(
    cleanerPage.getByRole("link", { name: "Users" }),
  ).not.toBeVisible();

  await adminContext.close();
  await cleanerContext.close();
});
