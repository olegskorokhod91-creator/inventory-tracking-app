"use client";

import { useTransition } from "react";
import { setItemRefunded } from "../actions";

export function RefundToggle({
  itemId,
  refunded,
}: {
  itemId: string;
  refunded: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
      <input
        type="checkbox"
        defaultChecked={refunded}
        disabled={isPending}
        onChange={(e) => {
          const next = e.target.checked;
          startTransition(async () => {
            await setItemRefunded(itemId, next);
          });
        }}
        className="h-4 w-4"
      />
      Refunded
    </label>
  );
}
