"use client";

import { useState } from "react";
import { createOrder } from "../actions";
import { SubmitButton } from "@/components/SubmitButton";

type Item = { name: string; expected_quantity: string; unit_price: string };
type OpenRequest = {
  id: string;
  property_id: string;
  item_name: string;
  quantity: number | null;
  note: string | null;
};

const emptyItem: Item = { name: "", expected_quantity: "1", unit_price: "" };

export function OrderForm({
  retailers,
  properties,
  openRequests,
}: {
  retailers: { id: string; name: string }[];
  properties: { id: string; name: string }[];
  openRequests: OpenRequest[];
}) {
  const [items, setItems] = useState<Item[]>([{ ...emptyItem }]);
  const [propertyId, setPropertyId] = useState("");
  const [resolvedRequestIds, setResolvedRequestIds] = useState<Set<string>>(
    new Set(),
  );
  const today = new Date().toISOString().slice(0, 10);

  const requestsForProperty = openRequests.filter(
    (r) => r.property_id === propertyId,
  );

  function updateItem(index: number, patch: Partial<Item>) {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  }

  function addItem() {
    setItems((prev) => [...prev, { ...emptyItem }]);
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  function toggleRequest(id: string) {
    setResolvedRequestIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <form
      action={createOrder}
      className="flex flex-col gap-4 rounded-lg border border-black/10 p-4 dark:border-white/10"
    >
      <input type="hidden" name="items" value={JSON.stringify(items)} />
      <input
        type="hidden"
        name="resolved_request_ids"
        value={JSON.stringify([...resolvedRequestIds])}
      />

      <label className="flex flex-col gap-1 text-sm font-medium">
        Retailer
        <select
          name="retailer_id"
          required
          defaultValue=""
          className="h-11 rounded-md border border-black/15 px-3 text-base font-normal dark:border-white/20"
        >
          <option value="" disabled>
            Select a retailer…
          </option>
          {retailers.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm font-medium">
        Property
        <select
          name="property_id"
          required
          value={propertyId}
          onChange={(e) => {
            setPropertyId(e.target.value);
            setResolvedRequestIds(new Set());
          }}
          className="h-11 rounded-md border border-black/15 px-3 text-base font-normal dark:border-white/20"
        >
          <option value="" disabled>
            Select a property…
          </option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      {propertyId && requestsForProperty.length > 0 && (
        <fieldset className="flex flex-col gap-2 rounded-md border border-black/10 p-3 dark:border-white/10">
          <legend className="text-sm font-medium">
            Open requests for this property
          </legend>
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            Check off anything this order resolves — nothing is matched
            automatically.
          </p>
          {requestsForProperty.map((r) => (
            <label
              key={r.id}
              className="flex items-center gap-2 text-sm"
            >
              <input
                type="checkbox"
                checked={resolvedRequestIds.has(r.id)}
                onChange={() => toggleRequest(r.id)}
                className="h-5 w-5"
              />
              {r.item_name}
              {r.quantity ? ` x${r.quantity}` : ""}
              {r.note ? ` — ${r.note}` : ""}
            </label>
          ))}
        </fieldset>
      )}

      <label className="flex flex-col gap-1 text-sm font-medium">
        Order number (optional)
        <input
          name="order_number"
          className="h-11 rounded-md border border-black/15 px-3 text-base font-normal dark:border-white/20"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm font-medium">
        Order date
        <input
          name="order_date"
          type="date"
          required
          defaultValue={today}
          className="h-11 rounded-md border border-black/15 px-3 text-base font-normal dark:border-white/20"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm font-medium">
        Total amount (optional)
        <input
          name="total_amount"
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          className="h-11 rounded-md border border-black/15 px-3 text-base font-normal dark:border-white/20"
        />
      </label>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium">Items</legend>

        {items.map((item, index) => (
          <div
            key={index}
            className="flex flex-col gap-2 rounded-md border border-black/10 p-3 dark:border-white/10"
          >
            <input
              aria-label={`Item ${index + 1} name`}
              placeholder="Item name"
              required
              value={item.name}
              onChange={(e) => updateItem(index, { name: e.target.value })}
              className="h-11 rounded-md border border-black/15 px-3 text-base dark:border-white/20"
            />
            <div className="flex flex-wrap gap-2">
              <input
                aria-label={`Item ${index + 1} quantity`}
                type="number"
                min="1"
                placeholder="Qty"
                value={item.expected_quantity}
                onChange={(e) =>
                  updateItem(index, { expected_quantity: e.target.value })
                }
                className="h-11 w-20 min-w-0 rounded-md border border-black/15 px-3 text-base dark:border-white/20"
              />
              <input
                aria-label={`Item ${index + 1} unit price`}
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                placeholder="Unit price"
                value={item.unit_price}
                onChange={(e) =>
                  updateItem(index, { unit_price: e.target.value })
                }
                className="h-11 min-w-0 flex-1 rounded-md border border-black/15 px-3 text-base dark:border-white/20"
              />
              <button
                type="button"
                onClick={() => removeItem(index)}
                disabled={items.length === 1}
                className="h-11 shrink-0 rounded-md border border-black/15 px-3 text-sm font-medium disabled:opacity-40 dark:border-white/20"
              >
                Remove
              </button>
            </div>
          </div>
        ))}

        <button
          type="button"
          onClick={addItem}
          className="h-11 rounded-md border border-black/15 text-sm font-medium dark:border-white/20"
        >
          Add item
        </button>
      </fieldset>

      <SubmitButton
        pendingText="Creating…"
        className="h-11 rounded-md bg-black text-base font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
      >
        Create order
      </SubmitButton>
    </form>
  );
}
