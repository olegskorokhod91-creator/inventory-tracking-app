import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { createProperty } from "./actions";

export default async function PropertiesPage() {
  const profile = await getCurrentProfile();
  const isAdmin = profile?.role === "admin";

  const supabase = await createClient();
  const { data: properties } = await supabase
    .from("properties")
    .select("id, name, address, status")
    .order("name");

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-semibold">Properties</h1>

      {properties && properties.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {properties.map((property) => {
            const row = (
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{property.name}</p>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    {property.address}
                  </p>
                </div>
                {property.status === "inactive" && (
                  <span className="rounded-full bg-zinc-200 px-2 py-1 text-xs font-medium dark:bg-zinc-800">
                    Inactive
                  </span>
                )}
              </div>
            );

            return (
              <li
                key={property.id}
                className="rounded-lg border border-black/10 p-4 dark:border-white/10"
              >
                <Link href={`/properties/${property.id}`}>{row}</Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-zinc-600 dark:text-zinc-400">
          {isAdmin
            ? "No properties yet — add one below."
            : "No properties assigned to you yet."}
        </p>
      )}

      {isAdmin && (
        <form
          action={createProperty}
          className="flex flex-col gap-3 rounded-lg border border-black/10 p-4 dark:border-white/10"
        >
          <h2 className="text-lg font-medium">Add property</h2>
          <input
            name="name"
            placeholder="Name"
            required
            className="h-11 rounded-md border border-black/15 px-3 text-base dark:border-white/20"
          />
          <input
            name="address"
            placeholder="Address"
            required
            className="h-11 rounded-md border border-black/15 px-3 text-base dark:border-white/20"
          />
          <button
            type="submit"
            className="h-11 rounded-md bg-black text-base font-medium text-white dark:bg-white dark:text-black"
          >
            Add property
          </button>
        </form>
      )}
    </div>
  );
}
