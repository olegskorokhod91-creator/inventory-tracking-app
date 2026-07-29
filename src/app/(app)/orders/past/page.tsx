import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  parsePastOrdersFilters,
  fetchPastOrders,
  type PastOrderSummary,
} from "@/lib/past-orders";

function money(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function packageLabel(pkg: PastOrderSummary["packages"][number]): string {
  if (pkg.status === "cancelled") return "Cancelled";
  if (pkg.confirmedByName) {
    return `Confirmed by ${pkg.confirmedByName}${pkg.confirmedAt ? ` · ${new Date(pkg.confirmedAt).toLocaleDateString()}` : ""}`;
  }
  if (pkg.confirmedSource === "admin_manual") {
    return `Confirmed manually (admin)${pkg.confirmedAt ? ` · ${new Date(pkg.confirmedAt).toLocaleDateString()}` : ""}`;
  }
  return "Confirmed received";
}

export default async function PastOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const resolvedSearchParams = await searchParams;
  const filters = parsePastOrdersFilters(resolvedSearchParams);

  const supabase = await createClient();
  const [{ data: properties }, { data: retailers }, { data: cleaners }] =
    await Promise.all([
      supabase.from("properties").select("id, name").order("name"),
      supabase.from("retailers").select("id, name").order("name"),
      supabase
        .from("profiles")
        .select("id, name")
        .eq("role", "cleaner")
        .order("name"),
    ]);

  const orders = await fetchPastOrders(supabase, filters);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Past orders</h1>
        <Link
          href="/orders"
          className="h-11 shrink-0 rounded-md border border-black/15 px-4 text-base font-medium leading-[44px] dark:border-white/20"
        >
          Active orders
        </Link>
      </div>

      <form
        method="get"
        className="flex flex-col gap-3 rounded-lg border border-black/10 p-4 dark:border-white/10"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Property (multi-select — none selected means all)
            <select
              name="property_id"
              multiple
              defaultValue={filters.propertyIds ?? []}
              size={5}
              className="rounded-md border border-black/15 px-3 py-2 text-base font-normal dark:border-white/20"
            >
              {properties?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium">
              Retailer
              <select
                name="retailer_id"
                defaultValue={filters.retailerId ?? ""}
                className="h-11 rounded-md border border-black/15 px-3 text-base font-normal dark:border-white/20"
              >
                <option value="">All retailers</option>
                {retailers?.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-sm font-medium">
              Confirmed by (cleaner)
              <select
                name="cleaner_id"
                defaultValue={filters.cleanerId ?? ""}
                className="h-11 rounded-md border border-black/15 px-3 text-base font-normal dark:border-white/20"
              >
                <option value="">Any cleaner</option>
                {cleaners?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-sm font-medium">
              Delivery status
              <select
                name="delivery_status"
                defaultValue={filters.deliveryStatus ?? ""}
                className="h-11 rounded-md border border-black/15 px-3 text-base font-normal dark:border-white/20"
              >
                <option value="">Received or cancelled</option>
                <option value="confirmed_received">Received</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </label>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Order number
            <input
              type="text"
              name="order_number"
              defaultValue={filters.orderNumber ?? ""}
              className="h-11 rounded-md border border-black/15 px-3 text-base font-normal dark:border-white/20"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Item name
            <input
              type="text"
              name="item"
              defaultValue={filters.itemName ?? ""}
              className="h-11 rounded-md border border-black/15 px-3 text-base font-normal dark:border-white/20"
            />
          </label>
        </div>

        <div className="flex gap-2">
          <label className="flex flex-1 flex-col gap-1 text-sm font-medium">
            Ordered from
            <input
              type="date"
              name="date_from"
              defaultValue={filters.dateFrom ?? ""}
              className="h-11 min-w-0 rounded-md border border-black/15 px-3 text-base font-normal dark:border-white/20"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-sm font-medium">
            Ordered to
            <input
              type="date"
              name="date_to"
              defaultValue={filters.dateTo ?? ""}
              className="h-11 min-w-0 rounded-md border border-black/15 px-3 text-base font-normal dark:border-white/20"
            />
          </label>
        </div>

        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            name="had_issue"
            value="1"
            defaultChecked={filters.hadIssue}
            className="h-5 w-5"
          />
          Ever had a missing/damaged/wrong-item issue (even if since resolved)
        </label>

        <button
          type="submit"
          className="h-11 rounded-md bg-black text-base font-medium text-white dark:bg-white dark:text-black"
        >
          Apply filters
        </button>
      </form>

      <section className="flex flex-col gap-3">
        {orders.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {orders.map((order) => (
              <li
                key={order.orderId}
                className="rounded-lg border border-black/10 p-4 dark:border-white/10"
              >
                <Link href={`/orders/${order.orderId}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">
                        {order.retailerName} — {order.propertyName}
                      </p>
                      <p className="text-sm text-zinc-600 dark:text-zinc-400">
                        {order.orderDate}
                        {order.orderNumber ? ` · #${order.orderNumber}` : ""}
                        {` · ${money(order.totalAmount)}`}
                      </p>
                    </div>
                    {order.hadIssue && (
                      <span className="shrink-0 rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                        Had an issue
                      </span>
                    )}
                  </div>
                  <ul className="mt-2 flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-400">
                    {order.packages.map((pkg) => (
                      <li key={pkg.id}>{packageLabel(pkg)}</li>
                    ))}
                  </ul>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-zinc-600 dark:text-zinc-400">
            No past orders match these filters.
          </p>
        )}
      </section>
    </div>
  );
}
