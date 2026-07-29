import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { suggestPropertyMatch } from "@/lib/property-suggestion";
import { updateOrder, updatePackage } from "../actions";
import { RefundToggle } from "./RefundToggle";

const PACKAGE_STATUS_OPTIONS = [
  "expected",
  "shipped",
  "out_for_delivery",
  "delayed",
  "delivered",
  "cancelled",
  "confirmed_received",
];

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
      supabase.from("properties").select("id, name, address").order("name"),
    ]);

  if (!order) notFound();

  const [{ data: items }, { data: packages }] = await Promise.all([
    supabase
      .from("order_items")
      .select("id, name, expected_quantity, unit_price, is_refunded")
      .eq("order_id", id)
      .order("name"),
    supabase
      .from("packages")
      .select("id, tracking_number, carrier, status, expected_delivery_date")
      .eq("order_id", id)
      .order("created_at"),
  ]);

  const updateOrderWithId = updateOrder.bind(null, id);

  const needsReview = !order.property_id;
  const suggestion = needsReview
    ? suggestPropertyMatch(order.po_number, properties ?? [])
    : null;
  const propertyDefaultValue = order.property_id ?? suggestion?.id ?? "";

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

      {needsReview && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          This order needs review — it was created automatically and has no
          property assigned yet. Everything else below is whatever&apos;s
          known so far.
        </div>
      )}

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
            defaultValue={propertyDefaultValue}
            required
            className="h-11 rounded-md border border-black/15 px-3 text-base font-normal dark:border-white/20"
          >
            <option value="" disabled>
              Select a property…
            </option>
            {properties?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {suggestion && (
            <span className="text-xs text-zinc-600 dark:text-zinc-400">
              Suggested from &quot;{order.po_number}&quot; — double-check
              before saving.
            </span>
          )}
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
        {items && items.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-black/10 px-3 py-2 dark:border-white/10"
              >
                <span className={item.is_refunded ? "line-through opacity-60" : ""}>
                  {item.name}
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-zinc-600 dark:text-zinc-400">
                    x{item.expected_quantity}
                    {item.unit_price != null ? ` · $${item.unit_price}` : ""}
                  </span>
                  <RefundToggle itemId={item.id} refunded={item.is_refunded} />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            No items yet — waiting on the CSV import or a manual update.
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Packages</h2>
        <ul className="flex flex-col gap-3">
          {packages?.map((pkg) => {
            const updatePackageWithId = updatePackage.bind(null, pkg.id);
            return (
              <li
                key={pkg.id}
                className="rounded-md border border-black/10 p-3 dark:border-white/10"
              >
                <form action={updatePackageWithId} className="flex flex-col gap-3">
                  <label className="flex flex-col gap-1 text-sm font-medium">
                    Status
                    <select
                      name="status"
                      defaultValue={pkg.status}
                      className="h-11 rounded-md border border-black/15 px-3 text-base font-normal capitalize dark:border-white/20"
                    >
                      {PACKAGE_STATUS_OPTIONS.map((status) => (
                        <option key={status} value={status} className="capitalize">
                          {status.replaceAll("_", " ")}
                        </option>
                      ))}
                    </select>
                    <span className="text-xs text-zinc-600 dark:text-zinc-400">
                      &quot;Confirmed received&quot; marks this package received without
                      cleaner confirmation — only use it for a phone/in-person report.
                    </span>
                  </label>

                  <label className="flex flex-col gap-1 text-sm font-medium">
                    Tracking number
                    <input
                      name="tracking_number"
                      defaultValue={pkg.tracking_number ?? ""}
                      className="h-11 rounded-md border border-black/15 px-3 text-base font-normal dark:border-white/20"
                    />
                  </label>

                  <label className="flex flex-col gap-1 text-sm font-medium">
                    Carrier
                    <input
                      name="carrier"
                      defaultValue={pkg.carrier ?? ""}
                      className="h-11 rounded-md border border-black/15 px-3 text-base font-normal dark:border-white/20"
                    />
                  </label>

                  <label className="flex flex-col gap-1 text-sm font-medium">
                    Expected delivery date
                    <input
                      name="expected_delivery_date"
                      type="date"
                      defaultValue={pkg.expected_delivery_date ?? ""}
                      className="h-11 rounded-md border border-black/15 px-3 text-base font-normal dark:border-white/20"
                    />
                  </label>

                  <button
                    type="submit"
                    className="h-11 rounded-md border border-black/15 text-base font-medium dark:border-white/20"
                  >
                    Save package
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
