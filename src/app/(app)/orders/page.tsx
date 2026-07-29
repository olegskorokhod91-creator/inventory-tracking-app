import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { deriveActiveSubLabel } from "@/lib/package-status";

type OrderRow = {
  id: string;
  order_number: string | null;
  order_date: string;
  total_amount: number | null;
  computed_status: "active" | "completed";
  requires_attention: boolean;
  retailers: { name: string } | null;
  properties: { name: string } | null;
  packages: { status: string }[];
};

type NeedsReviewRow = {
  id: string;
  order_number: string | null;
  order_date: string;
  total_amount: number | null;
  po_number: string | null;
  retailers: { name: string } | null;
};

export default async function OrdersPage() {
  await requireAdmin();

  const supabase = await createClient();

  const [{ data: needsReview }, { data: orders }] = await Promise.all([
    supabase
      .from("orders")
      .select("id, order_number, order_date, total_amount, po_number, retailers(name)")
      .is("property_id", null)
      .order("order_date", { ascending: true })
      .returns<NeedsReviewRow[]>(),
    supabase
      .from("orders_with_status")
      .select(
        "id, order_number, order_date, total_amount, computed_status, requires_attention, retailers(name), properties(name), packages(status)",
      )
      .not("property_id", "is", null)
      .order("order_date", { ascending: false })
      .returns<OrderRow[]>(),
  ]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Orders</h1>
        <div className="flex gap-2">
          <Link
            href="/orders/import-csv"
            className="h-11 shrink-0 rounded-md border border-black/15 px-4 text-base font-medium leading-[44px] dark:border-white/20"
          >
            Import CSV
          </Link>
          <Link
            href="/orders/new"
            className="h-11 shrink-0 rounded-md bg-black px-4 text-base font-medium leading-[44px] text-white dark:bg-white dark:text-black"
          >
            New order
          </Link>
        </div>
      </div>

      {needsReview && needsReview.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Needs review</h2>
          <ul className="flex flex-col gap-3">
            {needsReview.map((order) => (
              <li key={order.id}>
                <Link
                  href={`/orders/${order.id}`}
                  className="flex items-center justify-between rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950"
                >
                  <div>
                    <p className="font-medium">
                      {order.retailers?.name}
                      {order.order_number ? ` · #${order.order_number}` : ""}
                    </p>
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">
                      {order.order_date}
                      {order.total_amount != null
                        ? ` · $${order.total_amount}`
                        : ""}
                      {order.po_number ? ` · suggests "${order.po_number}"` : ""}
                    </p>
                  </div>
                  <span className="rounded-full bg-amber-200 px-2 py-1 text-xs font-medium text-amber-900 dark:bg-amber-900 dark:text-amber-200">
                    Needs property
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-3">
        {needsReview && needsReview.length > 0 && (
          <h2 className="text-lg font-medium">All orders</h2>
        )}
        {orders && orders.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {orders.map((order) => (
              <li
                key={order.id}
                className="rounded-lg border border-black/10 p-4 dark:border-white/10"
              >
                <Link href={`/orders/${order.id}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">
                        {order.retailers?.name} — {order.properties?.name}
                      </p>
                      <p className="text-sm text-zinc-600 dark:text-zinc-400">
                        {order.order_date}
                        {order.order_number ? ` · #${order.order_number}` : ""}
                        {order.total_amount != null
                          ? ` · $${order.total_amount}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="rounded-full bg-zinc-200 px-2 py-1 text-xs font-medium capitalize dark:bg-zinc-800">
                        {order.computed_status}
                      </span>
                      {order.computed_status === "active" && (
                        <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-medium text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                          {deriveActiveSubLabel(order.packages)}
                        </span>
                      )}
                      {order.requires_attention && (
                        <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-400">
                          Requires attention
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-zinc-600 dark:text-zinc-400">
            No orders yet — create one to get started.
          </p>
        )}
      </section>
    </div>
  );
}
