import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  parseBillingFilters,
  fetchBillingLines,
  buildBillingReport,
  type BillingLine,
  type PropertyGroup,
} from "@/lib/billing-report";

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function LineRow({ line }: { line: BillingLine }) {
  return (
    <tr className="border-b border-black/5 dark:border-white/10">
      <td className="whitespace-nowrap py-2 pr-3 text-sm">{line.orderDate}</td>
      <td className="py-2 pr-3 text-sm">{line.retailerName}</td>
      <td className="py-2 pr-3 text-sm">
        {line.itemName}
        {line.requiresAttention && (
          <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-400">
            Requires attention
          </span>
        )}
      </td>
      <td className="py-2 pr-3 text-right text-sm">{line.quantity}</td>
      <td className="py-2 text-right text-sm">{money(line.lineCost)}</td>
    </tr>
  );
}

function PropertyTable({
  group,
  showHeader,
}: {
  group: PropertyGroup;
  showHeader: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      {showHeader && (
        <div className="flex items-center justify-between">
          <h3 className="font-medium">{group.propertyName}</h3>
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            {money(group.subtotal)}
          </span>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] border-collapse">
          <thead>
            <tr className="border-b border-black/10 text-left text-xs uppercase text-zinc-500 dark:border-white/10">
              <th className="py-1 pr-3 font-medium">Date</th>
              <th className="py-1 pr-3 font-medium">Retailer</th>
              <th className="py-1 pr-3 font-medium">Item</th>
              <th className="py-1 pr-3 text-right font-medium">Qty</th>
              <th className="py-1 text-right font-medium">Cost</th>
            </tr>
          </thead>
          <tbody>
            {group.lines.map((line, i) => (
              <LineRow key={`${line.orderId}-${i}`} line={line} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default async function OwnerBillingReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const resolvedSearchParams = await searchParams;
  const filters = parseBillingFilters(resolvedSearchParams);

  const supabase = await createClient();
  const [{ data: properties }, { data: owners }, { data: retailers }] =
    await Promise.all([
      supabase.from("properties").select("id, name").order("name"),
      supabase.from("owners").select("id, name").order("name"),
      supabase.from("retailers").select("id, name").order("name"),
    ]);

  const lines = await fetchBillingLines(supabase, filters);
  const report = buildBillingReport(lines);

  const exportQuery = new URLSearchParams();
  for (const [key, value] of Object.entries(resolvedSearchParams)) {
    if (!value) continue;
    for (const v of Array.isArray(value) ? value : [value]) {
      exportQuery.append(key, v);
    }
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-semibold">Owner billing report</h1>

      <form
        method="get"
        className="flex flex-col gap-3 rounded-lg border border-black/10 p-4 dark:border-white/10"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Property (multi-select — none selected means all)
            <select
              name="property_id"
              multiple
              defaultValue={filters.propertyIds ?? []}
              size={5}
              className="rounded-md border border-black/15 px-3 py-2 text-base font-normal dark:border-white/20"
            >
              {properties?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium">
              Owner
              <select
                name="owner_id"
                defaultValue={filters.ownerId ?? ""}
                className="h-11 rounded-md border border-black/15 px-3 text-base font-normal dark:border-white/20"
              >
                <option value="">All owners</option>
                {owners?.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-sm font-medium">
              Retailer
              <select
                name="retailer_id"
                defaultValue={filters.retailerId ?? ""}
                className="h-11 rounded-md border border-black/15 px-3 text-base font-normal dark:border-white/20"
              >
                <option value="">All retailers</option>
                {retailers?.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex gap-2">
              <label className="flex flex-1 flex-col gap-1 text-sm font-medium">
                From
                <input
                  type="date"
                  name="date_from"
                  defaultValue={filters.dateFrom ?? ""}
                  className="h-11 min-w-0 rounded-md border border-black/15 px-3 text-base font-normal dark:border-white/20"
                />
              </label>
              <label className="flex flex-1 flex-col gap-1 text-sm font-medium">
                To
                <input
                  type="date"
                  name="date_to"
                  defaultValue={filters.dateTo ?? ""}
                  className="h-11 min-w-0 rounded-md border border-black/15 px-3 text-base font-normal dark:border-white/20"
                />
              </label>
            </div>
          </div>
        </div>

        <button
          type="submit"
          className="h-11 rounded-md bg-black text-base font-medium text-white dark:bg-white dark:text-black"
        >
          Apply filters
        </button>
      </form>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-black/10 p-4 dark:border-white/10">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Total spend</p>
          <p className="text-2xl font-semibold">{money(report.summary.totalSpend)}</p>
        </div>
        <div className="rounded-lg border border-black/10 p-4 dark:border-white/10">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Orders</p>
          <p className="text-2xl font-semibold">{report.summary.orderCount}</p>
        </div>
        <div className="rounded-lg border border-black/10 p-4 dark:border-white/10">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Items</p>
          <p className="text-2xl font-semibold">{report.summary.itemCount}</p>
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        <a
          href={`/api/reports/owner-billing/export?${new URLSearchParams({
            ...Object.fromEntries(exportQuery),
            format: "csv",
          }).toString()}`}
          className="h-11 shrink-0 rounded-md border border-black/15 px-4 text-base font-medium leading-[44px] dark:border-white/20"
        >
          Export CSV
        </a>
        <a
          href={`/api/reports/owner-billing/export?${new URLSearchParams({
            ...Object.fromEntries(exportQuery),
            format: "xlsx",
          }).toString()}`}
          className="h-11 shrink-0 rounded-md border border-black/15 px-4 text-base font-medium leading-[44px] dark:border-white/20"
        >
          Export Excel
        </a>
      </div>

      {lines.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          No billable orders match these filters.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {report.ownerGroups.map((owner) => (
            <div
              key={owner.ownerId}
              className="flex flex-col gap-4 rounded-lg border border-black/10 p-4 dark:border-white/10"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-medium">{owner.ownerName}</h2>
                <span className="font-medium">{money(owner.subtotal)}</span>
              </div>
              <div className="flex flex-col gap-4 pl-2">
                {owner.properties.map((group) => (
                  <PropertyTable key={group.propertyId} group={group} showHeader />
                ))}
              </div>
            </div>
          ))}

          {report.ungroupedProperties.map((group) => (
            <div
              key={group.propertyId}
              className="rounded-lg border border-black/10 p-4 dark:border-white/10"
            >
              <PropertyTable group={group} showHeader={report.showPropertyHeaders} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
