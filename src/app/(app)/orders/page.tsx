import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type OrderRow = {
  id: string;
  order_number: string | null;
  order_date: string;
  total_amount: number | null;
  computed_status: "active" | "completed";
  requires_attention: boolean;
  retailers: { name: string } | null;
  properties: { name: string } | null;
};

export default async function OrdersPage() {
  await requireAdmin();

  const supabase = await createClient();
  const { data: orders } = await supabase
    .from("orders_with_status")
    .select(
      "id, order_number, order_date, total_amount, computed_status, requires_attention, retailers(name), properties(name)",
    )
    .order("order_date", { ascending: false })
    .returns<OrderRow[]>();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Orders</h1>
        <Link
          href="/orders/new"
          className="h-11 shrink-0 rounded-md bg-black px-4 text-base font-medium leading-[44px] text-white dark:bg-white dark:text-black"
        >
          New order
        </Link>
      </div>

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
    </div>
  );
}
