"use client";

import { useState, useTransition } from "react";
import { setItemPrice } from "../actions";

export function PriceEditor({
  itemId,
  unitPrice,
}: {
  itemId: string;
  unitPrice: number | null;
}) {
  const [value, setValue] = useState(unitPrice != null ? String(unitPrice) : "");
  const [isPending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      await setItemPrice(itemId, value);
    });
  }

  return (
    <span className="flex items-center gap-1 text-sm text-zinc-600 dark:text-zinc-400">
      $
      <input
        type="number"
        min="0"
        step="0.01"
        inputMode="decimal"
        placeholder="0.00"
        aria-label="Unit price"
        value={value}
        disabled={isPending}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          if (value !== (unitPrice != null ? String(unitPrice) : "")) save();
        }}
        className="h-8 w-20 rounded-md border border-black/15 px-2 text-sm dark:border-white/20"
      />
    </span>
  );
}
