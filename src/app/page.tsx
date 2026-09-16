import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";

// Role-based landing (M5). Cleaners used to land on /confirmations (their
// highest-frequency action was confirming deliveries) - that page was
// removed once cleaner delivery confirmation was removed entirely
// (product-owner-directed simplification: an order is done the instant an
// admin marks it ordered, nothing left for a cleaner to confirm). Both
// roles land on /properties now. Both login/signup and the auth proxy
// redirect here unconditionally and let this one route make the actual
// role decision, so this is the only place that needs to know about it.
export default async function Home() {
  await getCurrentProfile();
  redirect("/properties");
}
