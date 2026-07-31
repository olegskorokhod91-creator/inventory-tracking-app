"use client";

import { useState } from "react";

// po_number mirrors address as it's typed - convenience default, since your
// samples confirm the address is literally what gets entered at Amazon
// checkout - but stops mirroring the moment the admin edits it directly, so
// it stays a real editable field rather than a derived/locked one (an
// address can have formatting Amazon's PO field doesn't take cleanly).
export function AddressAndPoFields({
  initialAddress = "",
  initialPoNumber = "",
}: {
  initialAddress?: string;
  initialPoNumber?: string;
}) {
  const [poNumber, setPoNumber] = useState(initialPoNumber || initialAddress);
  const [poTouched, setPoTouched] = useState(initialPoNumber.length > 0);

  return (
    <>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Address
        <input
          name="address"
          placeholder="Address"
          defaultValue={initialAddress}
          required
          onChange={(e) => {
            if (!poTouched) setPoNumber(e.target.value);
          }}
          className="h-11 rounded-md border border-black/15 px-3 text-base font-normal dark:border-white/20"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        PO number (Amazon checkout)
        <input
          name="po_number"
          value={poNumber}
          onChange={(e) => {
            setPoTouched(true);
            setPoNumber(e.target.value);
          }}
          className="h-11 rounded-md border border-black/15 px-3 text-base font-normal dark:border-white/20"
        />
      </label>
    </>
  );
}
