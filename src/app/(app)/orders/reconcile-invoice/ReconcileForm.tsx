"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import {
  extractInvoices,
  confirmReconciliation,
  type ExtractState,
  type FileExtractResult,
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
  // Bumping this key forces a full remount of ReconcileFlow below, which
  // resets its useActionState back to undefined - the "start over" escape
  // hatch for when a PDF was misread and nothing here is salvageable.
  const [resetKey, setResetKey] = useState(0);
  return (
    <ReconcileFlow
      key={resetKey}
      properties={properties}
      onStartOver={() => setResetKey((k) => k + 1)}
    />
  );
}

function ReconcileFlow({
  properties,
  onStartOver,
}: {
  properties: Property[];
  onStartOver: () => void;
}) {
  const [extractState, extractAction] = useActionState(extractInvoices, undefined);
  // Tracks placeholder order ids consumed by a successful save *within this
  // same multi-file batch* - two files can independently match the same
  // single pending placeholder (PO number is property-level, not per-file),
  // so once one card consumes it, the others need to stop offering it.
  const [consumedOrderIds, setConsumedOrderIds] = useState<Set<string>>(new Set());

  if (!extractState) {
    return <UploadForm action={extractAction} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <button
        type="button"
        onClick={onStartOver}
        className="h-11 self-start rounded-md border border-black/15 px-4 text-sm font-medium dark:border-white/20"
      >
        Upload different invoice(s)
      </button>

      {extractState.files.map((file, index) => (
        <FileReviewCard
          key={index}
          file={file}
          properties={properties}
          consumedOrderIds={consumedOrderIds}
          onSaved={(orderId) =>
            setConsumedOrderIds((prev) => new Set(prev).add(orderId))
          }
        />
      ))}
    </div>
  );
}

function UploadForm({ action }: { action: (formData: FormData) => void }) {
  return (
    <form
      action={action}
      className="flex flex-col gap-4 rounded-lg border border-black/10 p-4 dark:border-white/10"
    >
      <label className="flex flex-col gap-1 text-sm font-medium">
        Amazon &quot;Final Details&quot; invoice PDF(s)
        <input
          type="file"
          name="files"
          accept=".pdf"
          multiple
          required
          className="h-11 rounded-md border border-black/15 px-3 py-2 text-base font-normal dark:border-white/20"
        />
      </label>
      <p className="text-xs text-zinc-600 dark:text-zinc-400">
        Select more than one at once when the same purchase was split into
        several Amazon order numbers - each is reviewed independently below.
      </p>
      <SubmitButton
        pendingText="Reading invoice(s)…"
        className="h-11 rounded-md bg-black text-base font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
      >
        Upload
      </SubmitButton>
    </form>
  );
}

function FileReviewCard({
  file,
  properties,
  consumedOrderIds,
  onSaved,
}: {
  file: FileExtractResult;
  properties: Property[];
  consumedOrderIds: Set<string>;
  onSaved: (orderId: string) => void;
}) {
  const [discarded, setDiscarded] = useState(false);

  if (discarded) {
    return (
      <p className="rounded-md border border-black/10 p-3 text-sm text-zinc-500 dark:border-white/10">
        Discarded — {file.filename || "(unnamed file)"}
      </p>
    );
  }

  if (file.status === "error") {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-red-300 bg-red-50 p-4 text-sm dark:border-red-800 dark:bg-red-950">
        <p className="font-medium">{file.filename}</p>
        <p role="alert">{file.error}</p>
        <button
          type="button"
          onClick={() => setDiscarded(true)}
          className="self-start text-sm font-medium underline"
        >
          Dismiss
        </button>
      </div>
    );
  }

  if (file.status === "duplicate") {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950">
        <p className="font-medium">{file.filename}</p>
        <p>
          Order #{file.amazonOrderNumber} already exists in the system —
          nothing was created.
        </p>
        <Link href={`/orders/${file.existingOrderId}`} className="underline">
          View existing order →
        </Link>
      </div>
    );
  }

  return (
    <ReviewForm
      extracted={file}
      properties={properties}
      consumedOrderIds={consumedOrderIds}
      onSaved={onSaved}
      onDiscard={() => setDiscarded(true)}
    />
  );
}

function ReviewForm({
  extracted,
  properties,
  consumedOrderIds,
  onSaved,
  onDiscard,
}: {
  extracted: Extract<FileExtractResult, { status: "extracted" }>;
  properties: Property[];
  consumedOrderIds: Set<string>;
  onSaved: (orderId: string) => void;
  onDiscard: () => void;
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

  // If another card in this same upload already consumed the placeholder
  // this card had selected (or auto-selected), fall back to "standalone" -
  // never let two cards silently point at and overwrite the same order.
  const effectiveCandidateId = consumedOrderIds.has(selectedCandidateId)
    ? ""
    : selectedCandidateId;
  const availableCandidates = extracted.candidates.filter(
    (c) => !consumedOrderIds.has(c.orderId) || c.orderId === effectiveCandidateId,
  );
  const selectedCandidate = availableCandidates.find(
    (c) => c.orderId === effectiveCandidateId,
  );

  if (confirmState?.success) {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-green-300 bg-green-50 p-4 text-sm dark:border-green-800 dark:bg-green-950">
        <p className="font-medium">{extracted.filename} saved.</p>
        <Link href={`/orders/${confirmState.orderId}`} className="underline">
          View order →
        </Link>
      </div>
    );
  }

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
      onSubmit={() => {
        // Optimistically mark the placeholder consumed the moment this
        // card submits, not after the round trip - a second card's render
        // in between shouldn't get a window to also offer it.
        if (effectiveCandidateId) onSaved(effectiveCandidateId);
      }}
      className="flex flex-col gap-4 rounded-lg border border-black/10 p-4 dark:border-white/10"
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{extracted.filename}</p>
        <button
          type="button"
          onClick={onDiscard}
          className="text-sm font-medium text-red-600 underline"
        >
          Discard
        </button>
      </div>

      <input type="hidden" name="pdf_import_id" value={extracted.pdfImportId ?? ""} />
      <input type="hidden" name="existing_order_id" value={selectedCandidate?.orderId ?? ""} />
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

      {availableCandidates.length > 0 && (
        <fieldset className="flex flex-col gap-2 rounded-md border border-black/10 p-3 dark:border-white/10">
          <legend className="text-sm font-medium">
            Which pending request does this belong to?
          </legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="candidate_picker"
              checked={effectiveCandidateId === ""}
              onChange={() => selectCandidate("")}
            />
            None — standalone order, not linked to a request
          </label>
          {availableCandidates.map((c) => (
            <label key={c.orderId} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="candidate_picker"
                checked={effectiveCandidateId === c.orderId}
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

      {confirmState && !confirmState.success && (
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
