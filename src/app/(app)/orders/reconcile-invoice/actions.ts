"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { extractPdfInvoice } from "@/lib/email-pipeline/extract";

export type ShipmentDraft = {
  shipped_date: string | null;
  items: { name: string; expected_quantity: string; unit_price: string }[];
};

export type CandidatePlaceholder = {
  orderId: string;
  batchId: string;
  batchItems: { id: string; item_name: string; quantity: number | null }[];
};

export type ExtractState =
  | { status: "error"; error: string }
  | { status: "duplicate"; existingOrderId: string; amazonOrderNumber: string }
  | {
      status: "extracted";
      pdfImportId: string | null;
      amazonOrderNumber: string | null;
      poNumber: string | null;
      orderPlacedDate: string | null;
      orderTotal: number | null;
      shipments: ShipmentDraft[];
      matchedPropertyId: string | null;
      candidates: CandidatePlaceholder[];
    }
  | undefined;

// Phase 1: upload -> extract -> match. Nothing touches orders/packages/
// order_items here - only a light audit row (pdf_invoice_imports), same as
// csv_imports. The admin reviews and can still edit everything before
// anything real is written, in confirmReconciliation below.
export async function extractInvoice(
  _prevState: ExtractState,
  formData: FormData,
): Promise<ExtractState> {
  const profile = await requireAdmin();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", error: "No file selected." };
  }

  const buffer = await file.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");
  const extraction = await extractPdfInvoice(base64);

  if (!extraction.is_amazon_invoice) {
    return {
      status: "error",
      error: "This doesn't look like an Amazon \"Final Details\" invoice PDF.",
    };
  }

  const supabase = await createClient();

  // Dedup: the same Amazon order number should never produce a second
  // order row, whether from a re-upload or from this order having already
  // been reconciled by some other path.
  if (extraction.amazon_order_number) {
    const { data: existing } = await supabase
      .from("orders")
      .select("id")
      .eq("order_number", extraction.amazon_order_number)
      .maybeSingle();
    if (existing) {
      return {
        status: "duplicate",
        existingOrderId: existing.id,
        amazonOrderNumber: extraction.amazon_order_number,
      };
    }
  }

  // PO number is an exact match key against the property's own configured
  // value - not a guess, and no fallback fuzzy matching if it doesn't hit.
  let matchedPropertyId: string | null = null;
  if (extraction.po_number) {
    const { data: property } = await supabase
      .from("properties")
      .select("id")
      .eq("po_number", extraction.po_number)
      .maybeSingle();
    matchedPropertyId = property?.id ?? null;
  }

  // PO number is property-level, not batch-level, so more than one pending
  // placeholder can legitimately exist for the same property (e.g. two
  // separate "mark ordered" passes done at different times). All are
  // surfaced as candidates - the admin picks, nothing is auto-selected.
  const candidates: CandidatePlaceholder[] = [];
  if (matchedPropertyId) {
    const { data: placeholders } = await supabase
      .from("orders")
      .select("id, request_batch_id")
      .eq("property_id", matchedPropertyId)
      .eq("source", "request_fulfillment")
      .is("order_number", null);

    for (const placeholder of placeholders ?? []) {
      if (!placeholder.request_batch_id) continue;
      const { data: batchItems } = await supabase
        .from("supply_requests")
        .select("id, item_name, quantity")
        .eq("batch_id", placeholder.request_batch_id)
        .is("resolved_by_order_id", null);
      candidates.push({
        orderId: placeholder.id,
        batchId: placeholder.request_batch_id,
        batchItems: batchItems ?? [],
      });
    }
  }

  const { data: pdfImport } = await supabase
    .from("pdf_invoice_imports")
    .insert({
      uploaded_by: profile.id,
      filename: file.name,
      amazon_order_number: extraction.amazon_order_number,
      po_number: extraction.po_number,
      matched_property_id: matchedPropertyId,
    })
    .select("id")
    .single();

  return {
    status: "extracted",
    pdfImportId: pdfImport?.id ?? null,
    amazonOrderNumber: extraction.amazon_order_number,
    poNumber: extraction.po_number,
    orderPlacedDate: extraction.order_placed_date,
    orderTotal: extraction.order_total,
    shipments: extraction.shipments.map((s) => ({
      shipped_date: s.shipped_date,
      items: s.items.map((i) => ({
        name: i.name,
        expected_quantity: String(i.quantity || 1),
        unit_price: i.unit_price != null ? String(i.unit_price) : "",
      })),
    })),
    matchedPropertyId,
    candidates,
  };
}

export type ConfirmState = { success: false; error: string } | undefined;

// Phase 2: the explicit, reviewed save. Only point in the app where an
// admin can edit an order's item list after creation - scoped to exactly
// this step, per the product rule everywhere else in this app that items
// are otherwise immutable once created.
export async function confirmReconciliation(
  _prevState: ConfirmState,
  formData: FormData,
): Promise<ConfirmState> {
  await requireAdmin();

  const propertyId = String(formData.get("property_id") ?? "");
  if (!propertyId) return { success: false, error: "Select a property." };

  const existingOrderId = String(formData.get("existing_order_id") ?? "") || null;
  const requestBatchId = String(formData.get("request_batch_id") ?? "") || null;
  const orderNumber = String(formData.get("order_number") ?? "").trim() || null;
  const orderDate = String(formData.get("order_date") ?? "").trim();
  const totalAmountRaw = String(formData.get("total_amount") ?? "").trim();
  const pdfImportId = String(formData.get("pdf_import_id") ?? "") || null;

  if (!orderDate) return { success: false, error: "Order date is required." };

  let draftShipments: {
    items: { name?: string; expected_quantity?: string; unit_price?: string }[];
  }[];
  try {
    draftShipments = JSON.parse(String(formData.get("shipments") ?? "[]"));
  } catch {
    return { success: false, error: "Malformed item data." };
  }

  const shipments = draftShipments
    .map((s) => ({
      items: s.items
        .map((i) => ({
          name: (i.name ?? "").trim(),
          expected_quantity: Number(i.expected_quantity) || 1,
          unit_price: i.unit_price ? Number(i.unit_price) : null,
        }))
        .filter((i) => i.name.length > 0),
    }))
    .filter((s) => s.items.length > 0);

  if (shipments.length === 0) {
    return { success: false, error: "At least one item is required." };
  }

  let resolvedRequestIds: string[];
  try {
    resolvedRequestIds = JSON.parse(String(formData.get("resolved_request_ids") ?? "[]"));
  } catch {
    resolvedRequestIds = [];
  }

  const supabase = await createClient();
  const { data: retailer } = await supabase
    .from("retailers")
    .select("id")
    .eq("name", "Amazon")
    .single();
  if (!retailer) return { success: false, error: "Amazon retailer not found." };

  const { data: orderId, error } = await supabase.rpc("reconcile_pdf_invoice_order", {
    p_existing_order_id: existingOrderId,
    p_property_id: propertyId,
    p_retailer_id: retailer.id,
    p_order_number: orderNumber,
    p_order_date: orderDate,
    p_total_amount: totalAmountRaw ? Number(totalAmountRaw) : null,
    p_request_batch_id: requestBatchId,
    p_shipments: shipments,
    p_resolved_request_ids: resolvedRequestIds,
    p_pdf_import_id: pdfImportId,
  });

  if (error || !orderId) {
    console.error("reconcile_pdf_invoice_order failed:", error);
    return { success: false, error: "Failed to save this order — try again." };
  }

  revalidatePath("/orders");
  revalidatePath("/requests");
  redirect(`/orders/${orderId}`);
}
