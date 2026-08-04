"use client";

import { useActionState, useRef, useState } from "react";
import { createSupplyRequests, type SupplyRequestFormState } from "../actions";

type DraftItem = { item_name: string; quantity: string; note: string };

type OtherProperty = { id: string; name: string };

export function SupplyRequestForm({
  propertyId,
  existingItemNames,
  otherProperties = [],
}: {
  propertyId: string;
  existingItemNames: string[];
  otherProperties?: OtherProperty[];
}) {
  const [state, formAction, pending] = useActionState(
    createSupplyRequests.bind(null, propertyId),
    undefined,
  );
  const [items, setItems] = useState<DraftItem[]>([]);
  const [nameInput, setNameInput] = useState("");
  const [quantityInput, setQuantityInput] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [extraPropertyIds, setExtraPropertyIds] = useState<Set<string>>(new Set());

  const nameInputRef = useRef<HTMLInputElement>(null);
  const quantityInputRef = useRef<HTMLInputElement>(null);

  // Plain server-action forms don't navigate away on success, so this
  // client component would otherwise stay mounted with its old draft still
  // in place - risking an accidental double-submit of the same items.
  // Resetting during render (guarded by a prev-value ref) rather than in a
  // useEffect, per React's guidance against setState-in-effect.
  const [prevState, setPrevState] = useState<SupplyRequestFormState>(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state?.success) {
      setItems([]);
      setNameInput("");
      setQuantityInput("");
      setExtraPropertyIds(new Set());
    }
  }

  function toggleExtraProperty(id: string) {
    setExtraPropertyIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const suggestions =
    nameInput.trim().length > 0
      ? existingItemNames
          .filter((n) => n.toLowerCase().includes(nameInput.trim().toLowerCase()))
          .slice(0, 8)
      : [];

  function commitItem() {
    if (!nameInput.trim()) return;
    setItems((prev) => [
      ...prev,
      { item_name: nameInput.trim(), quantity: quantityInput, note: "" },
    ]);
    setNameInput("");
    setQuantityInput("");
    setShowSuggestions(false);
    nameInputRef.current?.focus();
  }

  function pickSuggestion(name: string) {
    setNameInput(name);
    setShowSuggestions(false);
    quantityInputRef.current?.focus();
  }

  function updateNote(index: number, note: string) {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, note } : item)),
    );
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  // Include whatever's still sitting in the entry inputs (typed but never
  // Enter-committed) so a forgotten Enter press doesn't lose an item.
  const allItems = nameInput.trim()
    ? [...items, { item_name: nameInput.trim(), quantity: quantityInput, note: "" }]
    : items;

  return (
    <form
      action={formAction}
      className="flex flex-col gap-4 rounded-lg border border-black/10 p-4 dark:border-white/10"
    >
      <input type="hidden" name="items" value={JSON.stringify(allItems)} />
      <input
        type="hidden"
        name="extra_property_ids"
        value={JSON.stringify([...extraPropertyIds])}
      />

      <h2 className="text-lg font-medium">Request supplies</h2>

      <div className="relative flex flex-col gap-1">
        <label htmlFor="item-name-input" className="text-sm font-medium">
          Item name
        </label>
        <input
          id="item-name-input"
          ref={nameInputRef}
          value={nameInput}
          onChange={(e) => {
            setNameInput(e.target.value);
            setShowSuggestions(true);
          }}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && nameInput.trim()) {
              e.preventDefault();
              setShowSuggestions(false);
              quantityInputRef.current?.focus();
            }
          }}
          placeholder="e.g. Paper towels"
          className="h-11 rounded-md border border-black/15 px-3 text-base dark:border-white/20"
        />
        {showSuggestions && suggestions.length > 0 && (
          <ul className="absolute top-full z-10 mt-1 w-full rounded-md border border-black/15 bg-white shadow-md dark:border-white/20 dark:bg-zinc-900">
            {suggestions.map((name) => (
              <li key={name}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pickSuggestion(name)}
                  className="block w-full px-3 py-2 text-left text-base hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  {name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="item-quantity-input" className="text-sm font-medium">
          Quantity (optional)
        </label>
        <input
          id="item-quantity-input"
          ref={quantityInputRef}
          type="number"
          min="1"
          value={quantityInput}
          onChange={(e) => setQuantityInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitItem();
            }
          }}
          className="h-11 w-24 rounded-md border border-black/15 px-3 text-base dark:border-white/20"
        />
      </div>

      {items.length > 0 && (
        <ul className="flex flex-col gap-2">
          {items.map((item, index) => (
            <li
              key={index}
              className="flex flex-wrap items-center gap-2 rounded-md border border-black/10 p-2 dark:border-white/10"
            >
              <span className="font-medium">
                {item.item_name}
                {item.quantity ? ` x${item.quantity}` : ""}
              </span>
              <input
                aria-label={`Note for ${item.item_name}`}
                placeholder="Note (optional)"
                value={item.note}
                onChange={(e) => updateNote(index, e.target.value)}
                className="h-9 min-w-0 flex-1 rounded-md border border-black/15 px-2 text-sm dark:border-white/20"
              />
              <button
                type="button"
                onClick={() => removeItem(index)}
                className="text-sm font-medium text-red-600 underline"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {otherProperties.length > 0 && (
        <fieldset className="flex flex-col gap-2 rounded-md border border-black/10 p-3 dark:border-white/10">
          <div className="flex items-center justify-between">
            <legend className="text-sm font-medium">
              Also request everything above for
            </legend>
            <button
              type="button"
              onClick={() =>
                setExtraPropertyIds((prev) =>
                  prev.size === otherProperties.length
                    ? new Set()
                    : new Set(otherProperties.map((p) => p.id)),
                )
              }
              className="text-xs font-medium underline"
            >
              {extraPropertyIds.size === otherProperties.length ? "Clear all" : "Select all"}
            </button>
          </div>
          {otherProperties.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={extraPropertyIds.has(p.id)}
                onChange={() => toggleExtraProperty(p.id)}
                className="h-5 w-5"
              />
              {p.name}
            </label>
          ))}
        </fieldset>
      )}

      <button
        type="submit"
        disabled={allItems.length === 0 || pending}
        className="h-11 rounded-md bg-black text-base font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black"
      >
        {pending ? "Submitting…" : "Submit request"}
      </button>
    </form>
  );
}
