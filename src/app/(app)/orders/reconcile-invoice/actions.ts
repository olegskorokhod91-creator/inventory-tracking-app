"use server";

import { revalidatePath } from "next/cache";
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

export type FileExtractResult =
  | { status: "error"; filename: string; error: string }
  | { status: "duplicate"; filename: string; existingOrderId: string; amazonOrderNumber: string }
  | {
      status: "extracted";
      filename: string;
      pdfImportId: string | null;
      amazonOrderNumber: string | null;
      poNumber: string | null;
      orderPlacedDate: string | null;
      orderTotal: number | null;
      shipments: ShipmentDraft[];
      matchedPropertyId: string | null;
      candidates: CandidatePlaceholder[];
    };

export type ExtractState = { files: FileExtractResult[] } | undefined;

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// Amazon's PO field only ever holds the street address (number + street
// name) - never city/state/zip - so matching against a property's full
// mailing address, or against a po_number that was auto-filled from one,
// needs the same reduction first. Also normalizes common street-suffix
// abbreviations ("Lane" vs "Ln") so the same real address matches
// regardless of which form got typed where - confirmed against a real
// mismatch (property stored as "102 Cottage Ln, Michigan City, IN 46360",
// invoice PO printed as "102 Cottage Lane").
const STREET_SUFFIXES: Record<string, string> = {
  street: "st", st: "st",
  avenue: "ave", ave: "ave",
  boulevard: "blvd", blvd: "blvd",
  drive: "dr", dr: "dr",
  lane: "ln", ln: "ln",
  road: "rd", rd: "rd",
  court: "ct", ct: "ct",
  place: "pl", pl: "pl",
  circle: "cir", cir: "cir",
  terrace: "ter", ter: "ter",
  parkway: "pkwy", pkwy: "pkwy",
  highway: "hwy", hwy: "hwy",
  way: "way",
};

function normalizeStreetAddress(input: string): string {
  // Street portion only - everything before the first comma. A full
  // mailing address is "street, city, state zip"; the PO field itself
  // never has a comma, so this is a no-op there.
  const streetPart = input.split(",")[0];
  return streetPart
    .toLowerCase()
    .replace(/[.,]/g, "")
    .trim()
    .split(/\s+/)
    .map((word) => STREET_SUFFIXES[word] ?? word)
    .join(" ");
}

// Street number + name is treated as a unique key across the portfolio
// (confirmed: street names repeat, numbers never do) - but if a
// normalization ever produces more than one candidate anyway, that's
// exactly the kind of ambiguity this app never guesses through elsewhere,
// so it falls back to null (manual selection) rather than picking one.
async function matchProperty(
  supabase: SupabaseServerClient,
  poNumber: string | null,
): Promise<string | null> {
  if (!poNumber) return null;
  const normalizedPo = normalizeStreetAddress(poNumber);
  if (!normalizedPo) return null;

  const { data: properties } = await supabase
    .from("properties")
    .select("id, address, po_number");
  if (!properties) return null;

  const byPoNumber = properties.filter(
    (p) => p.po_number && normalizeStreetAddress(p.po_number) === normalizedPo,
  );
  if (byPoNumber.length === 1) return byPoNumber[0].id;
  if (byPoNumber.length > 1) return null;

  const byAddress = properties.filter(
    (p) => normalizeStreetAddress(p.address) === normalizedPo,
  );
  return byAddress.length === 1 ? byAddress[0].id : null;
}

async function processOneFile(
  supabase: SupabaseServerClient,
  adminId: string,
  file: File,
): Promise<FileExtractResult> {
  if (file.size === 0) {
    return { status: "error", filename: file.name, error: "Empty file." };
  }

  const buffer = await file.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");
  const extraction = await extractPdfInvoice(base64);

  if (!extraction.is_amazon_invoice) {
    return {
      status: "error",
      filename: file.name,
      error: "This doesn't look like an Amazon \"Final Details\" invoice PDF.",
    };
  }

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
        filename: file.name,
        existingOrderId: existing.id,
        amazonOrderNumber: extraction.amazon_order_number,
      };
    }
  }

  const matchedPropertyId = await matchProperty(supabase, extraction.po_number);

  // PO number is property-level, not batch-level, so more than one pending
  // placeholder can legitimately exist for the same property (e.g. two
  // separate "mark ordered" passes done at different times, or several
  // files in this same upload resolving to the same property). All are
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
      uploaded_by: adminId,
      filename: file.name,
      amazon_order_number: extraction.amazon_order_number,
      po_number: extraction.po_number,
      matched_property_id: matchedPropertyId,
    })
    .select("id")
    .single();

  return {
    status: "extracted",
    filename: file.name,
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

// Phase 1: upload -> extract -> match, independently per file. Nothing
// touches orders/packages/order_items here - only a light audit row
// (pdf_invoice_imports) per file, same as csv_imports. The admin reviews
// and can still edit everything before anything real is written, in
// confirmReconciliation below.
export async function extractInvoices(
  _prevState: ExtractState,
  formData: FormData,
): Promise<ExtractState> {
  const profile = await requireAdmin();

  const files = formData.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return { files: [{ status: "error", filename: "", error: "No file selected." }] };
  }

  const supabase = await createClient();
  const results: FileExtractResult[] = [];
  for (const file of files) {
    results.push(await processOneFile(supabase, profile.id, file));
  }

  return { files: results };
}

export type ConfirmState = { success: true; orderId: string } | { success: false; error: string } | undefined;

// Phase 2: the explicit, reviewed save. Only point in the app where an
// admin can edit an order's item list after creation - scoped to exactly
// this step, per the product rule everywhere else in this app that items
// are otherwise immutable once created. Returns a result instead of
// redirecting - with multiple independent review cards on one page from a
// multi-file upload, redirecting away on the first save would strand the
// rest.
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
  return { success: true, orderId };
}
