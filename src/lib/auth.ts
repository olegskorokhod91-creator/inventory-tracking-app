import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Profile = {
  id: string;
  name: string;
  role: "admin" | "cleaner";
  active: boolean;
};

// Wrapped in React's cache() so repeated calls within one request (the
// (app) layout calls this on every page, and most pages call it again
// themselves via requireAdmin/getCurrentProfile) share one result instead
// of each re-running two sequential Supabase round trips (auth.getUser +
// the profiles lookup). Request-scoped, not a cross-user/cross-request
// cache - this was a real, measurable contributor to slow page loads, not
// just a micro-optimization.
export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, name, role, active")
    .eq("id", user.id)
    .single();

  return profile as Profile | null;
});

// Gates admin-only pages at the app layer. This is a UX nicety, not a
// substitute for RLS — the database policies are the real enforcement
// boundary, this just avoids showing a broken page to a cleaner who
// navigates here by mistake.
export async function requireAdmin(): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") {
    redirect("/properties");
  }
  return profile;
}
