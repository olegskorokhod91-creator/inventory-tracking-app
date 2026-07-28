"use client";

import { useActionState } from "react";
import Link from "next/link";
import { importCsv } from "./actions";

export function ImportCsvForm() {
  const [state, formAction, pending] = useActionState(importCsv, undefined);

  return (
    <form
      action={formAction}
      className="flex flex-col gap-4 rounded-lg border border-black/10 p-4 dark:border-white/10"
    >
      <label className="flex flex-col gap-1 text-sm font-medium">
        Amazon Business &quot;Orders&quot; report (CSV)
        <input
          type="file"
          name="file"
          accept=".csv"
          required
          className="h-11 rounded-md border border-black/15 px-3 py-2 text-base font-normal dark:border-white/20"
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        className="h-11 rounded-md bg-black text-base font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
      >
        {pending ? "Importing…" : "Import"}
      </button>

      {state?.success === false && (
        <p className="text-sm text-red-600" role="alert">
          {state.error}
        </p>
      )}

      {state?.success === true && (
        <div className="flex flex-col gap-2 rounded-md border border-black/10 p-3 text-sm dark:border-white/10">
          <p>
            Processed {state.totalOrders} order
            {state.totalOrders === 1 ? "" : "s"}: {state.created} created,{" "}
            {state.updated} updated.
          </p>
          <Link href="/orders" className="underline">
            View orders →
          </Link>
        </div>
      )}
    </form>
  );
}
