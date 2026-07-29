import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";

// Role-based landing (M5): cleaners' highest-frequency action is
// confirming deliveries, so that's their home screen now, not Properties -
// per the plan doc's "deliveries needing confirmation is effectively their
// home screen" (Section 12). Admins still land on Properties. Both
// login/signup and the auth proxy redirect here unconditionally and let
// this one route make the actual role decision, so this is the only place
// that needs to know about it.
export default async function Home() {
  const profile = await getCurrentProfile();
  redirect(profile?.role === "cleaner" ? "/confirmations" : "/properties");
}
