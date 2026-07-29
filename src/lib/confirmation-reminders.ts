// M7: the whole reminder is this one threshold, deliberately not a
// configurable rules engine - a package sitting in 'delivered' status (set
// by the retailer/carrier email pipeline or an admin manual override, see
// packages.delivered_at) for more than this long without a cleaner
// confirmation is worth flagging for someone to go check in person. It's a
// prompt, not a status change - the package only ever becomes
// confirmed_received through the M5 confirmation flow.
export const OVERDUE_HOURS = 24;

export function overdueCutoffIso(now: Date = new Date()): string {
  return new Date(now.getTime() - OVERDUE_HOURS * 60 * 60 * 1000).toISOString();
}

export function isOverdue(deliveredAt: string, now: Date = new Date()): boolean {
  return new Date(deliveredAt).getTime() < now.getTime() - OVERDUE_HOURS * 60 * 60 * 1000;
}

export function formatElapsed(deliveredAt: string, now: Date = new Date()): string {
  const hours = Math.floor((now.getTime() - new Date(deliveredAt).getTime()) / (60 * 60 * 1000));
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
