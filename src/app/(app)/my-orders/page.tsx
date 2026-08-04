import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { deriveActiveSubLabel } from "@/lib/package-status";

// Read-only order visibility for cleaners (real user request) - every
// order for a property she's assigned to, same as admin's Active Orders,
// but with total_amount/unit_price never selected at all. This app has
// held "cleaners see zero pricing/order data" since M2 - column-level, not
// something RLS enforces on its own (RLS is row-level only), so leaving
// those fields out of the query itself is the actual boundary here, not
// just hiding them in the UI.
type OrderRow = {
  id: string;
  order_number: string | null;
  order_date: string;
  computed_status: "active" | "completed";
  requires_attention: boolean;
  source: string;
  retailers: { name: string } | null;
  properties: { name: string } | null;
  packages: { status: string }[];
};

export default async function MyOrdersPage() {
  const profile = await getCurrentProfile();

  const supabase = await createClient();
  // orders_with_status is security_invoker - RLS on the underlying orders
  // table ("Cleaners can view orders for assigned properties", M5) is what
  // actually scopes this to her properties, the same as every other
  // cleaner-facing query in this app.
  const { data: orders } = await supabase
    .from("orders_with_status")
    .select(
      "id, order_number, order_date, computed_status, requires_attention, source, retailers(name), properties(name), packages(status)",
    )
    .not("property_id", "is", null)
    .order("order_date", { ascending: false })
    .returns<OrderRow[]>();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-semibold">Orders</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {profile?.name}, here&apos;s the status of orders for your assigned
        properties.
      </p>

      {orders && orders.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {orders.map((order) => (
            <li
              key={order.id}
              className="rounded-lg border border-black/10 p-4 dark:border-white/10"
            >
              <Link href={`/my-orders/${order.id}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">
                      {order.retailers?.name} — {order.properties?.name}
                    </p>
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">
                      {order.order_date}
                      {order.order_number ? ` · #${order.order_number}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="rounded-full bg-zinc-200 px-2 py-1 text-xs font-medium capitalize dark:bg-zinc-800">
                      {order.computed_status}
                    </span>
                    {order.computed_status === "active" && (
                      <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-medium text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                        {deriveActiveSubLabel(order.packages, {
                          source: order.source,
                          order_number: order.order_number,
                        })}
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
          No orders yet for your assigned properties.
        </p>
      )}
    </div>
  );
}
