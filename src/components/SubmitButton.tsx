"use client";

import { useFormStatus } from "react-dom";

// useFormStatus only reads the nearest *ancestor* form's pending state, so
// this has to be its own component rendered inside a <form> - it can't be
// inlined into the component that renders the <form> itself. Swapped in for
// every plain server-action submit button in the app (M8) - previously none
// of them showed any feedback while the round trip was in flight, which
// read as "did my tap even register" on a real mobile connection.
export function SubmitButton({
  children,
  pendingText,
  className,
}: {
  children: React.ReactNode;
  pendingText?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? (pendingText ?? "Saving…") : children}
    </button>
  );
}
