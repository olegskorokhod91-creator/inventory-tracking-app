import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Profile = {
  id: string;
  name: string;
  role: "admin" | "cleaner";
  active: boolean;
};

export async function getCurrentProfile(): Promise<Profile | null> {
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
}

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
