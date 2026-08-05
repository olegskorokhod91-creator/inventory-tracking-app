import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { markRequestsOrdered } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";

type RequestItem = {
  id: string;
  item_name: string;
  quantity: number | null;
  note: string | null;
  ordered_order_id: string | null;
  resolved_by_order_id: string | null;
};

type BatchRow = {
  id: string;
  created_at: string;
  property_id: string;
  properties: { name: string; address: string } | null;
  supply_requests: RequestItem[];
};

type LinkedOrder = {
  id: string;
  order_number: string | null;
  request_batch_id: string;
};

function itemStatus(item: RequestItem): "Open" | "Ordered" | "Resolved" {
  if (item.resolved_by_order_id) return "Resolved";
  if (item.ordered_order_id) return "Ordered";
  return "Open";
}

const STATUS_STYLE: Record<string, string> = {
  Open: "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200",
  Ordered: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  Resolved: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
};

export default async function RequestsPage() {
  await requireAdmin();

  const supabase = await createClient();

  // status ('open'/'closed') only governs whether new cleaner requests can
  // still append to a batch - it says nothing about whether the admin still
  // needs to look at it. A closed (fully-ordered) batch can easily still be
  // awaiting PDF reconciliation, so this screen's own definition of "needs
  // attention" is broader: any batch with at least one item not yet
  // resolved_by_order_id, filtered in application code (same "child-table
  // filter resolved in TS, not SQL" precedent as billing-report.ts and
  // past-orders.ts) rather than via a subquery the JS query builder can't
  // express directly.
  const [{ data: allBatches }, { data: retailers }] = await Promise.all([
    supabase
      .from("supply_request_batches")
      .select(
        "id, created_at, property_id, properties(name, address), supply_requests(id, item_name, quantity, note, ordered_order_id, resolved_by_order_id)",
      )
      .order("created_at", { ascending: true })
      .returns<BatchRow[]>(),
    supabase.from("retailers").select("id, name").order("name"),
  ]);

  const batches = (allBatches ?? []).filter((b) =>
    b.supply_requests.some((r) => !r.resolved_by_order_id),
  );

  const batchIds = batches.map((b) => b.id);
  const { data: linkedOrders } =
    batchIds.length > 0
      ? await supabase
          .from("orders")
          .select("id, order_number, request_batch_id")
          .in("request_batch_id", batchIds)
          .returns<LinkedOrder[]>()
      : { data: [] as LinkedOrder[] };

  const amazonRetailer = (retailers ?? []).find((r) => r.name === "Amazon");

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-semibold">Open requests</h1>

      {batches && batches.length > 0 ? (
        <ul className="flex flex-col gap-4">
          {batches.map((batch) => {
            const openItems = batch.supply_requests.filter(
              (i) => itemStatus(i) === "Open",
            );
            const ordersForBatch = (linkedOrders ?? []).filter(
              (o) => o.request_batch_id === batch.id,
            );

            return (
              <li
                key={batch.id}
                className="flex flex-col gap-3 rounded-lg border border-black/10 p-4 dark:border-white/10"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <Link
                      href={`/properties/${batch.property_id}`}
                      className="font-medium underline"
                    >
                      {batch.properties?.name}
                    </Link>
                    {batch.properties?.address && (
                      <p className="text-sm text-zinc-600 dark:text-zinc-400">
                        {batch.properties.address}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
                    {new Date(batch.created_at).toLocaleDateString()}
                  </span>
                </div>

                <ul className="flex flex-col gap-2">
                  {batch.supply_requests.map((item) => {
                    const status = itemStatus(item);
                    return (
                      <li
                        key={item.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-black/10 p-2 dark:border-white/10"
                      >
                        <div>
                          <span className="font-medium">
                            {item.item_name}
                            {item.quantity ? ` x${item.quantity}` : ""}
                          </span>
                          {item.note && (
                            <p className="text-sm text-zinc-600 dark:text-zinc-400">
                              {item.note}
                            </p>
                          )}
                        </div>
                        <span
                          className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_STYLE[status]}`}
                        >
                          {status}
                        </span>
                      </li>
                    );
                  })}
                </ul>

                {ordersForBatch.length > 0 && (
                  <div className="flex flex-col gap-1 text-sm">
                    <span className="font-medium">Orders from this batch:</span>
                    {ordersForBatch.map((order) => (
                      <Link
                        key={order.id}
                        href={`/orders/${order.id}`}
                        className="underline"
                      >
                        {order.order_number
                          ? `#${order.order_number}`
                          : "Ordered — Awaiting Confirmation"}
                      </Link>
                    ))}
                  </div>
                )}

                {openItems.length > 0 && (
                  <form
                    action={markRequestsOrdered.bind(null, batch.id)}
                    className="flex flex-col gap-2 border-t border-black/10 pt-3 dark:border-white/10"
                  >
                    <p className="text-sm font-medium">
                      Mark items as ordered (uncheck anything not actually bought this trip)
                    </p>
                    <ul className="flex flex-col gap-1">
                      {openItems.map((item) => (
                        <li key={item.id} className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id={`item-${item.id}`}
                            name="request_ids"
                            value={item.id}
                            defaultChecked
                            className="h-5 w-5"
                          />
                          <label htmlFor={`item-${item.id}`} className="text-sm">
                            {item.item_name}
                            {item.quantity ? ` x${item.quantity}` : ""}
                          </label>
                        </li>
                      ))}
                    </ul>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        name="retailer_id"
                        defaultValue={amazonRetailer?.id ?? ""}
                        required
                        className="h-11 min-w-0 flex-1 rounded-md border border-black/15 px-3 text-base dark:border-white/20"
                      >
                        <option value="" disabled>
                          Retailer
                        </option>
                        {(retailers ?? []).map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                      <SubmitButton
                        pendingText="Marking…"
                        className="h-11 shrink-0 rounded-md bg-black px-4 text-base font-medium text-white dark:bg-white dark:text-black"
                      >
                        Mark as ordered
                      </SubmitButton>
                    </div>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-zinc-600 dark:text-zinc-400">
          No open supply requests.
        </p>
      )}
    </div>
  );
}
