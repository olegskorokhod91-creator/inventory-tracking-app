import { createClient } from "@supabase/supabase-js";

// Service-role client for backend/automated operations only - the email
// pipeline's cron job has no logged-in admin session to act within, so it
// needs to bypass RLS the same legitimate way service_role does everywhere
// else in this project. Never import this into client-rendered code.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}
