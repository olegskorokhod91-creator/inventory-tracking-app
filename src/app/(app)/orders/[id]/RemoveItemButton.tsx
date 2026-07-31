"use client";

import { useState, useTransition } from "react";
import { deleteOrderItem } from "../actions";

export function RemoveItemButton({
  itemId,
  itemName,
}: {
  itemId: string;
  itemName: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (!window.confirm(`Remove "${itemName}" from this order? This can't be undone.`)) {
            return;
          }
          startTransition(async () => {
            const result = await deleteOrderItem(itemId);
            setError(result.success ? null : (result.error ?? "Failed to remove item."));
          });
        }}
        className="text-sm font-medium text-red-600 underline disabled:opacity-40"
      >
        Remove
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
