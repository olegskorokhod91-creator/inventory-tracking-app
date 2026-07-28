import Papa from "papaparse";

export type ParsedCsvItem = {
  name: string;
  expected_quantity: number;
  unit_price: string;
};

export type ParsedCsvOrder = {
  order_number: string;
  order_date: string;
  total_amount: number;
  po_number: string | null;
  items: ParsedCsvItem[];
};

// Amazon Business "Orders" report specifically (Business Analytics export).
// One row per line item; Order Date/Order ID/PO Number/Order Net Total
// repeat identically across every row of a multi-item order, confirmed
// against a real sample export. A different retailer's report would need
// its own parser - not attempting a generic multi-format importer here.
export function parseAmazonBusinessOrdersCsv(csvText: string): ParsedCsvOrder[] {
  const { data } = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  const grouped = new Map<string, ParsedCsvOrder>();

  for (const row of data) {
    const orderNumber = row["Order ID"]?.trim();
    if (!orderNumber) continue;

    if (!grouped.has(orderNumber)) {
      grouped.set(orderNumber, {
        order_number: orderNumber,
        order_date: toIsoDate(row["Order Date"]),
        total_amount: Number(row["Order Net Total"]) || 0,
        po_number: row["PO Number"]?.trim() || null,
        items: [],
      });
    }

    const title = row["Title"]?.trim();
    if (!title) continue;

    grouped.get(orderNumber)!.items.push({
      name: title,
      expected_quantity: Number(row["Item Quantity"]) || 1,
      unit_price: row["Purchase PPU"] ?? "",
    });
  }

  return [...grouped.values()];
}

function toIsoDate(mmddyyyy: string): string {
  const [mm, dd, yyyy] = (mmddyyyy ?? "").trim().split("/");
  return `${yyyy}-${mm}-${dd}`;
}
