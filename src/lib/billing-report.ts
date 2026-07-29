import type { SupabaseClient } from "@supabase/supabase-js";

export type BillingFilters = {
  propertyIds: string[] | null; // null = no property restriction
  ownerId: string | null;
  retailerId: string | null;
  dateFrom: string | null; // yyyy-mm-dd, inclusive
  dateTo: string | null; // yyyy-mm-dd, inclusive
};

export type BillingLine = {
  orderId: string;
  orderDate: string;
  orderNumber: string | null;
  requiresAttention: boolean;
  retailerName: string;
  propertyId: string;
  propertyName: string;
  ownerId: string | null;
  ownerName: string | null;
  itemName: string;
  quantity: number;
  unitPrice: number | null;
  lineCost: number;
};

export type PropertyGroup = {
  propertyId: string;
  propertyName: string;
  subtotal: number;
  lines: BillingLine[];
};

export type OwnerGroup = {
  ownerId: string;
  ownerName: string;
  subtotal: number;
  properties: PropertyGroup[];
};

export type BillingReport = {
  summary: { totalSpend: number; orderCount: number; itemCount: number };
  showPropertyHeaders: boolean;
  ownerGroups: OwnerGroup[];
  ungroupedProperties: PropertyGroup[];
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

export function parseBillingFilters(
  searchParams: Record<string, string | string[] | undefined>,
): BillingFilters {
  return {
    propertyIds: parseListParam(searchParams.property_id),
    ownerId: parseSingleParam(searchParams.owner_id),
    retailerId: parseSingleParam(searchParams.retailer_id),
    dateFrom: parseSingleParam(searchParams.date_from),
    dateTo: parseSingleParam(searchParams.date_to),
  };
}

type OrderRow = {
  id: string;
  order_date: string;
  order_number: string | null;
  requires_attention: boolean;
  retailers: { name: string } | null;
  properties: {
    id: string;
    name: string;
    owner_id: string | null;
    owners: { id: string; name: string } | null;
  } | null;
  order_items: {
    id: string;
    name: string;
    expected_quantity: number;
    unit_price: number | null;
    is_refunded: boolean;
  }[];
};

// Fetches the raw filtered orders (from Postgres, where the simple
// top-level column filters live) and flattens + applies the two exclusions
// that aren't expressible as a single-column filter: cancelled orders
// (excluded entirely - order/item/spend counts all drop it) and refunded
// items (excluded per-line; an order left with zero billable items after
// that is dropped too, since there'd be nothing left to bill).
export async function fetchBillingLines(
  supabase: SupabaseClient,
  filters: BillingFilters,
): Promise<BillingLine[]> {
  // Owner filter narrows to that owner's properties; if a specific property
  // selection is *also* present, intersect rather than let either one win
  // outright - both filters are meant to apply together.
  let effectivePropertyIds = filters.propertyIds;
  if (filters.ownerId) {
    const { data: ownerProperties } = await supabase
      .from("properties")
      .select("id")
      .eq("owner_id", filters.ownerId);
    const ownerPropertyIds = (ownerProperties ?? []).map((p) => p.id);
    effectivePropertyIds = effectivePropertyIds
      ? effectivePropertyIds.filter((id) => ownerPropertyIds.includes(id))
      : ownerPropertyIds;
  }

  let query = supabase
    .from("orders")
    .select(
      `id, order_date, order_number, requires_attention,
       retailers (name),
       properties (id, name, owner_id, owners (id, name)),
       order_items (id, name, expected_quantity, unit_price, is_refunded)`,
    )
    .not("property_id", "is", null)
    .not("retailer_order_status", "ilike", "cancelled")
    .order("order_date", { ascending: false });

  if (effectivePropertyIds) {
    if (effectivePropertyIds.length === 0) return []; // owner has no matching properties
    query = query.in("property_id", effectivePropertyIds);
  }
  if (filters.retailerId) query = query.eq("retailer_id", filters.retailerId);
  if (filters.dateFrom) query = query.gte("order_date", filters.dateFrom);
  if (filters.dateTo) query = query.lte("order_date", filters.dateTo);

  const { data, error } = await query.returns<OrderRow[]>();
  if (error) throw error;

  const lines: BillingLine[] = [];

  for (const order of data ?? []) {
    if (!order.properties) continue; // property_id filter above should prevent this, belt-and-suspenders

    for (const item of order.order_items) {
      if (item.is_refunded) continue;

      const unitPrice = item.unit_price ?? 0;
      lines.push({
        orderId: order.id,
        orderDate: order.order_date,
        orderNumber: order.order_number,
        requiresAttention: order.requires_attention,
        retailerName: order.retailers?.name ?? "Unknown retailer",
        propertyId: order.properties.id,
        propertyName: order.properties.name,
        ownerId: order.properties.owner_id,
        ownerName: order.properties.owners?.name ?? null,
        itemName: item.name,
        quantity: item.expected_quantity,
        unitPrice: item.unit_price,
        lineCost: unitPrice * item.expected_quantity,
      });
    }
  }

  return lines;
}

export function buildBillingReport(lines: BillingLine[]): BillingReport {
  const totalSpend = lines.reduce((sum, l) => sum + l.lineCost, 0);
  const orderCount = new Set(lines.map((l) => l.orderId)).size;
  const itemCount = lines.reduce((sum, l) => sum + l.quantity, 0);

  const propertyOrder: string[] = [];
  const byProperty = new Map<string, PropertyGroup>();
  for (const line of lines) {
    let group = byProperty.get(line.propertyId);
    if (!group) {
      group = {
        propertyId: line.propertyId,
        propertyName: line.propertyName,
        subtotal: 0,
        lines: [],
      };
      byProperty.set(line.propertyId, group);
      propertyOrder.push(line.propertyId);
    }
    group.lines.push(line);
    group.subtotal += line.lineCost;
  }
  const propertyGroups = propertyOrder.map((id) => byProperty.get(id)!);

  // An owner "spans multiple properties" only relative to *this filtered
  // result set* - an owner with 5 properties but only 1 appearing here gets
  // no roll-up wrapper, just that one property group standalone.
  const ownerOrder: string[] = [];
  const byOwner = new Map<string, { ownerName: string; properties: PropertyGroup[] }>();
  const ungroupedProperties: PropertyGroup[] = [];

  for (const group of propertyGroups) {
    const line = group.lines[0];
    if (line.ownerId && line.ownerName) {
      let entry = byOwner.get(line.ownerId);
      if (!entry) {
        entry = { ownerName: line.ownerName, properties: [] };
        byOwner.set(line.ownerId, entry);
        ownerOrder.push(line.ownerId);
      }
      entry.properties.push(group);
    } else {
      ungroupedProperties.push(group);
    }
  }

  const ownerGroups: OwnerGroup[] = [];
  for (const ownerId of ownerOrder) {
    const entry = byOwner.get(ownerId)!;
    if (entry.properties.length > 1) {
      ownerGroups.push({
        ownerId,
        ownerName: entry.ownerName,
        subtotal: entry.properties.reduce((sum, p) => sum + p.subtotal, 0),
        properties: entry.properties,
      });
    } else {
      ungroupedProperties.push(...entry.properties);
    }
  }

  return {
    summary: { totalSpend, orderCount, itemCount },
    showPropertyHeaders: propertyGroups.length > 1,
    ownerGroups,
    ungroupedProperties,
  };
}
