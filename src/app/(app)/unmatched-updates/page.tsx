import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { resolveUnmatchedUpdate, dismissUnmatchedUpdate } from "./actions";

type UnmatchedRow = {
  id: string;
  reason: string;
  extracted_order_number: string | null;
  extracted_tracking_number: string | null;
  extracted_carrier: string | null;
  extracted_status: string | null;
  created_at: string;
  imported_emails: { sender: string; subject: string | null } | null;
};

export default async function UnmatchedUpdatesPage() {
  await requireAdmin();

  const supabase = await createClient();

  const [{ data: updates }, { data: orders }] = await Promise.all([
    supabase
      .from("unmatched_updates")
      .select(
        "id, reason, extracted_order_number, extracted_tracking_number, extracted_carrier, extracted_status, created_at, imported_emails(sender, subject)",
      )
      .is("resolved_at", null)
      .order("created_at", { ascending: true })
      .returns<UnmatchedRow[]>(),
    supabase
      .from("orders")
      .select("id, order_number, order_date")
      .order("order_date", { ascending: false }),
  ]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-semibold">Unmatched updates</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Shipping/status emails that couldn&apos;t be confidently matched to
        an order — pick the right one manually, or dismiss if it doesn&apos;t
        apply.
      </p>

      {updates && updates.length > 0 ? (
        <ul className="flex flex-col gap-4">
          {updates.map((update) => {
            const resolveUpdate = resolveUnmatchedUpdate.bind(null, update.id);
            const dismissUpdate = dismissUnmatchedUpdate.bind(null, update.id);

            return (
              <li
                key={update.id}
                className="flex flex-col gap-3 rounded-lg border border-black/10 p-4 dark:border-white/10"
              >
                <div>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    From {update.imported_emails?.sender} —{" "}
                    {update.imported_emails?.subject}
                  </p>
                  <p className="text-sm">{update.reason}</p>
                </div>

                <div className="text-sm text-zinc-600 dark:text-zinc-400">
                  {update.extracted_order_number && (
                    <p>Order #: {update.extracted_order_number}</p>
                  )}
                  {update.extracted_tracking_number && (
                    <p>Tracking: {update.extracted_tracking_number}</p>
                  )}
                  {update.extracted_carrier && (
                    <p>Carrier: {update.extracted_carrier}</p>
                  )}
                  {update.extracted_status && (
                    <p>Status: {update.extracted_status.replaceAll("_", " ")}</p>
                  )}
                </div>

                <form action={resolveUpdate} className="flex flex-wrap gap-2">
                  <select
                    name="order_id"
                    aria-label="Match to order"
                    required
                    defaultValue=""
                    className="h-11 min-w-0 flex-1 rounded-md border border-black/15 px-3 text-sm dark:border-white/20"
                  >
                    <option value="" disabled>
                      Select an order…
                    </option>
                    {orders?.map((order) => (
                      <option key={order.id} value={order.id}>
                        {order.order_date} · #{order.order_number}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    className="h-11 shrink-0 rounded-md bg-black px-4 text-sm font-medium text-white dark:bg-white dark:text-black"
                  >
                    Apply
                  </button>
                </form>

                <form action={dismissUpdate}>
                  <button
                    type="submit"
                    className="text-sm font-medium text-red-600 underline"
                  >
                    Dismiss
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-zinc-600 dark:text-zinc-400">
          No unmatched updates right now.
        </p>
      )}
    </div>
  );
}
