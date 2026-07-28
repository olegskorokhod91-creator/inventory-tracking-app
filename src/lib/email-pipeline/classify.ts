export type EmailType = "order_confirmation" | "shipping_update" | "unknown";

// Cheap, deterministic first pass before any LLM call - avoids spending API
// calls on emails that are obviously irrelevant (account-security notices,
// newsletters, etc). Based on common retailer/carrier phrasing; expect to
// refine this once real emails start arriving - the human review step is
// the actual safety net regardless of how good this heuristic gets.
const SHIPPING_KEYWORDS = [
  "shipped",
  "has shipped",
  "out for delivery",
  "delivered",
  "on its way",
  "delayed",
  "delivery delay",
  "tracking",
  "package",
];

const CONFIRMATION_KEYWORDS = [
  "order confirmation",
  "order has been placed",
  "order placed",
  "thanks for your order",
  "thank you for your order",
  "your order",
];

export function classifyEmailBySubject(
  subject: string,
  senderDomain: string,
  knownRetailerDomains: string[],
): EmailType {
  const lower = subject.toLowerCase();

  // Checked first, regardless of sender - catches both retailer-sent and
  // carrier-direct (UPS/FedEx/USPS) shipping notifications.
  if (SHIPPING_KEYWORDS.some((keyword) => lower.includes(keyword))) {
    return "shipping_update";
  }

  // Only a known retailer sends order confirmations - a carrier never would.
  const fromKnownRetailer = knownRetailerDomains.some((domain) =>
    senderDomain.toLowerCase().endsWith(domain.toLowerCase()),
  );
  if (fromKnownRetailer && CONFIRMATION_KEYWORDS.some((keyword) => lower.includes(keyword))) {
    return "order_confirmation";
  }

  return "unknown";
}

export function extractSenderDomain(fromAddress: string): string {
  const at = fromAddress.lastIndexOf("@");
  return at === -1 ? "" : fromAddress.slice(at + 1);
}
