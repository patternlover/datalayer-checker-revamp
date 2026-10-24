export const VENDORS = [
  { id: "ga4", label: "GA4", urls: ["*://*.google-analytics.com/*", "*://*.analytics.google.com/*"] },
  { id: "gtm", label: "GTM", urls: ["*://*.googletagmanager.com/*"] },
  { id: "googleads", label: "Google Ads", urls: ["*://*.doubleclick.net/*", "*://googleads.g.doubleclick.net/*"] },
  { id: "meta", label: "Meta", urls: ["*://*.facebook.com/tr*"] },
  { id: "tiktok", label: "TikTok", urls: ["*://analytics.tiktok.com/*", "*://business-api.tiktok.com/*"] },
  { id: "linkedin", label: "LinkedIn", urls: ["*://*.linkedin.com/px/*"] },
  { id: "pinterest", label: "Pinterest", urls: ["*://ct.pinterest.com/*"] },
  { id: "hotjar", label: "Hotjar", urls: ["*://*.hotjar.com/*", "*://*.hotjar.io/*"] },
  { id: "clarity", label: "Clarity", urls: ["*://*.clarity.ms/*"] },
];

export const VENDOR_URL_FILTERS = VENDORS.flatMap((vendor) => vendor.urls);

export function vendorForUrl(url) {
  return VENDORS.find((vendor) => vendor.urls.some((pattern) => urlMatches(url, pattern))) || null;
}

function urlMatches(url, pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  try {
    return new RegExp("^" + escaped + "$").test(url);
  } catch (e) {
    return false;
  }
}

const GA4_IDS = ["tid", "cid", "sid", "seg", "sct", "_et", "dl", "dr"];

export function decodeHit(url) {
  const vendor = vendorForUrl(url);
  const out = {
    vendor: vendor ? vendor.id : null,
    vendorLabel: vendor ? vendor.label : null,
    eventName: null,
    params: {},
    userProps: {},
    ids: {},
  };
  try {
    const parsed = new URL(url);
    out.path = parsed.pathname;
    parsed.searchParams.forEach((value, key) => {
      if (key === "en" || key === "ev" || key === "ea" || key === "event") {
        if (!out.eventName) out.eventName = value;
        else out.params[key] = value;
      } else if (key.startsWith("epn.")) {
        out.params[key.slice(4)] = Number(value);
      } else if (key.startsWith("ep.")) {
        out.params[key.slice(3)] = value;
      } else if (key.startsWith("up.")) {
        out.userProps[key.slice(3)] = value;
      } else if (GA4_IDS.includes(key)) {
        out.ids[key] = value;
      } else {
        out.params[key] = value;
      }
    });
  } catch (e) {}
  return out;
}

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
