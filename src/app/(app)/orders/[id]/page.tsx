import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { suggestPropertyMatch } from "@/lib/property-suggestion";
import { updateOrder, updatePackage } from "../actions";
import { RefundToggle } from "./RefundToggle";
import { RemoveItemButton } from "./RemoveItemButton";
import { DeleteOrderButton } from "./DeleteOrderButton";
import { SubmitButton } from "@/components/SubmitButton";

type PackageRow = {
  id: string;
  tracking_number: string | null;
  carrier: string | null;
  status: string;
  expected_delivery_date: string | null;
  delivered_at: string | null;
  delivered_source: string | null;
  confirmed_at: string | null;
  confirmed_source: string | null;
  confirmed_by: string | null;
  profiles: { name: string } | null;
};

type ConfirmationRow = {
  id: string;
  package_id: string;
  outcome: string;
  note: string | null;
  photo_path: string | null;
  created_at: string;
  profiles: { name: string } | null;
  package_confirmation_items: {
    actual_quantity: number;
    item_note: string | null;
    order_items: { name: string; expected_quantity: number } | null;
  }[];
};

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
      .select(
        "id, tracking_number, carrier, status, expected_delivery_date, delivered_at, delivered_source, confirmed_at, confirmed_source, confirmed_by, profiles(name)",
      )
      .eq("order_id", id)
      .order("created_at")
      .returns<PackageRow[]>(),
  ]);

  const packageIds = (packages ?? []).map((p) => p.id);
  const { data: confirmations } = packageIds.length
    ? await supabase
        .from("package_confirmations")
        .select(
          "id, package_id, outcome, note, photo_path, created_at, profiles(name), package_confirmation_items(actual_quantity, item_note, order_items(name, expected_quantity))",
        )
        .in("package_id", packageIds)
        .order("created_at", { ascending: false })
        .returns<ConfirmationRow[]>()
    : { data: [] as ConfirmationRow[] };

  const confirmationsWithPhotoUrls = await Promise.all(
    (confirmations ?? []).map(async (c) => {
      if (!c.photo_path) return { ...c, photoUrl: null };
      const { data: signed } = await supabase.storage
        .from("confirmation-photos")
        .createSignedUrl(c.photo_path, 3600);
      return { ...c, photoUrl: signed?.signedUrl ?? null };
    }),
  );
  const confirmationsByPackage = new Map<string, typeof confirmationsWithPhotoUrls>();
  for (const c of confirmationsWithPhotoUrls) {
    const list = confirmationsByPackage.get(c.package_id) ?? [];
    list.push(c);
    confirmationsByPackage.set(c.package_id, list);
  }

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

        <SubmitButton
          pendingText="Saving…"
          className="h-11 rounded-md bg-black text-base font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          Save
        </SubmitButton>
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
                  <RemoveItemButton itemId={item.id} itemName={item.name} />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              No items yet — waiting on the CSV import or a manual update.
            </p>
            <DeleteOrderButton orderId={order.id} />
          </div>
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
                {(pkg.delivered_at || pkg.confirmed_at) && (
                  <div className="mb-3 flex flex-col gap-0.5 text-xs text-zinc-600 dark:text-zinc-400">
                    {pkg.delivered_at && (
                      <p>
                        Retailer/carrier reported delivered{" "}
                        {new Date(pkg.delivered_at).toLocaleString()}
                        {pkg.delivered_source ? ` (source: ${pkg.delivered_source.replaceAll("_", " ")})` : ""}
                      </p>
                    )}
                    {pkg.confirmed_at && (
                      <p>
                        Confirmed {new Date(pkg.confirmed_at).toLocaleString()}
                        {pkg.confirmed_by
                          ? ` by ${pkg.profiles?.name ?? "cleaner"}`
                          : pkg.confirmed_source === "admin_manual"
                            ? " by admin (manual override)"
                            : ""}
                        {pkg.confirmed_source ? ` — source: ${pkg.confirmed_source.replaceAll("_", " ")}` : ""}
                      </p>
                    )}
                  </div>
                )}
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

                  <SubmitButton
                    pendingText="Saving…"
                    className="h-11 rounded-md border border-black/15 text-base font-medium disabled:opacity-50 dark:border-white/20"
                  >
                    Save package
                  </SubmitButton>
                </form>

                {(confirmationsByPackage.get(pkg.id) ?? []).length > 0 && (
                  <div className="mt-3 flex flex-col gap-2 border-t border-black/10 pt-3 dark:border-white/10">
                    <h3 className="text-sm font-medium">Confirmation history</h3>
                    {(confirmationsByPackage.get(pkg.id) ?? []).map((c) => (
                      <div
                        key={c.id}
                        className="flex flex-col gap-1 rounded-md bg-zinc-100 p-2 text-sm dark:bg-zinc-900"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium capitalize">
                            {c.outcome.replaceAll("_", " ")}
                          </span>
                          <span className="text-xs text-zinc-600 dark:text-zinc-400">
                            {c.profiles?.name} · {new Date(c.created_at).toLocaleString()}
                          </span>
                        </div>
                        {c.note && <p>{c.note}</p>}
                        {c.package_confirmation_items.length > 0 && (
                          <ul className="flex flex-col gap-0.5 text-xs text-zinc-600 dark:text-zinc-400">
                            {c.package_confirmation_items.map((item, i) => {
                              const expected = item.order_items?.expected_quantity;
                              const diff = expected != null && expected !== item.actual_quantity;
                              return (
                                <li key={i}>
                                  {item.order_items?.name}: received x{item.actual_quantity}
                                  {expected != null ? ` (expected x${expected})` : ""}
                                  {diff && (
                                    <span className="ml-1 font-medium text-amber-700 dark:text-amber-400">
                                      {item.actual_quantity < (expected ?? 0) ? "short" : "over"}
                                    </span>
                                  )}
                                  {item.item_note ? ` — ${item.item_note}` : ""}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                        {c.photoUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={c.photoUrl}
                            alt="Confirmation photo"
                            className="mt-1 max-h-48 rounded-md object-contain"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
