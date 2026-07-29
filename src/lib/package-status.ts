// Active-order sub-label (plan doc Section 6): derived from the
// least-resolved package, purely for display - never stored, same
// "derived, not a column" principle as orders_with_status.computed_status.
// Only ever called for orders already known to be 'active', which
// orders_with_status guarantees have at least one package outside
// cancelled/confirmed_received - those two are excluded from consideration
// here for the same reason they're excluded from the active/completed
// rollup itself.
export function deriveActiveSubLabel(packages: { status: string }[]): string {
  const unresolved = packages.filter(
    (p) => p.status !== "cancelled" && p.status !== "confirmed_received",
  );

  // requires_attention wasn't reachable when this function was first
  // written (M4) - a cleaner's confirmation (M5) is what actually produces
  // it now. Takes priority over the shipping-lifecycle labels below: a
  // package a cleaner has already flagged is more actionable than one
  // that's merely delayed in transit. "Attention needed" rather than
  // "Needs review" deliberately - the latter is already this page's
  // property-assignment review section heading, a same-page text collision.
  if (unresolved.some((p) => p.status === "requires_attention")) return "Attention needed";
  if (unresolved.some((p) => p.status === "delayed")) return "Delayed";
  if (unresolved.some((p) => p.status === "delivered")) return "Waiting on cleaner";
  if (unresolved.some((p) => p.status === "shipped" || p.status === "out_for_delivery")) {
    return "In transit";
  }
  return "Awaiting shipment";
}
