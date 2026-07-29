import type { SupabaseClient } from "@supabase/supabase-js";

// Past Orders qualification is entirely defined by orders_with_status.
// computed_status = 'completed' already means "every package is
// confirmed_received or cancelled" (see that view's definition) - cancelled
// counts as resolved for free, and requires_attention can never be true on
// a completed order (it's trigger-recomputed from a package status that's
// itself excluded from "completed"). No separate flag needed here.
export type DeliveryStatusFilter = "confirmed_received" | "cancelled";

export type PastOrdersFilters = {
  propertyIds: string[] | null; // null = no restriction
  retailerId: string | null;
  cleanerId: string | null; // matches package_confirmations.reported_by
  orderNumber: string | null; // substring match
  itemName: string | null; // substring match against order_items.name
  dateFrom: string | null; // yyyy-mm-dd, order_date, inclusive
  dateTo: string | null; // yyyy-mm-dd, order_date, inclusive
  deliveryStatus: DeliveryStatusFilter | null;
  hadIssue: boolean; // true = only orders with a non-'all_correct' confirmation, ever
};

export type PastOrderPackage = {
  id: string;
  status: DeliveryStatusFilter;
  trackingNumber: string | null;
  carrier: string | null;
  deliveredAt: string | null;
  deliveredSource: string | null;
  confirmedAt: string | null;
  confirmedSource: string | null;
  confirmedByName: string | null;
};

export type PastOrderSummary = {
  orderId: string;
  orderNumber: string | null;
  orderDate: string;
  totalAmount: number | null;
  retailerName: string;
  propertyName: string;
  hadIssue: boolean;
  packages: PastOrderPackage[];
};

function parseListParam(value: string | string[] | undefined): string[] | null {
  if (!value) return null;
  const list = Array.isArray(value) ? value : [value];
  const filtered = list.map((v) => v.trim()).filter(Boolean);
  return filtered.length > 0 ? filtered : null;
}

function parseSingleParam(value: string | string[] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  const trimmed = first?.trim();
  return trimmed ? trimmed : null;
}

export function parsePastOrdersFilters(
  searchParams: Record<string, string | string[] | undefined>,
): PastOrdersFilters {
  const deliveryStatusRaw = parseSingleParam(searchParams.delivery_status);
  return {
    propertyIds: parseListParam(searchParams.property_id),
    retailerId: parseSingleParam(searchParams.retailer_id),
    cleanerId: parseSingleParam(searchParams.cleaner_id),
    orderNumber: parseSingleParam(searchParams.order_number),
    itemName: parseSingleParam(searchParams.item),
    dateFrom: parseSingleParam(searchParams.date_from),
    dateTo: parseSingleParam(searchParams.date_to),
    deliveryStatus:
      deliveryStatusRaw === "confirmed_received" || deliveryStatusRaw === "cancelled"
        ? deliveryStatusRaw
        : null,
    hadIssue: parseSingleParam(searchParams.had_issue) === "1",
  };
}

type OrderRow = {
  id: string;
  order_number: string | null;
  order_date: string;
  total_amount: number | null;
  had_issue: boolean;
  retailers: { name: string } | null;
  properties: { name: string } | null;
  packages: {
    id: string;
    status: DeliveryStatusFilter;
    tracking_number: string | null;
    carrier: string | null;
    delivered_at: string | null;
    delivered_source: string | null;
    confirmed_at: string | null;
    confirmed_source: string | null;
    profiles: { name: string } | null;
  }[];
};

// Same split as billing-report.ts's fetchBillingLines: simple top-level
// column filters run as real SQL predicates against orders_with_status;
// filters that reach into a child table (item name, cleaner) get resolved
// to an order-id set first and intersected in application code, since
// PostgREST embedded-filter syntax doesn't cleanly express "any package's
// any confirmation matches X" alongside independent top-level filters.
export async function fetchPastOrders(
  supabase: SupabaseClient,
  filters: PastOrdersFilters,
): Promise<PastOrderSummary[]> {
  const candidateSets: string[][] = [];

  if (filters.itemName) {
    const { data, error } = await supabase
      .from("order_items")
      .select("order_id")
      .ilike("name", `%${filters.itemName}%`);
    if (error) throw error;
    candidateSets.push([...new Set((data ?? []).map((r) => r.order_id as string))]);
  }

  if (filters.cleanerId) {
    const { data, error } = await supabase
      .from("package_confirmations")
      .select("packages!inner(order_id)")
      .eq("reported_by", filters.cleanerId)
      .returns<{ packages: { order_id: string } }[]>();
    if (error) throw error;
    candidateSets.push([...new Set((data ?? []).map((r) => r.packages.order_id))]);
  }

  // Intersect every cross-table filter's candidate set into one. An empty
  // (but non-null) result means one of them matched nothing, so the final
  // query would too - skip it.
  const candidateOrderIds: string[] | null =
    candidateSets.length > 0 ? candidateSets.reduce((acc, ids) => acc.filter((id) => ids.includes(id))) : null;
  if (candidateOrderIds !== null && candidateOrderIds.length === 0) return [];

  let query = supabase
    .from("orders_with_status")
    .select(
      `id, order_number, order_date, total_amount, had_issue,
       retailers (name),
       properties (name),
       packages (id, status, tracking_number, carrier, delivered_at, delivered_source, confirmed_at, confirmed_source, profiles (name))`,
    )
    .eq("computed_status", "completed")
    .order("order_date", { ascending: false });

  if (filters.propertyIds) query = query.in("property_id", filters.propertyIds);
  if (filters.retailerId) query = query.eq("retailer_id", filters.retailerId);
  if (filters.orderNumber) query = query.ilike("order_number", `%${filters.orderNumber}%`);
  if (filters.dateFrom) query = query.gte("order_date", filters.dateFrom);
  if (filters.dateTo) query = query.lte("order_date", filters.dateTo);
  if (filters.hadIssue) query = query.eq("had_issue", true);
  if (candidateOrderIds) query = query.in("id", candidateOrderIds);

  const { data, error } = await query.returns<OrderRow[]>();
  if (error) throw error;

  let orders = (data ?? []).map(
    (o): PastOrderSummary => ({
      orderId: o.id,
      orderNumber: o.order_number,
      orderDate: o.order_date,
      totalAmount: o.total_amount,
      retailerName: o.retailers?.name ?? "Unknown retailer",
      propertyName: o.properties?.name ?? "Unknown property",
      hadIssue: o.had_issue,
      packages: o.packages.map((p) => ({
        id: p.id,
        status: p.status,
        trackingNumber: p.tracking_number,
        carrier: p.carrier,
        deliveredAt: p.delivered_at,
        deliveredSource: p.delivered_source,
        confirmedAt: p.confirmed_at,
        confirmedSource: p.confirmed_source,
        confirmedByName: p.profiles?.name ?? null,
      })),
    }),
  );

  // deliveryStatus is a per-package fact, not a per-order one - filtering it
  // via the top-level query would need an !inner embed that also drops
  // sibling packages from the result, which would break "what was ordered
  // vs received" for orders with more than one package. Filter in memory
  // instead: keep orders where at least one package matches.
  if (filters.deliveryStatus) {
    const status = filters.deliveryStatus;
    orders = orders.filter((o) => o.packages.some((p) => p.status === status));
  }

  return orders;
}
