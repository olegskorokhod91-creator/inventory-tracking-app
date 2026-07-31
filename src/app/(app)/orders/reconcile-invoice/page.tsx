import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ReconcileForm } from "./ReconcileForm";

export default async function ReconcileInvoicePage() {
  await requireAdmin();

  const supabase = await createClient();
  const { data: properties } = await supabase
    .from("properties")
    .select("id, name")
    .order("name");

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-semibold">Reconcile invoice</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Upload an Amazon &quot;Final Details&quot; PDF for a single order.
        Nothing is saved until you review and confirm below — Amazon-only
        for now, one PDF per Amazon order number.
      </p>
      <ReconcileForm properties={properties ?? []} />
    </div>
  );
}
