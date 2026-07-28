// Best-effort word-overlap match between a free-text hint (e.g. Amazon
// Business's PO Number field) and known properties. Deliberately simple -
// this only ever pre-selects a dropdown option an admin must still
// explicitly confirm, never assigns anything on its own.
const STOPWORDS = new Set(["the", "st", "rd", "ave", "refill", "str", "short", "term"]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word));
}

export function suggestPropertyMatch(
  hint: string | null,
  properties: { id: string; name: string; address: string }[],
): { id: string; name: string } | null {
  if (!hint) return null;

  const hintWords = tokenize(hint);
  if (hintWords.length === 0) return null;

  let best: { id: string; name: string; score: number } | null = null;

  for (const property of properties) {
    const propertyWords = tokenize(`${property.name} ${property.address}`);
    const score = hintWords.filter((word) => propertyWords.includes(word)).length;
    if (score > 0 && (!best || score > best.score)) {
      best = { id: property.id, name: property.name, score };
    }
  }

  return best ? { id: best.id, name: best.name } : null;
}
