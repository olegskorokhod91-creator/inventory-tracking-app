"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmPackageDelivery } from "../actions";

type Item = { orderItemId: string; name: string; expectedQuantity: number };

const PROBLEM_OUTCOMES = [
  { value: "package_not_found", label: "Package not found" },
  { value: "items_missing", label: "Some items missing" },
  { value: "incorrect_quantity", label: "Incorrect quantity" },
  { value: "wrong_item", label: "Wrong item received" },
  { value: "damaged", label: "Damaged items" },
  { value: "received_not_put_away", label: "Received, not put away yet" },
] as const;

export function ConfirmationForm({
  packageId,
  items,
}: {
  packageId: string;
  items: Item[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<string | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>(
    Object.fromEntries(items.map((i) => [i.orderItemId, i.expectedQuantity])),
  );
  const [itemNotes, setItemNotes] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  function adjust(itemId: string, delta: number) {
    setQuantities((prev) => ({
      ...prev,
      [itemId]: Math.max(0, (prev[itemId] ?? 0) + delta),
    }));
  }

  function submit(finalOutcome: string) {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("outcome", finalOutcome);
      formData.set("note", note);
      if (photo) formData.set("photo", photo);

      const itemsPayload =
        finalOutcome === "package_not_found"
          ? items.map((i) => ({ order_item_id: i.orderItemId, actual_quantity: 0, item_note: null }))
          : items.map((i) => ({
              order_item_id: i.orderItemId,
              actual_quantity:
                finalOutcome === "all_correct"
                  ? i.expectedQuantity
                  : (quantities[i.orderItemId] ?? i.expectedQuantity),
              item_note: itemNotes[i.orderItemId] || null,
            }));
      formData.set("items", JSON.stringify(itemsPayload));

      const result = await confirmPackageDelivery(packageId, formData);
      if (result?.error) {
        setError(result.error);
        return;
      }
      router.push("/confirmations");
    });
  }

  if (!outcome) {
    return (
      <div className="flex flex-col gap-4">
        {items.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-medium">Expected items</h2>
            <ul className="flex flex-col gap-2">
              {items.map((item) => (
                <li
                  key={item.orderItemId}
                  className="flex items-center justify-between rounded-md border border-black/10 px-3 py-2 dark:border-white/10"
                >
                  <span>{item.name}</span>
                  <span className="text-sm text-zinc-600 dark:text-zinc-400">
                    x{item.expectedQuantity}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            No items itemized for this specific package yet — confirm the package
            itself below.
          </p>
        )}

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">What&apos;s the situation?</h2>
          <button
            type="button"
            disabled={isPending}
            onClick={() => submit("all_correct")}
            className="h-14 rounded-lg bg-green-600 text-lg font-semibold text-white disabled:opacity-50"
          >
            Everything received correctly
          </button>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {PROBLEM_OUTCOMES.map((o) => (
              <button
                key={o.value}
                type="button"
                disabled={isPending}
                onClick={() => setOutcome(o.value)}
                className="h-14 rounded-lg border border-black/15 px-3 text-base font-medium disabled:opacity-50 dark:border-white/20"
              >
                {o.label}
              </button>
            ))}
          </div>
        </section>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  const outcomeLabel = PROBLEM_OUTCOMES.find((o) => o.value === outcome)?.label ?? outcome;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">{outcomeLabel}</h2>
        <button
          type="button"
          disabled={isPending}
          onClick={() => setOutcome(null)}
          className="text-sm font-medium underline disabled:opacity-50"
        >
          Change
        </button>
      </div>

      {outcome !== "package_not_found" && items.length > 0 && (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li
              key={item.orderItemId}
              className="flex flex-col gap-3 rounded-md border border-black/10 p-3 dark:border-white/10"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{item.name}</span>
                <span className="text-sm text-zinc-600 dark:text-zinc-400">
                  expected x{item.expectedQuantity}
                </span>
              </div>
              <div className="flex items-center justify-center gap-4">
                <button
                  type="button"
                  onClick={() => adjust(item.orderItemId, -1)}
                  aria-label={`Decrease ${item.name} quantity`}
                  className="h-12 w-12 shrink-0 rounded-full border border-black/15 text-xl font-semibold dark:border-white/20"
                >
                  −
                </button>
                <span className="w-10 text-center text-xl font-semibold">
                  {quantities[item.orderItemId]}
                </span>
                <button
                  type="button"
                  onClick={() => adjust(item.orderItemId, 1)}
                  aria-label={`Increase ${item.name} quantity`}
                  className="h-12 w-12 shrink-0 rounded-full border border-black/15 text-xl font-semibold dark:border-white/20"
                >
                  +
                </button>
              </div>
              <input
                aria-label={`Note for ${item.name}`}
                placeholder="Note for this item (optional)"
                value={itemNotes[item.orderItemId] ?? ""}
                onChange={(e) =>
                  setItemNotes((prev) => ({ ...prev, [item.orderItemId]: e.target.value }))
                }
                className="h-11 rounded-md border border-black/15 px-3 text-base dark:border-white/20"
              />
            </li>
          ))}
        </ul>
      )}

      <label className="flex flex-col gap-1 text-sm font-medium">
        Note (optional)
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          className="rounded-md border border-black/15 px-3 py-2 text-base font-normal dark:border-white/20"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm font-medium">
        Photo (optional)
        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
          className="text-base"
        />
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="button"
        disabled={isPending}
        onClick={() => submit(outcome)}
        className="h-11 rounded-md bg-black text-base font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
      >
        Submit
      </button>
    </div>
  );
}
