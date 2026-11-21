// Helfer per gli ID dei container GTM letti da uno snippet. La decodifica delle hit dei vendor
// non c'è più (vedi CHANGELOG 1.11.0): quel codice viveva in lib/providers/.
export function extractContainerIdsFromCode(code) {
  if (typeof code !== "string") return [];
  const found = code.match(/(GTM|G|DC|AW|MC)-[A-Z0-9]+/g) || [];
  return Array.from(new Set(found));
}
