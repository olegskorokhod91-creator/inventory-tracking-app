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

test("admin creates a cleaner login directly - no email sent, cleaner can log in immediately with the exact password given", async ({
  browser,
}) => {
  const stamp = `${Date.now()}-${test.info().project.name}`;
  const adminName = `Admin ${stamp}`;
  const cleanerName = `Direct Cleaner ${stamp}`;
  const cleanerEmail = `direct-cleaner-${stamp}@example.com`;

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await signUp(adminPage, adminName, `admin-${stamp}@example.com`);
  await promoteToAdmin(adminName);
  await adminPage.goto("/users");

  await adminPage.getByLabel("Name").fill(cleanerName);
  await adminPage.getByLabel("Email").fill(cleanerEmail);
  await adminPage.getByLabel("Temporary password").fill("cleanerpass123");
  await adminPage.getByRole("button", { name: "Add cleaner" }).click();

  const cleanerRow = adminPage.locator("li", { hasText: cleanerName });
  await expect(cleanerRow).toBeVisible();
  await expect(cleanerRow).toContainText("cleaner · active");

  // The new account works immediately, with the exact password the admin
  // typed, and no confirmation step - the whole point of this flow.
  const cleanerContext = await browser.newContext();
  const cleanerPage = await cleanerContext.newPage();
  await cleanerPage.goto("/login");
  await cleanerPage.getByLabel("Email").fill(cleanerEmail);
  await cleanerPage.getByLabel("Password").fill("cleanerpass123");
  await cleanerPage.getByRole("button", { name: "Log in" }).click();
  await expect(cleanerPage).toHaveURL("/confirmations", { timeout: 15000 });

  await adminContext.close();
  await cleanerContext.close();
});

test("cleaners cannot access /users", async ({ page }) => {
  const stamp = `${Date.now()}-${test.info().project.name}`;
  const cleanerName = `Cleaner ${stamp}`;
  await signUp(page, cleanerName, `cleaner-${stamp}@example.com`);
  await forceCleanerRole(cleanerName);

  await page.goto("/users");
  await expect(page).toHaveURL("/properties");
});
