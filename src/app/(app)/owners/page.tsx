import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createOwner } from "./actions";

type OwnerRow = {
  id: string;
  name: string;
  contact_email: string | null;
  contact_phone: string | null;
  properties: { id: string; name: string }[];
};

export default async function OwnersPage() {
  await requireAdmin();

  const supabase = await createClient();
  const { data: owners } = await supabase
    .from("owners")
    .select("id, name, contact_email, contact_phone, properties(id, name)")
    .order("name")
    .returns<OwnerRow[]>();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-semibold">Owners</h1>

      {owners && owners.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {owners.map((owner) => (
            <li
              key={owner.id}
              className="rounded-lg border border-black/10 p-4 dark:border-white/10"
            >
              <p className="font-medium">{owner.name}</p>
              {(owner.contact_email || owner.contact_phone) && (
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  {[owner.contact_email, owner.contact_phone]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                {owner.properties.length > 0
                  ? owner.properties.map((p) => p.name).join(", ")
                  : "No properties assigned yet — set this owner on a property's edit form."}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-zinc-600 dark:text-zinc-400">
          No owners yet — add one below.
        </p>
      )}

      <form
        action={createOwner}
        className="flex flex-col gap-3 rounded-lg border border-black/10 p-4 dark:border-white/10"
      >
        <h2 className="text-lg font-medium">Add owner</h2>
        <input
          name="name"
          placeholder="Name"
          required
          className="h-11 rounded-md border border-black/15 px-3 text-base dark:border-white/20"
        />
        <input
          name="contact_email"
          type="email"
          placeholder="Contact email (optional)"
          className="h-11 rounded-md border border-black/15 px-3 text-base dark:border-white/20"
        />
        <input
          name="contact_phone"
          placeholder="Contact phone (optional)"
          className="h-11 rounded-md border border-black/15 px-3 text-base dark:border-white/20"
        />
        <button
          type="submit"
          className="h-11 rounded-md bg-black text-base font-medium text-white dark:bg-white dark:text-black"
        >
          Add owner
        </button>
      </form>
    </div>
  );
}
