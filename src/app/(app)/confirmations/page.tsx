import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isOverdue, formatElapsed } from "@/lib/confirmation-reminders";

type PackageRow = {
  id: string;
  tracking_number: string | null;
  carrier: string | null;
  delivered_at: string | null;
  orders: {
    order_number: string | null;
    order_date: string;
    retailers: { name: string } | null;
    properties: { id: string; name: string } | null;
  } | null;
};

export default async function ConfirmationsPage() {
  await getCurrentProfile();

  const supabase = await createClient();
  // RLS scopes this to the current user's assigned properties (cleaners)
  // or everything (admins) - same "the query is the same, RLS does the
  // filtering" pattern as /properties since M1.
  const { data: packages } = await supabase
    .from("packages")
    .select(
      "id, tracking_number, carrier, delivered_at, orders(order_number, order_date, retailers(name), properties(id, name))",
    )
    .eq("status", "delivered")
    // Oldest-delivered-first: whatever's been sitting the longest without
    // confirmation is the most urgent thing for the cleaner to check (M7).
    .order("delivered_at", { ascending: true })
    .returns<PackageRow[]>();

  const byProperty = new Map<string, { propertyName: string; packages: PackageRow[] }>();
  for (const pkg of packages ?? []) {
    const property = pkg.orders?.properties;
    if (!property) continue;
    const entry = byProperty.get(property.id) ?? { propertyName: property.name, packages: [] };
    entry.packages.push(pkg);
    byProperty.set(property.id, entry);
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-semibold">Needs confirmation</h1>

      {byProperty.size === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          Nothing needs confirming right now.
        </p>
      ) : (
        [...byProperty.entries()].map(([propertyId, { propertyName, packages }]) => (
          <section key={propertyId} className="flex flex-col gap-3">
            <h2 className="text-lg font-medium">{propertyName}</h2>
            <ul className="flex flex-col gap-3">
              {packages.map((pkg) => (
                <li key={pkg.id}>
                  <Link
                    href={`/confirmations/${pkg.id}`}
                    className="flex items-center justify-between rounded-lg border border-black/10 p-4 dark:border-white/10"
                  >
                    <div>
                      <p className="font-medium">
                        {pkg.orders?.retailers?.name}
                        {pkg.orders?.order_number ? ` · #${pkg.orders.order_number}` : ""}
                      </p>
                      <p className="text-sm text-zinc-600 dark:text-zinc-400">
                        {pkg.orders?.order_date}
                        {pkg.tracking_number
                          ? ` · Tracking: ${pkg.tracking_number}${pkg.carrier ? ` (${pkg.carrier})` : ""}`
                          : ""}
                      </p>
                      {pkg.delivered_at && (
                        <span
                          className={
                            isOverdue(pkg.delivered_at)
                              ? "mt-1 inline-block rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-400"
                              : "mt-1 inline-block text-xs text-zinc-500 dark:text-zinc-500"
                          }
                        >
                          {isOverdue(pkg.delivered_at) ? "Overdue — " : ""}
                          Delivered {formatElapsed(pkg.delivered_at)}
                        </span>
                      )}
                    </div>
                    <span className="h-11 shrink-0 rounded-md bg-black px-4 text-base font-medium leading-[44px] text-white dark:bg-white dark:text-black">
                      Confirm
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
