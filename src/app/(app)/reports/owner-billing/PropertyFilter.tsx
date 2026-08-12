"use client";

import { useState } from "react";

type Property = { id: string; name: string };

// Search narrows which checkboxes are *visible*, not which exist - every
// checkbox stays mounted (just hidden) so a property checked before typing
// a search term stays checked and still submits with the form, even once
// it's scrolled out of view by the filter.
export function PropertyFilter({
  properties,
  checkedIds,
}: {
  properties: Property[];
  checkedIds: string[];
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();

  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-sm font-medium">
        Properties (none checked means all)
      </legend>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search properties…"
        className="h-11 rounded-md border border-black/15 px-3 text-base font-normal dark:border-white/20"
      />
      <div className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-md border border-black/15 p-2 dark:border-white/20">
        {properties.map((p) => {
          const matches = !normalizedQuery || p.name.toLowerCase().includes(normalizedQuery);
          return (
            <label
              key={p.id}
              className={`flex items-center gap-2 py-0.5 text-sm ${matches ? "" : "hidden"}`}
            >
              <input
                type="checkbox"
                name="property_id"
                value={p.id}
                defaultChecked={checkedIds.includes(p.id)}
                className="h-4 w-4 shrink-0"
              />
              {p.name}
            </label>
          );
        })}
        {normalizedQuery &&
          !properties.some((p) => p.name.toLowerCase().includes(normalizedQuery)) && (
            <p className="py-1 text-sm text-zinc-500 dark:text-zinc-400">
              No properties match &quot;{query}&quot;.
            </p>
          )}
      </div>
    </fieldset>
  );
}
