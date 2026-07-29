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

  if (unresolved.some((p) => p.status === "delayed")) return "Delayed";
  if (unresolved.some((p) => p.status === "delivered")) return "Waiting on cleaner";
  if (unresolved.some((p) => p.status === "shipped" || p.status === "out_for_delivery")) {
    return "In transit";
  }
  return "Awaiting shipment";
}
