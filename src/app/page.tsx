import { redirect } from "next/navigation";

// Properties is the effective home screen for both roles (see plan doc
// Section 12) — admins get management actions, cleaners get a read-only
// filtered view, same route either way.
export default function Home() {
  redirect("/properties");
}
