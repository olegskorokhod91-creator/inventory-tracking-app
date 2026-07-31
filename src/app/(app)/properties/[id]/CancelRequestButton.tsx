"use client";

import { useTransition } from "react";
import { cancelSupplyRequest } from "../actions";

export function CancelRequestButton({
  requestId,
  propertyId,
  itemName,
}: {
  requestId: string;
  propertyId: string;
  itemName: string;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => {
        if (!window.confirm(`Remove the request for "${itemName}"?`)) return;
        startTransition(async () => {
          await cancelSupplyRequest(requestId, propertyId);
        });
      }}
      className="text-sm font-medium text-red-600 underline disabled:opacity-40"
    >
      Remove
    </button>
  );
}
