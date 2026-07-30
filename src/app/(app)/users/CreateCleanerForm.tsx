"use client";

import { useActionState } from "react";
import { createCleanerAccount } from "./actions";

export function CreateCleanerForm() {
  const [state, formAction, pending] = useActionState(
    createCleanerAccount,
    undefined,
  );

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 rounded-lg border border-black/10 p-4 dark:border-white/10"
    >
      <h2 className="text-lg font-medium">Add cleaner</h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Creates a login directly — no email is sent. Give the cleaner their
        email and password yourself.
      </p>

      <label className="flex flex-col gap-1 text-sm font-medium">
        Name
        <input
          name="name"
          required
          className="h-11 rounded-md border border-black/15 px-3 text-base font-normal dark:border-white/20"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm font-medium">
        Email
        <input
          name="email"
          type="email"
          required
          className="h-11 rounded-md border border-black/15 px-3 text-base font-normal dark:border-white/20"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm font-medium">
        Temporary password
        {/* Plain text, not masked - the admin is choosing/typing this
            password themselves to relay to the cleaner afterward, so
            being able to read it back while typing matters more here
            than hiding it would. */}
        <input
          name="password"
          type="text"
          required
          minLength={6}
          autoComplete="off"
          className="h-11 rounded-md border border-black/15 px-3 text-base font-normal dark:border-white/20"
        />
      </label>

      {state?.error && (
        <p className="text-sm text-red-600" role="alert">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="h-11 rounded-md bg-black text-base font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
      >
        {pending ? "Creating…" : "Add cleaner"}
      </button>
    </form>
  );
}
