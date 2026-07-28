import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type RequestRow = {
  id: string;
  item_name: string;
  quantity: number | null;
  note: string | null;
  created_at: string;
  property_id: string;
  properties: { name: string } | null;
};

export default async function RequestsPage() {
  await requireAdmin();

  const supabase = await createClient();
  const { data: requests } = await supabase
    .from("supply_requests")
    .select("id, item_name, quantity, note, created_at, property_id, properties(name)")
    .is("resolved_by_order_id", null)
    .order("created_at", { ascending: true })
    .returns<RequestRow[]>();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-semibold">Open requests</h1>

      {requests && requests.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {requests.map((r) => (
            <li
              key={r.id}
              className="rounded-lg border border-black/10 p-4 dark:border-white/10"
            >
              <Link
                href={`/properties/${r.property_id}`}
                className="font-medium underline"
              >
                {r.properties?.name}
              </Link>
              <p>
                {r.item_name}
                {r.quantity ? ` x${r.quantity}` : ""}
              </p>
              {r.note && (
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  {r.note}
                </p>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-zinc-600 dark:text-zinc-400">
          No open supply requests.
        </p>
      )}
    </div>
  );
}
