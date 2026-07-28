import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { assignCleaner, unassignCleaner, updateProperty } from "../actions";

export default async function PropertyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;

  const supabase = await createClient();

  const { data: property } = await supabase
    .from("properties")
    .select("id, name, address, status, notes")
    .eq("id", id)
    .single();

  if (!property) notFound();

  const { data: assignments } = await supabase
    .from("cleaner_property_assignments")
    .select("user_id, profiles(name)")
    .eq("property_id", id)
    .returns<{ user_id: string; profiles: { name: string } | null }[]>();

  const assignedIds = new Set((assignments ?? []).map((a) => a.user_id));

  const { data: cleaners } = await supabase
    .from("profiles")
    .select("id, name")
    .eq("role", "cleaner")
    .order("name");

  const unassignedCleaners = (cleaners ?? []).filter(
    (c) => !assignedIds.has(c.id),
  );

  const updatePropertyWithId = updateProperty.bind(null, id);
  const assignCleanerToProperty = assignCleaner.bind(null, id);

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-semibold">{property.name}</h1>

      <form
        action={updatePropertyWithId}
        className="flex flex-col gap-3 rounded-lg border border-black/10 p-4 dark:border-white/10"
      >
        <label className="flex flex-col gap-1 text-sm font-medium">
          Name
          <input
            name="name"
            defaultValue={property.name}
            required
            className="h-11 rounded-md border border-black/15 px-3 text-base font-normal dark:border-white/20"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Address
          <input
            name="address"
            defaultValue={property.address}
            required
            className="h-11 rounded-md border border-black/15 px-3 text-base font-normal dark:border-white/20"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Status
          <select
            name="status"
            defaultValue={property.status}
            className="h-11 rounded-md border border-black/15 px-3 text-base font-normal dark:border-white/20"
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Notes
          <textarea
            name="notes"
            defaultValue={property.notes ?? ""}
            rows={3}
            className="rounded-md border border-black/15 px-3 py-2 text-base font-normal dark:border-white/20"
          />
        </label>
        <button
          type="submit"
          className="h-11 rounded-md bg-black text-base font-medium text-white dark:bg-white dark:text-black"
        >
          Save
        </button>
      </form>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Assigned cleaners</h2>

        {assignments && assignments.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {assignments.map((a) => (
              <li
                key={a.user_id}
                className="flex items-center justify-between rounded-md border border-black/10 px-3 py-2 dark:border-white/10"
              >
                <span>{a.profiles?.name}</span>
                <form action={unassignCleaner.bind(null, id, a.user_id)}>
                  <button
                    type="submit"
                    className="text-sm font-medium text-red-600 underline"
                  >
                    Remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            No cleaners assigned yet.
          </p>
        )}

        {unassignedCleaners.length > 0 && (
          <form action={assignCleanerToProperty} className="flex gap-2">
            <select
              name="userId"
              aria-label="Assign cleaner"
              required
              defaultValue=""
              className="h-11 flex-1 rounded-md border border-black/15 px-3 text-base dark:border-white/20"
            >
              <option value="" disabled>
                Select a cleaner…
              </option>
              {unassignedCleaners.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="h-11 shrink-0 rounded-md border border-black/15 px-4 text-base font-medium dark:border-white/20"
            >
              Assign
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
