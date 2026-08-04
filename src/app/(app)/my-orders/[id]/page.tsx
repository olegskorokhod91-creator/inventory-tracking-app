import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Read-only counterpart to /orders/[id] for cleaners - same underlying
// data (RLS on orders/packages/order_items/package_confirmations already
// scopes all of this to assigned properties, since M5), but no edit forms
// at all, and total_amount/unit_price are never selected - same "zero
// pricing data" boundary as the list page.
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
  profiles: { name: string } | null;
};

type OrderHeaderRow = {
  id: string;
  order_number: string | null;
  order_date: string;
  computed_status: "active" | "completed";
  requires_attention: boolean;
  retailers: { name: string } | null;
  properties: { name: string } | null;
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

export default async function MyOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // A property_id IS NULL order (needs-review) never matches the cleaner
  // RLS policy anyway, so this naturally excludes those without needing to
  // filter for it explicitly - same as it does for every other cleaner
  // query in this app.
  const { data: order } = await supabase
    .from("orders_with_status")
    .select("id, order_number, order_date, computed_status, requires_attention, retailers(name), properties(name)")
    .eq("id", id)
    .single<OrderHeaderRow>();
  if (!order) notFound();

  const [{ data: items }, { data: packages }] = await Promise.all([
    supabase
      .from("order_items")
      .select("id, name, expected_quantity")
      .eq("order_id", id)
      .order("name"),
    supabase
      .from("packages")
      .select(
        "id, tracking_number, carrier, status, expected_delivery_date, delivered_at, delivered_source, confirmed_at, confirmed_source, profiles(name)",
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

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Order detail</h1>
        <span className="rounded-full bg-zinc-200 px-2 py-1 text-xs font-medium capitalize dark:bg-zinc-800">
          {order.computed_status}
        </span>
      </div>

      <div className="flex flex-col gap-1 rounded-lg border border-black/10 p-4 dark:border-white/10">
        <p className="font-medium">
          {order.retailers?.name} — {order.properties?.name}
        </p>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {order.order_date}
          {order.order_number ? ` · #${order.order_number}` : ""}
        </p>
        {order.requires_attention && (
          <span className="mt-1 w-fit rounded-full bg-red-100 px-2 py-1 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-400">
            Requires attention
          </span>
        )}
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Items</h2>
        {items && items.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-2 rounded-md border border-black/10 px-3 py-2 dark:border-white/10"
              >
                <span>{item.name}</span>
                <span className="text-sm text-zinc-600 dark:text-zinc-400">
                  x{item.expected_quantity}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            No items itemized for this order yet.
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Packages</h2>
        <ul className="flex flex-col gap-3">
          {packages?.map((pkg) => (
            <li
              key={pkg.id}
              className="flex flex-col gap-2 rounded-md border border-black/10 p-3 dark:border-white/10"
            >
              <div className="flex items-center justify-between">
                <span className="rounded-full bg-zinc-200 px-2 py-1 text-xs font-medium capitalize dark:bg-zinc-800">
                  {pkg.status.replaceAll("_", " ")}
                </span>
              </div>
              <dl className="grid grid-cols-2 gap-1 text-sm">
                {pkg.tracking_number && (
                  <>
                    <dt className="text-zinc-600 dark:text-zinc-400">Tracking</dt>
                    <dd>{pkg.tracking_number}</dd>
                  </>
                )}
                {pkg.carrier && (
                  <>
                    <dt className="text-zinc-600 dark:text-zinc-400">Carrier</dt>
                    <dd>{pkg.carrier}</dd>
                  </>
                )}
                {pkg.expected_delivery_date && (
                  <>
                    <dt className="text-zinc-600 dark:text-zinc-400">Expected</dt>
                    <dd>{pkg.expected_delivery_date}</dd>
                  </>
                )}
              </dl>
              {(pkg.delivered_at || pkg.confirmed_at) && (
                <div className="flex flex-col gap-0.5 text-xs text-zinc-600 dark:text-zinc-400">
                  {pkg.delivered_at && (
                    <p>Delivered {new Date(pkg.delivered_at).toLocaleString()}</p>
                  )}
                  {pkg.confirmed_at && (
                    <p>
                      Confirmed {new Date(pkg.confirmed_at).toLocaleString()}
                      {pkg.confirmed_source === "admin_manual"
                        ? " by admin"
                        : pkg.profiles?.name
                          ? ` by ${pkg.profiles.name}`
                          : ""}
                    </p>
                  )}
                </div>
              )}

              {(confirmationsByPackage.get(pkg.id) ?? []).length > 0 && (
                <div className="mt-1 flex flex-col gap-2 border-t border-black/10 pt-3 dark:border-white/10">
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
          ))}
        </ul>
      </section>
    </div>
  );
}
