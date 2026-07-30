import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CreateCleanerForm } from "./CreateCleanerForm";

export default async function UsersPage() {
  await requireAdmin();

  const supabase = await createClient();

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, name, role, active")
    .order("name");

  const { data: assignments } = await supabase
    .from("cleaner_property_assignments")
    .select("user_id, properties(name)")
    .returns<{ user_id: string; properties: { name: string } | null }[]>();

  const propertyNamesByUser = new Map<string, string[]>();
  for (const a of assignments ?? []) {
    const name = a.properties?.name;
    if (!name) continue;
    const list = propertyNamesByUser.get(a.user_id) ?? [];
    list.push(name);
    propertyNamesByUser.set(a.user_id, list);
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-semibold">Users</h1>

      <CreateCleanerForm />

      <ul className="flex flex-col gap-3">
        {profiles?.map((profile) => (
          <li
            key={profile.id}
            className="rounded-lg border border-black/10 p-4 dark:border-white/10"
          >
            <p className="font-medium">{profile.name}</p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {profile.role} · {profile.active ? "active" : "inactive"}
            </p>
            {profile.role === "cleaner" && (
              <p className="mt-1 text-sm">
                Properties:{" "}
                {(propertyNamesByUser.get(profile.id) ?? []).join(", ") ||
                  "none"}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
