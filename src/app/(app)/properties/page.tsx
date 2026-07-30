import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { createProperty } from "./actions";
import { overdueCutoffIso, formatElapsed } from "@/lib/confirmation-reminders";
import { SubmitButton } from "@/components/SubmitButton";

type OverduePackageRow = {
  id: string;
  delivered_at: string;
  order_id: string;
  orders: {
    order_number: string | null;
    retailers: { name: string } | null;
    properties: { id: string; name: string } | null;
  } | null;
};

export default async function PropertiesPage() {
  const profile = await getCurrentProfile();
  const isAdmin = profile?.role === "admin";

  const supabase = await createClient();
  const { data: properties } = await supabase
    .from("properties")
    .select("id, name, address, status")
    .order("name");

  // M7: the daily digest, admin side - a package delivered (by retailer/
  // carrier) more than 24h ago with no cleaner confirmation yet. Purely a
  // prompt to go check in person; nothing here changes package status.
  let overdueByProperty: {
    propertyId: string;
    propertyName: string;
    cleanerNames: string[];
    packages: OverduePackageRow[];
  }[] = [];

  if (isAdmin) {
    const { data: overduePackages } = await supabase
      .from("packages")
      .select("id, delivered_at, order_id, orders(order_number, retailers(name), properties(id, name))")
      .eq("status", "delivered")
      .lt("delivered_at", overdueCutoffIso())
      .order("delivered_at", { ascending: true })
      .returns<OverduePackageRow[]>();

    const grouped = new Map<
      string,
      { propertyName: string; packages: OverduePackageRow[] }
    >();
    for (const pkg of overduePackages ?? []) {
      const property = pkg.orders?.properties;
      if (!property) continue;
      const entry = grouped.get(property.id) ?? { propertyName: property.name, packages: [] };
      entry.packages.push(pkg);
      grouped.set(property.id, entry);
    }

    if (grouped.size > 0) {
      const { data: assignments } = await supabase
        .from("cleaner_property_assignments")
        .select("property_id, profiles(name)")
        .in("property_id", [...grouped.keys()])
        .returns<{ property_id: string; profiles: { name: string } | null }[]>();

      const cleanerNamesByProperty = new Map<string, string[]>();
      for (const a of assignments ?? []) {
        if (!a.profiles) continue;
        const list = cleanerNamesByProperty.get(a.property_id) ?? [];
        list.push(a.profiles.name);
        cleanerNamesByProperty.set(a.property_id, list);
      }

      overdueByProperty = [...grouped.entries()].map(([propertyId, entry]) => ({
        propertyId,
        propertyName: entry.propertyName,
        cleanerNames: cleanerNamesByProperty.get(propertyId) ?? [],
        packages: entry.packages,
      }));
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-semibold">Properties</h1>

      {overdueByProperty.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Overdue confirmations</h2>
          <ul className="flex flex-col gap-3">
            {overdueByProperty.map((group) => (
              <li
                key={group.propertyId}
                className="rounded-lg border border-red-300 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950"
              >
                <p className="font-medium">
                  {group.propertyName}
                  {group.cleanerNames.length > 0 && (
                    <span className="font-normal text-zinc-600 dark:text-zinc-400">
                      {" "}
                      · Assigned: {group.cleanerNames.join(", ")}
                    </span>
                  )}
                </p>
                <ul className="mt-2 flex flex-col gap-1">
                  {group.packages.map((pkg) => (
                    <li key={pkg.id} className="text-sm">
                      <Link href={`/orders/${pkg.order_id}`} className="underline">
                        {pkg.orders?.retailers?.name}
                        {pkg.orders?.order_number ? ` #${pkg.orders.order_number}` : ""}
                      </Link>
                      {" — delivered "}
                      {formatElapsed(pkg.delivered_at)}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}

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
          <SubmitButton
            pendingText="Adding…"
            className="h-11 rounded-md bg-black text-base font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
          >
            Add property
          </SubmitButton>
        </form>
      )}
    </div>
  );
}
