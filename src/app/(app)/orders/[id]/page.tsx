import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { updateOrder } from "../actions";

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;

  const supabase = await createClient();

  const [{ data: order }, { data: retailers }, { data: properties }] =
    await Promise.all([
      supabase
        .from("orders_with_status")
        .select("*")
        .eq("id", id)
        .single(),
      supabase.from("retailers").select("id, name").order("name"),
      supabase.from("properties").select("id, name").order("name"),
    ]);

  if (!order) notFound();

  const [{ data: items }, { data: packages }] = await Promise.all([
    supabase
      .from("order_items")
      .select("id, name, expected_quantity, unit_price")
      .eq("order_id", id)
      .order("name"),
    supabase
      .from("packages")
      .select("id, tracking_number, carrier, status, expected_delivery_date")
      .eq("order_id", id),
  ]);

  const updateOrderWithId = updateOrder.bind(null, id);

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Order detail</h1>
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

      <form
        action={updateOrderWithId}
        className="flex flex-col gap-3 rounded-lg border border-black/10 p-4 dark:border-white/10"
      >
        <label className="flex flex-col gap-1 text-sm font-medium">
          Retailer
          <select
            name="retailer_id"
            defaultValue={order.retailer_id}
            required
            className="h-11 rounded-md border border-black/15 px-3 text-base font-normal dark:border-white/20"
          >
            {retailers?.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium">
          Property
          <select
            name="property_id"
            defaultValue={order.property_id}
            required
            className="h-11 rounded-md border border-black/15 px-3 text-base font-normal dark:border-white/20"
          >
            {properties?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium">
          Order number
          <input
            name="order_number"
            defaultValue={order.order_number ?? ""}
            className="h-11 rounded-md border border-black/15 px-3 text-base font-normal dark:border-white/20"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium">
          Order date
          <input
            name="order_date"
            type="date"
            defaultValue={order.order_date}
            required
            className="h-11 rounded-md border border-black/15 px-3 text-base font-normal dark:border-white/20"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium">
          Total amount
          <input
            name="total_amount"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            defaultValue={order.total_amount ?? ""}
            className="h-11 rounded-md border border-black/15 px-3 text-base font-normal dark:border-white/20"
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
        <h2 className="text-lg font-medium">Items</h2>
        <ul className="flex flex-col gap-2">
          {items?.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between rounded-md border border-black/10 px-3 py-2 dark:border-white/10"
            >
              <span>{item.name}</span>
              <span className="text-sm text-zinc-600 dark:text-zinc-400">
                x{item.expected_quantity}
                {item.unit_price != null ? ` · $${item.unit_price}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Packages</h2>
        <ul className="flex flex-col gap-2">
          {packages?.map((pkg) => (
            <li
              key={pkg.id}
              className="rounded-md border border-black/10 px-3 py-2 dark:border-white/10"
            >
              <p className="font-medium capitalize">
                {pkg.status.replaceAll("_", " ")}
              </p>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {pkg.tracking_number
                  ? `Tracking: ${pkg.tracking_number}${pkg.carrier ? ` (${pkg.carrier})` : ""}`
                  : "No tracking number yet"}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
