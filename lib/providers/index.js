// Registro dei vendor: un vendor = un provider Omnibug + i filtri webRequest + la chiave
// dell'evento (per correlare la hit al push del dataLayer) + la documentazione ufficiale.
//
// Per aggiungerne uno: si copia il file da `src/providers/` di Omnibug, lo si rende modulo ES
// come gli altri e si aggiunge una riga qui. Niente da toccare altrove: cattura, filtri della
// UI e decodifica leggono tutti da questa tabella.
import GoogleAnalytics4Provider from "./google-analytics-4.js";
import GoogleAnalyticsProvider from "./google-analytics.js";
import GoogleTagManagerProvider from "./google-tag-manager.js";
import GoogleAdsProvider from "./google-ads.js";
import FacebookPixelProvider from "./facebook-pixel.js";
import TikTokProvider from "./tiktok.js";
import LinkedInProvider from "./linkedin.js";
import PinterestProvider from "./pinterest.js";
import SnapchatProvider from "./snapchat.js";
import RedditPixelProvider from "./reddit-pixel.js";
import BingAdsProvider from "./bing-ads.js";
import CriteoOneTagProvider from "./criteo-one-tag.js";
import HotjarProvider from "./hotjar.js";
import MicrosoftClarityProvider from "./microsoft-clarity.js";

// `filters` sono match pattern per webRequest (la cattura), `Provider` è il pattern preciso
// (la decodifica): una richiesta passa il filtro e viene scartata se nessun provider la
// riconosce. `eventKey` è il parametro che contiene il nome grezzo dell'evento.
const CATALOG = [
  {
    id: "ga4",
    label: "GA4",
    Provider: GoogleAnalytics4Provider,
    eventKey: "en",
    docs: "https://developers.google.com/analytics/devguides/collection/protocol/ga4/sending-events",
    filters: ["*://*.google-analytics.com/*", "*://*.analytics.google.com/*"],
  },
  {
    id: "ua",
    label: "Universal Analytics",
    Provider: GoogleAnalyticsProvider,
    eventKey: "ea",
    docs: "https://developers.google.com/analytics/devguides/collection/protocol/v1/parameters",
    filters: ["*://*.google-analytics.com/*", "*://analytics.google.com/*"],
  },
  {
    id: "gtm",
    label: "GTM",
    Provider: GoogleTagManagerProvider,
    docs: "https://developers.google.com/tag-platform/tag-manager",
    filters: ["*://*.googletagmanager.com/*"],
  },
  {
    id: "googleads",
    label: "Google Ads",
    Provider: GoogleAdsProvider,
    docs: "https://support.google.com/google-ads/answer/2454064",
    filters: ["*://*.doubleclick.net/*", "*://googleads.g.doubleclick.net/*"],
  },
  {
    id: "meta",
    label: "Meta",
    Provider: FacebookPixelProvider,
    eventKey: "ev",
    docs: "https://developers.facebook.com/docs/meta-pixel/reference",
    filters: ["*://*.facebook.com/*"],
  },
  {
    id: "tiktok",
    label: "TikTok",
    Provider: TikTokProvider,
    eventKey: "event",
    docs: "https://ads.tiktok.com/help/article/standard-events-parameters",
    filters: ["*://analytics.tiktok.com/*", "*://business-api.tiktok.com/*"],
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    Provider: LinkedInProvider,
    filters: ["*://*.linkedin.com/*"],
  },
  {
    id: "pinterest",
    label: "Pinterest",
    Provider: PinterestProvider,
    eventKey: "event",
    docs: "https://developers.pinterest.com/docs/conversions/conversion-management/",
    filters: ["*://ct.pinterest.com/*"],
  },
  {
    id: "snapchat",
    label: "Snapchat",
    Provider: SnapchatProvider,
    eventKey: "ev",
    filters: ["*://tr.snapchat.com/*"],
  },
  {
    id: "reddit",
    label: "Reddit",
    Provider: RedditPixelProvider,
    eventKey: "event",
    filters: ["*://*.reddit.com/*"],
  },
  {
    id: "microsoftads",
    label: "Microsoft Ads",
    Provider: BingAdsProvider,
    eventKey: "evt",
    filters: ["*://bat.bing.com/*"],
  },
  {
    id: "criteo",
    label: "Criteo",
    Provider: CriteoOneTagProvider,
    filters: ["*://sslwidget.criteo.com/*"],
  },
  {
    id: "hotjar",
    label: "Hotjar",
    Provider: HotjarProvider,
    filters: ["*://*.hotjar.com/*", "*://*.hotjar.io/*"],
  },
  {
    id: "clarity",
    label: "Clarity",
    Provider: MicrosoftClarityProvider,
    filters: ["*://*.clarity.ms/*"],
  },
];

export const PROVIDERS = CATALOG.map((entry) => ({
  id: entry.id,
  label: entry.label,
  docs: entry.docs || null,
  eventKey: entry.eventKey || null,
  filters: entry.filters,
  provider: new entry.Provider(),
}));

export const VENDOR_URL_FILTERS = Array.from(new Set(PROVIDERS.flatMap((vendor) => vendor.filters)));

// L'ordine conta: il primo provider che riconosce l'URL vince (GA4 esclude nel suo pattern i
// domini che appartengono a Clarity o DoubleClick).
export function vendorForUrl(url) {
  if (typeof url !== "string") return null;
  for (const vendor of PROVIDERS) {
    try {
      if (vendor.provider.checkUrl(url)) return vendor;
    } catch (e) {}
  }
  return null;
}

export function vendorById(id) {
  return PROVIDERS.find((vendor) => vendor.id === id) || null;
}

function text(value) {
  if (value === null || typeof value === "undefined") return "";
  return String(value);
}

// Decodifica una richiesta. Ritorna null se nessun vendor la riconosce: la hit non va salvata.
// `postData` è il corpo della richiesta (JSON o form-urlencoded), come lo dà webRequest.
export function decodeHit(url, postData) {
  const vendor = vendorForUrl(url);
  if (!vendor) return null;

  let parsed = { data: [] };
  try {
    parsed = vendor.provider.parseUrl(url, postData || "");
  } catch (e) {
    return null;
  }

  const data = Array.isArray(parsed.data) ? parsed.data : [];
  const columns = vendor.provider.columnMapping || {};
  const valueOf = (key) => {
    if (!key) return "";
    const item = data.find((entry) => entry && entry.key === key);
    return item ? text(item.value) : "";
  };

  const groups = (vendor.provider.groups || []).map((group) => ({ key: group.key, name: group.name }));
  const fields = data
    .filter((entry) => entry && !entry.hidden && typeof entry.key === "string")
    .map((entry) => ({
      key: entry.key,
      field: entry.field || entry.key,
      value: text(entry.value),
      group: entry.group || "other",
    }));

  let path = "";
  try {
    path = new URL(url).pathname;
  } catch (e) {}

  const rawEvent = vendor.eventKey ? valueOf(vendor.eventKey) : "";
  return {
    vendor: vendor.id,
    vendorLabel: vendor.label,
    docs: vendor.docs,
    path: path,
    account: valueOf(columns.account),
    requestType: valueOf(columns.requestType),
    eventName: rawEvent || valueOf(columns.requestType),
    groups: groups,
    fields: fields,
  };
}
