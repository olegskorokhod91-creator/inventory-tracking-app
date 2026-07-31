import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { OrderForm } from "./OrderForm";

export default async function NewOrderPage() {
  await requireAdmin();

  const supabase = await createClient();

  const [{ data: retailers }, { data: properties }, { data: openRequests }] =
    await Promise.all([
      supabase.from("retailers").select("id, name").order("name"),
      supabase.from("properties").select("id, name").order("name"),
      supabase
        .from("supply_requests")
        .select("id, property_id, item_name, quantity, note")
        // Excludes items already marked "ordered" via the batch-fulfillment
        // flow (Requests screen) - those should only ever be resolved
        // through PDF reconciliation from here on, not also resolvable a
        // second, conflicting way through this older direct-order path.
        .is("resolved_by_order_id", null)
        .is("ordered_order_id", null),
    ]);

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-semibold">New order</h1>
      <OrderForm
        retailers={retailers ?? []}
        properties={properties ?? []}
        openRequests={openRequests ?? []}
      />
    </div>
  );
}
