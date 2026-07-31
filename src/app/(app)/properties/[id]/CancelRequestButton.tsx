"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
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
  const router = useRouter();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => {
        if (!window.confirm(`Remove the request for "${itemName}"?`)) return;
        startTransition(async () => {
          await cancelSupplyRequest(requestId, propertyId);
          // revalidatePath alone doesn't reliably repaint the shared nav
          // layout (the badge count) from a plain button-triggered action
          // like this one, as opposed to a <form action> - router.refresh()
          // is the explicit, guaranteed way to pick up the now-revalidated
          // server data.
          router.refresh();
        });
      }}
      className="text-sm font-medium text-red-600 underline disabled:opacity-40"
    >
      Remove
    </button>
  );
}
