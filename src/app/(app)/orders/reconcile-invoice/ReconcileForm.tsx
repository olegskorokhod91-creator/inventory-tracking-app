"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import {
  extractInvoice,
  confirmReconciliation,
  type ExtractState,
  type ShipmentDraft,
} from "./actions";
import { SubmitButton } from "@/components/SubmitButton";

type Property = { id: string; name: string };

function itemLooksRequested(
  batchItemName: string,
  shipments: ShipmentDraft[],
): boolean {
  const needle = batchItemName.trim().toLowerCase();
  if (!needle) return false;
  return shipments.some((s) =>
    s.items.some((i) => {
      const hay = i.name.trim().toLowerCase();
      return hay.includes(needle) || needle.includes(hay);
    }),
  );
}

export function ReconcileForm({ properties }: { properties: Property[] }) {
  const [extractState, extractAction] = useActionState(extractInvoice, undefined);

  if (!extractState) {
    return <UploadForm action={extractAction} />;
  }

  if (extractState.status === "error") {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-red-600" role="alert">
          {extractState.error}
        </p>
        <UploadForm action={extractAction} />
      </div>
    );
  }

  if (extractState.status === "duplicate") {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950">
        <p>
          Order #{extractState.amazonOrderNumber} already exists in the
          system — nothing was created.
        </p>
        <Link href={`/orders/${extractState.existingOrderId}`} className="underline">
          View existing order →
        </Link>
      </div>
    );
  }

  return <ReviewForm extracted={extractState} properties={properties} />;
}

function UploadForm({ action }: { action: (formData: FormData) => void }) {
  return (
    <form
      action={action}
      className="flex flex-col gap-4 rounded-lg border border-black/10 p-4 dark:border-white/10"
    >
      <label className="flex flex-col gap-1 text-sm font-medium">
        Amazon &quot;Final Details&quot; invoice PDF
        <input
          type="file"
          name="file"
          accept=".pdf"
          required
          className="h-11 rounded-md border border-black/15 px-3 py-2 text-base font-normal dark:border-white/20"
        />
      </label>
      <SubmitButton
        pendingText="Reading invoice…"
        className="h-11 rounded-md bg-black text-base font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
      >
        Upload
      </SubmitButton>
    </form>
  );
}

function ReviewForm({
  extracted,
  properties,
}: {
  extracted: Extract<ExtractState, { status: "extracted" }>;
  properties: Property[];
}) {
  const [confirmState, confirmAction] = useActionState(confirmReconciliation, undefined);

  const [propertyId, setPropertyId] = useState(extracted.matchedPropertyId ?? "");
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>(
    extracted.candidates.length === 1 ? extracted.candidates[0].orderId : "",
  );
  const [shipments, setShipments] = useState<ShipmentDraft[]>(extracted.shipments);
  const [resolvedRequestIds, setResolvedRequestIds] = useState<Set<string>>(
    new Set(),
  );

  const selectedCandidate = extracted.candidates.find(
    (c) => c.orderId === selectedCandidateId,
  );

  function selectCandidate(orderId: string) {
    setSelectedCandidateId(orderId);
    setResolvedRequestIds(new Set());
  }

  function toggleResolved(id: string) {
    setResolvedRequestIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function updateItem(
    shipmentIndex: number,
    itemIndex: number,
    patch: Partial<ShipmentDraft["items"][number]>,
  ) {
    setShipments((prev) =>
      prev.map((s, si) =>
        si !== shipmentIndex
          ? s
          : {
              ...s,
              items: s.items.map((it, ii) =>
                ii === itemIndex ? { ...it, ...patch } : it,
              ),
            },
      ),
    );
  }

  function addItem(shipmentIndex: number) {
    setShipments((prev) =>
      prev.map((s, si) =>
        si !== shipmentIndex
          ? s
          : { ...s, items: [...s.items, { name: "", expected_quantity: "1", unit_price: "" }] },
      ),
    );
  }

  function removeItem(shipmentIndex: number, itemIndex: number) {
    setShipments((prev) =>
      prev.map((s, si) =>
        si !== shipmentIndex
          ? s
          : { ...s, items: s.items.filter((_, ii) => ii !== itemIndex) },
      ),
    );
  }

  return (
    <form
      action={confirmAction}
      className="flex flex-col gap-4 rounded-lg border border-black/10 p-4 dark:border-white/10"
    >
      <input type="hidden" name="pdf_import_id" value={extracted.pdfImportId ?? ""} />
      <input
        type="hidden"
        name="existing_order_id"
        value={selectedCandidate?.orderId ?? ""}
      />
      <input
        type="hidden"
        name="request_batch_id"
        value={selectedCandidate?.batchId ?? ""}
      />
      <input type="hidden" name="shipments" value={JSON.stringify(shipments)} />
      <input
        type="hidden"
        name="resolved_request_ids"
        value={JSON.stringify([...resolvedRequestIds])}
      />

      <div className="rounded-md border border-black/10 p-3 text-sm dark:border-white/10">
        <p>
          Amazon order #{extracted.amazonOrderNumber ?? "(not found in PDF)"}
        </p>
        <p className="text-zinc-600 dark:text-zinc-400">
          PO number: {extracted.poNumber ?? "(not found in PDF)"}
        </p>
      </div>

      <label className="flex flex-col gap-1 text-sm font-medium">
        Property
        <select
          name="property_id"
          required
          value={propertyId}
          onChange={(e) => setPropertyId(e.target.value)}
          className="h-11 rounded-md border border-black/15 px-3 text-base font-normal dark:border-white/20"
        >
          <option value="" disabled>
            {extracted.matchedPropertyId
              ? "Select a property…"
              : "PO number didn't match any property — select one…"}
          </option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      {extracted.candidates.length > 0 && (
        <fieldset className="flex flex-col gap-2 rounded-md border border-black/10 p-3 dark:border-white/10">
          <legend className="text-sm font-medium">
            Which pending request does this belong to?
          </legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="candidate_picker"
              checked={selectedCandidateId === ""}
              onChange={() => selectCandidate("")}
            />
            None — standalone order, not linked to a request
          </label>
          {extracted.candidates.map((c) => (
            <label key={c.orderId} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="candidate_picker"
                checked={selectedCandidateId === c.orderId}
                onChange={() => selectCandidate(c.orderId)}
              />
              Pending order from {c.batchItems.length} requested item
              {c.batchItems.length === 1 ? "" : "s"}
            </label>
          ))}
        </fieldset>
      )}

      {selectedCandidate && selectedCandidate.batchItems.length > 0 && (
        <fieldset className="flex flex-col gap-2 rounded-md border border-black/10 p-3 dark:border-white/10">
          <legend className="text-sm font-medium">
            Which requested items does this order account for?
          </legend>
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            Checked by default when a plausible match was found in the
            invoice below — nothing is saved until you confirm. Anything
            left unchecked stays flagged as still not found (it may show up
            in a later, separate order from the same batch).
          </p>
          {selectedCandidate.batchItems.map((item) => {
            const suggested = itemLooksRequested(item.item_name, shipments);
            const checked = resolvedRequestIds.has(item.id);
            return (
              <label key={item.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleResolved(item.id)}
                  className="h-5 w-5"
                />
                {item.item_name}
                {item.quantity ? ` x${item.quantity}` : ""}
                {!checked && (
                  <span className="text-xs text-amber-700 dark:text-amber-400">
                    {suggested ? "(looks like it's below)" : "not found in this order"}
                  </span>
                )}
              </label>
            );
          })}
        </fieldset>
      )}

      <label className="flex flex-col gap-1 text-sm font-medium">
        Order number
        <input
          name="order_number"
          defaultValue={extracted.amazonOrderNumber ?? ""}
          required
          className="h-11 rounded-md border border-black/15 px-3 text-base font-normal dark:border-white/20"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm font-medium">
        Order date
        <input
          name="order_date"
          type="date"
          defaultValue={extracted.orderPlacedDate ?? ""}
          required
          className="h-11 rounded-md border border-black/15 px-3 text-base font-normal dark:border-white/20"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm font-medium">
        Total amount
        <input
          name="total_amount"
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          defaultValue={extracted.orderTotal ?? ""}
          className="h-11 rounded-md border border-black/15 px-3 text-base font-normal dark:border-white/20"
        />
      </label>

      <fieldset className="flex flex-col gap-4">
        <legend className="text-sm font-medium">
          Items (one group per shipment/package — edit as needed)
        </legend>
        {shipments.map((shipment, si) => (
          <div
            key={si}
            className="flex flex-col gap-2 rounded-md border border-black/10 p-3 dark:border-white/10"
          >
            <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Package {si + 1}
              {shipment.shipped_date ? ` — shipped ${shipment.shipped_date}` : ""}
            </p>
            {shipment.items.map((item, ii) => (
              <div key={ii} className="flex flex-col gap-2 rounded-md border border-black/10 p-2 dark:border-white/10">
                <input
                  aria-label={`Package ${si + 1} item ${ii + 1} name`}
                  placeholder="Item name"
                  required
                  value={item.name}
                  onChange={(e) => updateItem(si, ii, { name: e.target.value })}
                  className="h-11 rounded-md border border-black/15 px-3 text-base dark:border-white/20"
                />
                <div className="flex flex-wrap gap-2">
                  <input
                    aria-label={`Package ${si + 1} item ${ii + 1} quantity`}
                    type="number"
                    min="1"
                    placeholder="Qty"
                    value={item.expected_quantity}
                    onChange={(e) => updateItem(si, ii, { expected_quantity: e.target.value })}
                    className="h-11 w-20 min-w-0 rounded-md border border-black/15 px-3 text-base dark:border-white/20"
                  />
                  <input
                    aria-label={`Package ${si + 1} item ${ii + 1} unit price`}
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    placeholder="Unit price"
                    value={item.unit_price}
                    onChange={(e) => updateItem(si, ii, { unit_price: e.target.value })}
                    className="h-11 min-w-0 flex-1 rounded-md border border-black/15 px-3 text-base dark:border-white/20"
                  />
                  <button
                    type="button"
                    onClick={() => removeItem(si, ii)}
                    disabled={shipment.items.length === 1}
                    className="h-11 shrink-0 rounded-md border border-black/15 px-3 text-sm font-medium disabled:opacity-40 dark:border-white/20"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={() => addItem(si)}
              className="h-11 rounded-md border border-black/15 text-sm font-medium dark:border-white/20"
            >
              Add item to this package
            </button>
          </div>
        ))}
      </fieldset>

      {confirmState?.error && (
        <p className="text-sm text-red-600" role="alert">
          {confirmState.error}
        </p>
      )}

      <SubmitButton
        pendingText="Saving…"
        className="h-11 rounded-md bg-black text-base font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
      >
        Confirm & save
      </SubmitButton>
    </form>
  );
}
