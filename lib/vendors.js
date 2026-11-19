// Hit dei vendor: la decodifica sta in lib/providers/ (porting di Omnibug), qui restano solo gli
// helper per gli ID dei container GTM letti dalla rete o dallo snippet.
export { VENDOR_URL_FILTERS, vendorForUrl, vendorById, decodeHit, PROVIDERS } from "./providers/index.js";

export function extractContainerIdsFromUrl(url) {
  const ids = [];
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "www.googletagmanager.com") return ids;
    if (!/\/gtm\.js$/.test(parsed.pathname) && !/\/gtag\/js$/.test(parsed.pathname)) return ids;
    const id = parsed.searchParams.get("id");
    if (id) id.split(",").forEach((part) => ids.push(part.trim()));
  } catch (e) {}
  return ids.filter((id) => /^(GTM|G|DC|AW|MC)-/.test(id));
}

export function extractContainerIdsFromCode(code) {
  if (typeof code !== "string") return [];
  const found = code.match(/(GTM|G|DC|AW|MC)-[A-Z0-9]+/g) || [];
  return Array.from(new Set(found));
}
