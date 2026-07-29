import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "http://127.0.0.1:54321";
// Fixed local Supabase dev key (identical for every `supabase start`, not a
// real secret) - used only to read back which role the bootstrap trigger
// assigned, since that depends on parallel-test signup ordering.
const SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

test("unauthenticated visitor is redirected to /login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
});

test("sign up lands on the role-appropriate home page, log out", async ({
  page,
}) => {
  const name = `Test User ${Date.now()}-${test.info().project.name}`;
  const email = `test-${Date.now()}-${test.info().project.name}@example.com`;

  await page.goto("/signup");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Sign up" }).click();

  // Generous timeout: under parallel test load against a single local
  // Supabase instance, signup (auth user + profile trigger + redirect +
  // page load) can occasionally take longer than the 5s default.
  await expect(page).toHaveURL(/\/(properties|confirmations)/, { timeout: 15000 });

  // Which role the bootstrap trigger assigned depends on whether this
  // happened to be the very first signup across the whole parallel suite
  // run (admin) or not (cleaner) - read it back rather than assume, then
  // assert the landing page that role actually implies (M5).
  const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: profile } = await serviceClient
    .from("profiles")
    .select("role")
    .eq("name", name)
    .single();

  if (profile!.role === "admin") {
    await expect(page).toHaveURL("/properties");
    await expect(page.getByRole("heading", { name: "Properties" })).toBeVisible();
  } else {
    await expect(page).toHaveURL("/confirmations");
    await expect(page.getByRole("heading", { name: "Needs confirmation" })).toBeVisible();
  }
  await expect(page.getByText(new RegExp(`\\(${profile!.role}\\)`))).toBeVisible();

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);
});
