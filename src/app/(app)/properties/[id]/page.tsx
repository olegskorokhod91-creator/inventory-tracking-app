import { notFound } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { assignCleaner, unassignCleaner, updateProperty } from "../actions";
import { SupplyRequestForm } from "./SupplyRequestForm";
import { SubmitButton } from "@/components/SubmitButton";
import { AddressAndPoFields } from "../AddressAndPoFields";

export default async function PropertyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await getCurrentProfile();
  const { id } = await params;

  const supabase = await createClient();

  // RLS scopes this to properties the current user can actually see -
  // admins see all, cleaners only their assigned ones. A cleaner visiting a
  // property they're not assigned to just gets no row back, so this
  // `notFound()` also doubles as the access-control boundary for them.
  const { data: property } = await supabase
    .from("properties")
    .select("id, name, address, status, notes, owner_id, po_number")
    .eq("id", id)
    .single();

  if (!property) notFound();

  const isAdmin = profile?.role === "admin";

  let owners: { id: string; name: string }[] = [];
  if (isAdmin) {
    const { data } = await supabase.from("owners").select("id, name").order("name");
    owners = data ?? [];
  }

  const { data: requests } = await supabase
    .from("supply_requests")
    .select("id, item_name, quantity, note, created_at, ordered_order_id, resolved_by_order_id")
    .eq("property_id", id)
    .order("created_at", { ascending: false });

  let itemNames: string[] = [];
  if (!isAdmin) {
    const { data: names } = await supabase.rpc(
      "get_supply_request_item_names",
    );
    itemNames = (names as string[] | null) ?? [];
  }

  let assignments:
    | { user_id: string; profiles: { name: string } | null }[]
    | null = null;
  let unassignedCleaners: { id: string; name: string }[] = [];

  if (isAdmin) {
    const { data } = await supabase
      .from("cleaner_property_assignments")
      .select("user_id, profiles(name)")
      .eq("property_id", id)
      .returns<{ user_id: string; profiles: { name: string } | null }[]>();
    assignments = data;

    const assignedIds = new Set((assignments ?? []).map((a) => a.user_id));
    const { data: cleaners } = await supabase
      .from("profiles")
      .select("id, name")
      .eq("role", "cleaner")
      .order("name");
    unassignedCleaners = (cleaners ?? []).filter((c) => !assignedIds.has(c.id));
  }

  const updatePropertyWithId = updateProperty.bind(null, id);
  const assignCleanerToProperty = assignCleaner.bind(null, id);

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-semibold">{property.name}</h1>

      {isAdmin ? (
        <>
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
            <AddressAndPoFields
              initialAddress={property.address}
              initialPoNumber={property.po_number ?? ""}
            />
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
            <label className="flex flex-col gap-1 text-sm font-medium">
              Owner
              <select
                name="owner_id"
                defaultValue={property.owner_id ?? ""}
                className="h-11 rounded-md border border-black/15 px-3 text-base font-normal dark:border-white/20"
              >
                <option value="">Managed directly (no owner)</option>
                {owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
            <SubmitButton
              pendingText="Saving…"
              className="h-11 rounded-md bg-black text-base font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
            >
              Save
            </SubmitButton>
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
                      <SubmitButton
                        pendingText="Removing…"
                        className="text-sm font-medium text-red-600 underline disabled:opacity-50"
                      >
                        Remove
                      </SubmitButton>
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
                <SubmitButton
                  pendingText="Assigning…"
                  className="h-11 shrink-0 rounded-md border border-black/15 px-4 text-base font-medium disabled:opacity-50 dark:border-white/20"
                >
                  Assign
                </SubmitButton>
              </form>
            )}
          </section>
        </>
      ) : (
        <p className="text-zinc-600 dark:text-zinc-400">{property.address}</p>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Supply requests</h2>

        {requests && requests.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {requests.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between rounded-md border border-black/10 px-3 py-2 dark:border-white/10"
              >
                <div>
                  <p className="font-medium">
                    {r.item_name}
                    {r.quantity ? ` x${r.quantity}` : ""}
                  </p>
                  {r.note && (
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">
                      {r.note}
                    </p>
                  )}
                </div>
                <span
                  className={
                    r.resolved_by_order_id
                      ? "rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-800 dark:bg-green-950 dark:text-green-300"
                      : r.ordered_order_id
                        ? "rounded-full bg-blue-100 px-2 py-1 text-xs font-medium text-blue-800 dark:bg-blue-950 dark:text-blue-300"
                        : "rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-400"
                  }
                >
                  {r.resolved_by_order_id ? "Resolved" : r.ordered_order_id ? "Ordered" : "Open"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            No supply requests yet.
          </p>
        )}
      </section>

      {!isAdmin && (
        <SupplyRequestForm propertyId={id} existingItemNames={itemNames} />
      )}
    </div>
  );
}
