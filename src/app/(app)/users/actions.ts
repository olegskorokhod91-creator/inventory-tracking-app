"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export type CreateCleanerFormState = { error: string } | undefined;

// Cleaners never self-register and never need to receive anything by
// email (M8 decision - no domain, no SMTP provider, no email dependency at
// all for cleaner accounts). Uses the service-role admin API rather than
// public signUp(), creating the account pre-confirmed - email_confirm:true
// here overrides the project's global "Confirm email" setting for this one
// user, so this works regardless of how that toggle is set. The same
// handle_new_user trigger that fires for a public signup fires here too,
// defaulting the new profile to role='cleaner' since an admin already
// exists.
export async function createCleanerAccount(
  _prevState: CreateCleanerFormState,
  formData: FormData,
): Promise<CreateCleanerFormState> {
  await requireAdmin();

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!name || !email || !password) {
    return { error: "Name, email, and password are all required." };
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/users");
  return undefined;
}
