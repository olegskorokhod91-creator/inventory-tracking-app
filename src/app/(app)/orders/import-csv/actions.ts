"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { parseAmazonBusinessOrdersCsv } from "@/lib/csv-import";

export type CsvImportResult =
  | { success: true; created: number; updated: number; totalOrders: number }
  | { success: false; error: string }
  | undefined;

export async function importCsv(
  _prevState: CsvImportResult,
  formData: FormData,
): Promise<CsvImportResult> {
  const profile = await requireAdmin();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { success: false, error: "No file selected." };
  }

  const csvText = await file.text();
  const parsedOrders = parseAmazonBusinessOrdersCsv(csvText);

  if (parsedOrders.length === 0) {
    return { success: false, error: "No orders found in that file." };
  }

  const supabase = await createClient();

  const { data: retailer } = await supabase
    .from("retailers")
    .select("id")
    .eq("name", "Amazon")
    .single();

  if (!retailer) {
    return { success: false, error: "Amazon retailer not found." };
  }

  let created = 0;
  let updated = 0;
  let rowCount = 0;

  for (const order of parsedOrders) {
    rowCount += order.items.length;

    const { data: existing } = await supabase
      .from("orders")
      .select("id")
      .eq("retailer_id", retailer.id)
      .eq("order_number", order.order_number)
      .maybeSingle();

    const { error } = await supabase.rpc("upsert_order_from_pipeline", {
      p_source: "csv",
      p_retailer_id: retailer.id,
      p_order_number: order.order_number,
      p_order_date: order.order_date,
      p_total_amount: order.total_amount,
      p_po_number: order.po_number,
      p_items: order.items,
    });

    if (error) {
      console.error("upsert_order_from_pipeline failed:", order.order_number, error);
      continue;
    }

    if (existing) {
      updated += 1;
    } else {
      created += 1;
    }
  }

  await supabase.from("csv_imports").insert({
    uploaded_by: profile.id,
    filename: file.name,
    row_count: rowCount,
    order_count: parsedOrders.length,
  });

  revalidatePath("/orders");

  return { success: true, created, updated, totalOrders: parsedOrders.length };
}
