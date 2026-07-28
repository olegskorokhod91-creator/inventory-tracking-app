import { test, expect } from "@playwright/test";

test("unauthenticated visitor is redirected to /login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
});

test("sign up, land on properties (role-gated home), log out", async ({
  page,
}) => {
  const email = `test-${Date.now()}-${test.info().project.name}@example.com`;

  await page.goto("/signup");
  await page.getByLabel("Name").fill("Test User");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Sign up" }).click();

  await expect(page).toHaveURL("/properties");
  await expect(
    page.getByRole("heading", { name: "Properties" }),
  ).toBeVisible();
  await expect(page.getByText(/\((admin|cleaner)\)/)).toBeVisible();

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);
});
