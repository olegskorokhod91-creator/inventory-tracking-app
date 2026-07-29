import { notFound } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ConfirmationForm } from "./ConfirmationForm";

type PackageDetail = {
  id: string;
  status: string;
  order_id: string;
  orders: {
    order_number: string | null;
    order_date: string;
    retailers: { name: string } | null;
    properties: { name: string } | null;
  } | null;
};

type PackageItemRow = {
  order_item_id: string;
  expected_quantity: number;
  order_items: { name: string } | null;
};

export default async function ConfirmationDetailPage({
  params,
}: {
  params: Promise<{ packageId: string }>;
}) {
  await getCurrentProfile();
  const { packageId } = await params;

  const supabase = await createClient();

  const { data: pkg } = await supabase
    .from("packages")
    .select(
      "id, status, order_id, orders(order_number, order_date, retailers(name), properties(name))",
    )
    .eq("id", packageId)
    .single<PackageDetail>();

  // RLS (not just this check) is what actually stops a cleaner from
  // reaching a package outside their assigned properties - a null result
  // here just means "not found" either way, which is the right response
  // for both "doesn't exist" and "not yours to see".
  if (!pkg) notFound();

  const { data: items } = await supabase
    .from("package_items")
    .select("order_item_id, expected_quantity, order_items(name)")
    .eq("package_id", packageId)
    .returns<PackageItemRow[]>();

  const formItems = (items ?? []).map((i) => ({
    orderItemId: i.order_item_id,
    name: i.order_items?.name ?? "Item",
    expectedQuantity: i.expected_quantity,
  }));

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-semibold">Confirm delivery</h1>

      <div className="rounded-lg border border-black/10 p-4 dark:border-white/10">
        <p className="font-medium">
          {pkg.orders?.retailers?.name}
          {pkg.orders?.order_number ? ` · #${pkg.orders.order_number}` : ""}
        </p>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {pkg.orders?.properties?.name} · {pkg.orders?.order_date}
        </p>
      </div>

      {pkg.status === "delivered" ? (
        <ConfirmationForm packageId={pkg.id} items={formItems} />
      ) : (
        <p className="text-zinc-600 dark:text-zinc-400">
          This package has already been confirmed — nothing left to do here.
        </p>
      )}
    </div>
  );
}
