import { NextRequest } from "next/server";
import Papa from "papaparse";
import writeXlsxFile from "write-excel-file/node";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { parseBillingFilters, fetchBillingLines, type BillingLine } from "@/lib/billing-report";

// A route handler, not a page - requireAdmin()'s redirect() doesn't make
// sense for a file download, so the admin check is inlined here instead.
export async function GET(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") {
    return new Response("Forbidden", { status: 403 });
  }

  const searchParams: Record<string, string | string[]> = {};
  for (const key of new Set(request.nextUrl.searchParams.keys())) {
    const values = request.nextUrl.searchParams.getAll(key);
    searchParams[key] = values.length > 1 ? values : values[0];
  }

  const format = request.nextUrl.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const filters = parseBillingFilters(searchParams);

  const supabase = await createClient();
  const lines = await fetchBillingLines(supabase, filters);

  const filename = `owner-billing-report.${format}`;

  if (format === "csv") {
    const csv = Papa.unparse(lines.map(toExportRow));
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  const buffer = await writeXlsxFile(lines, {
    columns: EXPORT_COLUMNS,
  }).toBuffer();

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

function toExportRow(line: BillingLine) {
  return {
    "Order date": line.orderDate,
    Owner: line.ownerName ?? "",
    Property: line.propertyName,
    Retailer: line.retailerName,
    "Order #": line.orderNumber ?? "",
    Item: line.itemName,
    Qty: line.quantity,
    "Unit price": line.unitPrice ?? "",
    Cost: line.lineCost,
    "Requires attention": line.requiresAttention ? "Yes" : "",
  };
}

const EXPORT_COLUMNS = [
  { header: "Order date", cell: (l: BillingLine) => l.orderDate },
  { header: "Owner", cell: (l: BillingLine) => l.ownerName ?? "" },
  { header: "Property", cell: (l: BillingLine) => l.propertyName },
  { header: "Retailer", cell: (l: BillingLine) => l.retailerName },
  { header: "Order #", cell: (l: BillingLine) => l.orderNumber ?? "" },
  { header: "Item", cell: (l: BillingLine) => l.itemName },
  { header: "Qty", cell: (l: BillingLine) => l.quantity, type: Number },
  {
    header: "Unit price",
    cell: (l: BillingLine) => l.unitPrice ?? undefined,
    type: Number,
  },
  { header: "Cost", cell: (l: BillingLine) => l.lineCost, type: Number },
  {
    header: "Requires attention",
    cell: (l: BillingLine) => (l.requiresAttention ? "Yes" : ""),
  },
];
