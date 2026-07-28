import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { OrderForm } from "./OrderForm";

export default async function NewOrderPage() {
  await requireAdmin();

  const supabase = await createClient();

  const [{ data: retailers }, { data: properties }] = await Promise.all([
    supabase.from("retailers").select("id, name").order("name"),
    supabase.from("properties").select("id, name").order("name"),
  ]);

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-semibold">New order</h1>
      <OrderForm retailers={retailers ?? []} properties={properties ?? []} />
    </div>
  );
}
