"use client";

import { useState } from "react";
import { createOrder } from "../actions";

type Item = { name: string; expected_quantity: string; unit_price: string };

const emptyItem: Item = { name: "", expected_quantity: "1", unit_price: "" };

export function OrderForm({
  retailers,
  properties,
}: {
  retailers: { id: string; name: string }[];
  properties: { id: string; name: string }[];
}) {
  const [items, setItems] = useState<Item[]>([{ ...emptyItem }]);
  const today = new Date().toISOString().slice(0, 10);

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

  return (
    <form
      action={createOrder}
      className="flex flex-col gap-4 rounded-lg border border-black/10 p-4 dark:border-white/10"
    >
      <input type="hidden" name="items" value={JSON.stringify(items)} />

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
          defaultValue=""
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

      <button
        type="submit"
        className="h-11 rounded-md bg-black text-base font-medium text-white dark:bg-white dark:text-black"
      >
        Create order
      </button>
    </form>
  );
}
