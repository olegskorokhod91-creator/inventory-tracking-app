"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteOrder } from "../actions";

export function DeleteOrderButton({ orderId }: { orderId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (!window.confirm("Delete this order? It has no items left. This can't be undone.")) {
            return;
          }
          startTransition(async () => {
            const result = await deleteOrder(orderId);
            if (!result.success) {
              setError(result.error ?? "Failed to delete order.");
              return;
            }
            router.push("/orders");
          });
        }}
        className="h-11 self-start rounded-md border border-red-300 px-4 text-sm font-medium text-red-600 disabled:opacity-40 dark:border-red-800"
      >
        Delete order
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
