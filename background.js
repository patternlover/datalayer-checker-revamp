import * as store from "./lib/session-store.js";
import Flatted from "./lib/flatted.js";
import { VENDOR_URL_FILTERS, decodeHit, extractContainerIdsFromUrl, extractContainerIdsFromCode } from "./lib/vendors.js";
import { correlateNewEvents, correlateNewHit } from "./lib/correlation.js";
import { getTarget, setTarget, hostOf } from "./lib/target.js";
import * as collector from "./lib/collect.js";

// Salva nella raccolta UAT gli eventi richiesti (solo per la tab in test).
async function collectFor(tabId, entries) {
  if (!entries || !entries.length) return;
  const target = await getTarget();
  if (!target || String(target.tabId) !== String(tabId) || !target.host) return;
  await serial("collect", () => collector.collect(target.host, tabId, entries));
}

const capturePorts = new Map();
const uiPorts = new Set();

// ---------- Apertura UI ----------
// Default: finestra separata persistente (funziona ovunque, anche su Arc che non supporta
// il side panel). Opzionale su Chrome: pannello laterale. Il popup non si usa più perché
// si chiude a ogni cambio di focus.
const UI_MODE_KEY = "dlcUiMode"; // "window" | "sidepanel"
const UI_WIN_KEY = "dlcUiWindow"; // { id } in storage.session
const UI_BOUNDS_KEY = "dlcUiBounds"; // { left, top, width, height } in storage.local

async function uiMode() {
  const stored = await chrome.storage.local.get(UI_MODE_KEY);
  return stored[UI_MODE_KEY] === "sidepanel" && chrome.sidePanel ? "sidepanel" : "window";
}

async function enablePanel() {
  if (!chrome.sidePanel || !chrome.sidePanel.setPanelBehavior) return;
  const mode = await uiMode();
  // Con "sidepanel" ci pensa Chrome; con "window" arriva action.onClicked e apriamo la finestra.
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: mode === "sidepanel" }).catch(() => {});
}
enablePanel();

const UI_URL = chrome.runtime.getURL("index.html");

// Dove si trova DAVVERO la UI aperta (se c'è). Non ci si fida di un ID finestra salvato:
// Arc trasforma le finestre popup in schede della finestra principale, e un ID salvato
// finirebbe per indicare la finestra del browser invece della UI.
async function findUiTab() {
  try {
    if (chrome.runtime.getContexts) {
      const contexts = await chrome.runtime.getContexts({ contextTypes: ["TAB"] });
      const ui = contexts.find((c) => c.tabId != null && c.tabId >= 0 && typeof c.documentUrl === "string" && c.documentUrl.startsWith(UI_URL));
      if (ui) return { tabId: ui.tabId, windowId: ui.windowId };
    }
  } catch (error) {}
  return null;
}

function saneBounds(b) {
  if (!b) return null;
  const ok = [b.left, b.top, b.width, b.height].every((v) => Number.isFinite(v));
  if (!ok || b.width < 320 || b.height < 360 || b.left < -200 || b.top < -200 || b.left > 6000 || b.top > 4000) return null;
  return { left: b.left, top: b.top, width: b.width, height: b.height };
}

async function openUiWindow() {
  // 1. UI già aperta (finestra o scheda): la si porta in primo piano.
  const existing = await findUiTab();
  if (existing) {
    try {
      await chrome.tabs.update(existing.tabId, { active: true });
      if (existing.windowId != null) await chrome.windows.update(existing.windowId, { focused: true });
      return;
    } catch (error) {}
  }
  // 2. Nuova finestra separata (posizione/dimensioni ricordate solo se plausibili).
  const { [UI_BOUNDS_KEY]: stored } = await chrome.storage.local.get(UI_BOUNDS_KEY);
  const opts = { url: UI_URL, type: "popup", width: 460, height: 860, focused: true };
  const bounds = saneBounds(stored);
  if (bounds) Object.assign(opts, bounds);
  try {
    const win = await chrome.windows.create(opts);
    await chrome.storage.session.set({ [UI_WIN_KEY]: { id: win.id } });
    return;
  } catch (error) {}
  try {
    // Posizione salvata non valida per questo schermo: riprova senza.
    const win = await chrome.windows.create({ url: UI_URL, type: "popup", width: 460, height: 860, focused: true });
    await chrome.storage.session.set({ [UI_WIN_KEY]: { id: win.id } });
    return;
  } catch (error) {}
  // 3. Ultima risorsa: UI in una scheda normale.
  await chrome.tabs.create({ url: UI_URL }).catch(() => {});
}

chrome.action.onClicked.addListener(() => {
  openUiWindow();
});
// Usato dai test automatici (non si può cliccare l'icona della toolbar da Playwright).
globalThis.__dlcOpenUi = openUiWindow;

// Ricorda posizione e dimensioni della finestra.
if (chrome.windows.onBoundsChanged) {
  chrome.windows.onBoundsChanged.addListener(async (win) => {
    const { [UI_WIN_KEY]: saved } = await chrome.storage.session.get(UI_WIN_KEY);
    if (!saved || saved.id !== win.id || win.type !== "popup") return;
    if (!saneBounds(win)) return;
    await chrome.storage.local.set({ [UI_BOUNDS_KEY]: { left: win.left, top: win.top, width: win.width, height: win.height } });
  });
}
chrome.windows.onRemoved.addListener(async (windowId) => {
  const { [UI_WIN_KEY]: saved } = await chrome.storage.session.get(UI_WIN_KEY);
  if (saved && saved.id === windowId) await chrome.storage.session.remove(UI_WIN_KEY);
});

// Allineamento all'avvio del service worker: solo la tab in test può avere una cattura attiva
// (le versioni precedenti avviavano il debug su qualunque tab in cui si apriva il popup).
(async () => {
  const target = await getTarget();
  for (const session of await store.list()) {
    if (session.active && (!target || String(target.tabId) !== String(session.tabId))) {
      await store.setActive(session.tabId, false);
    }
  }
})().catch(() => {});

// Dopo un riavvio del browser i tabId cambiano: si conserva solo l'host da riagganciare.
chrome.runtime.onStartup.addListener(async () => {
  enablePanel();
  const target = await getTarget();
  if (target && target.tabId != null) await setTarget({ ...target, tabId: null, orphanTabId: null });
});

// ---------- Content scripts (injector + banner) ----------
// Script del GTM Injector: registrati SOLO quando l'injector è acceso e SOLO sui domini scelti,
// nel frame principale. Con l'injector spento l'estensione non tocca nessuna pagina finché non
// si preme "Testa" (e anche allora legge soltanto il dataLayer).
const INJECTOR_SCRIPT_IDS = ["gtm-code", "bridge-code", "banner-code"];

function domainMatches(domains) {
  const out = [];
  (domains || []).forEach((d) => {
    if (typeof d !== "string" || !/^[a-z0-9.-]+$/i.test(d)) return;
    out.push("https://" + d + "/*", "https://*." + d + "/*");
  });
  return out;
}

async function syncInjectorScripts() {
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts();
    const ours = existing.map((s) => s.id).filter((id) => INJECTOR_SCRIPT_IDS.includes(id));
    if (ours.length) await chrome.scripting.unregisterContentScripts({ ids: ours });
    const { gtmcodepush, gtmDomains } = await chrome.storage.sync.get(["gtmcodepush", "gtmDomains"]);
    const matches = domainMatches(gtmDomains);
    if (gtmcodepush !== true || !matches.length) return;
    await chrome.scripting.registerContentScripts([
      { id: "gtm-code", matches, js: ["scripts/gtmcode.js"], runAt: "document_end", world: "MAIN", allFrames: false },
      { id: "bridge-code", matches, js: ["scripts/bridge.js"], runAt: "document_end", allFrames: false },
      { id: "banner-code", matches, js: ["scripts/banner.js"], runAt: "document_end", allFrames: false },
    ]);
  } catch (error) {
    console.warn("dlc: injector scripts", error);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  // Pulizia: le vecchie checklist UAT non sono più usate.
  chrome.storage.local.remove("uatChecklists").catch(() => {});
  syncInjectorScripts();
});
chrome.runtime.onStartup.addListener(() => syncInjectorScripts());

// Aggiorna il banner solo nelle tab dei domini dell'injector (attuali o appena rimossi).
async function injectBannerAllTabs(extraDomains) {
  let tabs = [];
  const { gtmDomains } = await chrome.storage.sync.get("gtmDomains");
  const domains = [].concat(gtmDomains || [], extraDomains || []);
  try {
    tabs = await chrome.tabs.query({});
  } catch (error) {
    return;
  }
  for (const tab of tabs) {
    if (!tab.id || !tab.url || !/^https:\/\//.test(tab.url)) continue;
    const host = hostOf(tab.url);
    if (!host || !domains.some((d) => host === d || host.endsWith("." + d))) continue;
    chrome.scripting
      .executeScript({ target: { tabId: tab.id }, files: ["scripts/banner.js"] })
      .catch(() => {});
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[UI_MODE_KEY]) enablePanel();
  if (area !== "sync") return;
  if (changes.gtmcodepush || changes.gtmDomains) {
    syncInjectorScripts();
    injectBannerAllTabs(changes.gtmDomains && changes.gtmDomains.oldValue);
    syncInjectedContainers();
  }
  if (changes.gtmcode) {
    syncInjectedContainers();
  }
});

// ---------- Helpers ----------
// Sandbox dei Shopify Web Pixel (custom e app). Formati noti:
//   /web-pixels@<hash>/custom/web-pixel-123@4/sandbox/modern/...
//   /wpm@<hash>/custom/web-pixel-123@4/sandbox/modern/...   (formato precedente)
// Escluso il pixel interno di Shopify (shopify-custom-pixel), che non ha un dataLayer utile.
function isSandboxUrl(url) {
  if (typeof url !== "string" || url.includes("shopify-custom-pixel")) return false;
  if (url.includes("/sandbox/modern/")) return true;
  return /\/(web-pixels?|wpm)@[^/]*\/.*\/sandbox\//.test(url);
}

function isSandboxFrame(frame) {
  return !!frame && frame.frameType !== "outermost_frame" && frame.parentFrameId !== -1 && isSandboxUrl(frame.url);
}

// Segnala alla UI che la tab ha un Shopify Custom Pixel (mostra il selettore Top/Pixel).
async function markPixel(tabId) {
  const updated = await store.setFlags(tabId, { pixelSeen: true });
  if (updated) broadcast(tabId, { type: "session", session: updated });
}

// Il frame principale non ha sempre frameId 0: le pagine prerenderizzate (speculation rules,
// usate da molti temi Shopify) mantengono un frameId diverso anche dopo l'attivazione.
// Per questo il "top" si riconosce da frameType/parentFrameId, non solo dall'ID.
function isTopDetails(details) {
  if (!details) return false;
  if (details.frameType) return details.frameType === "outermost_frame";
  if (typeof details.parentFrameId === "number") return details.parentFrameId === -1;
  return details.frameId === 0;
}

function isActiveDoc(details) {
  return !details || !details.documentLifecycle || details.documentLifecycle === "active";
}

function frameKindFromDetails(details) {
  return isTopDetails(details) ? "top" : "pixel";
}

// Esegue in ordine le operazioni di una stessa tab: snapshot e append dello stesso frame
// non devono intrecciarsi tra un await e l'altro.
const tabQueues = new Map();
function serial(tabId, fn) {
  const k = String(tabId);
  const prev = tabQueues.get(k) || Promise.resolve();
  const next = prev.then(fn, fn).catch((error) => console.warn("dlc:", error));
  tabQueues.set(k, next);
  next.then(() => {
    if (tabQueues.get(k) === next) tabQueues.delete(k);
  });
  return next;
}

function injectInto(tabId, frameId) {
  chrome.scripting
    .executeScript({ target: { tabId: tabId, frameIds: [frameId] }, files: ["scripts/content.js"] })
    .catch(() => {});
  chrome.scripting
    .executeScript({ target: { tabId: tabId, frameIds: [frameId] }, files: ["scripts/containerprobe.js"], world: "MAIN" })
    .catch(() => {});
}

// Cattura sempre Top + tutti i sandbox Shopify Custom Pixel: il selettore Top/Pixel nella UI
// è solo un filtro di visualizzazione, così i due dataLayer restano disponibili in parallelo.
async function injectCollector(tabId) {
  let frames = [];
  try {
    frames = await chrome.webNavigation.getAllFrames({ tabId: tabId });
  } catch (error) {
    return;
  }
  if (!frames) return;
  let pixel = false;
  for (const f of frames) {
    if (!isActiveDoc(f)) continue;
    if (isSandboxFrame(f)) pixel = true;
    if (isTopDetails(f) || isSandboxFrame(f)) injectInto(tabId, f.frameId);
  }
  if (pixel) await markPixel(tabId);
}

async function syncInjectedContainers(onlyTabId) {
  const { gtmcode, gtmcodepush } = await chrome.storage.sync.get(["gtmcode", "gtmcodepush"]);
  const ids = gtmcodepush === true ? extractContainerIdsFromCode(gtmcode) : [];
  if (onlyTabId != null) {
    const session = await store.setInjectedContainers(onlyTabId, ids);
    if (session) broadcast(onlyTabId, { type: "session", session: session });
    return;
  }
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch (error) {
    return;
  }
  for (const tab of tabs) {
    if (!tab.id) continue;
    const session = await store.get(tab.id);
    if (!session) continue;
    const updated = await store.setInjectedContainers(tab.id, ids);
    if (updated) broadcast(tab.id, { type: "session", session: updated });
  }
}

// ---------- Sessions ----------
async function startSession(tabId) {
  const existing = await store.get(tabId);
  if (existing) {
    if (!existing.active) await store.setActive(tabId, true);
  } else {
    let url = "";
    try {
      const tab = await chrome.tabs.get(tabId);
      url = tab && tab.url ? tab.url : "";
    } catch (error) {}
    await store.create(tabId, url);
  }
  await injectCollector(tabId);
  await syncInjectedContainers(tabId);
  broadcast(tabId, { type: "session", session: await store.get(tabId) });
}

async function stopSession(tabId) {
  const session = await store.setActive(tabId, false);
  if (!session) return;
  const prefix = String(tabId) + ":";
  for (const [mapKey, port] of capturePorts) {
    if (!mapKey.startsWith(prefix)) continue;
    try {
      port.disconnect();
    } catch (error) {}
    capturePorts.delete(mapKey);
  }
  broadcast(tabId, { type: "session", session: session });
}

async function clearSession(tabId) {
  const session = await store.get(tabId);
  if (!session) {
    broadcast(tabId, { type: "session", session: null });
    return;
  }
  if (!session.active) {
    await store.remove(tabId);
    broadcast(tabId, { type: "session", session: null });
    return;
  }
  const cleared = await store.clearData(tabId);
  broadcast(tabId, { type: "session", session: cleared });
}

// ---------- Capture port (content script -> background) ----------
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "dlc-capture" || port.name.startsWith("dlc-capture|")) handleCapture(port);
  else if (port.name === "dlc-ui") handleUI(port);
});

function handleCapture(port) {
  const tabId = port.sender && port.sender.tab ? port.sender.tab.id : null;
  const frameId = port.sender && typeof port.sender.frameId === "number" ? port.sender.frameId : 0;
  const frameUrl = port.sender ? port.sender.url : "";
  // Il content script dichiara se gira nel frame principale (window.top === window).
  const role = port.name.split("|")[1];
  const isTop = role ? role === "top" : frameId === 0;
  const frame = isTop ? "top" : "pixel";

  // Listener registrato SUBITO: i messaggi che arrivano mentre si legge lo storage
  // (es. lo snapshot iniziale dopo il risveglio del service worker) vengono messi in coda
  // invece di andare persi.
  const queue = [];
  let accepted = null;
  port.onMessage.addListener((msg) => {
    if (accepted === true) serial(tabId, () => handleCaptureMessage(tabId, frameId, frame, frameUrl, msg));
    else if (accepted === null) queue.push(msg);
  });

  const reject = () => {
    accepted = false;
    queue.length = 0;
    try {
      port.disconnect();
    } catch (error) {}
  };

  if (tabId == null || (!isTop && !isSandboxUrl(frameUrl))) {
    reject();
    return;
  }

  store.get(tabId).then((session) => {
    if (!session || !session.active) {
      reject();
      return;
    }
    const mapKey = String(tabId) + ":" + frameId;
    const previous = capturePorts.get(mapKey);
    if (previous && previous !== port) {
      try {
        previous.disconnect();
      } catch (error) {}
    }
    capturePorts.set(mapKey, port);
    port.onDisconnect.addListener(() => {
      if (capturePorts.get(mapKey) === port) capturePorts.delete(mapKey);
    });
    accepted = true;
    queue.splice(0).forEach((msg) => serial(tabId, () => handleCaptureMessage(tabId, frameId, frame, frameUrl, msg)));
    // Chiede sempre uno snapshot completo dopo l'aggancio: ricostruisce eventuali buchi.
    safePost(port, { cmd: "resync" });
    if (!isTop) markPixel(tabId);
  });
}

async function handleCaptureMessage(tabId, frameId, frame, frameUrl, msg) {
  const session = await store.get(tabId);
  if (!session || !session.active) return;

  if (msg && typeof msg === "object" && msg.type === "platform") {
    if (frame === "top" && msg.shopify) {
      const updated = await store.setFlags(tabId, { platform: { shopify: true } });
      if (updated) broadcast(tabId, { type: "session", session: updated });
    }
    return;
  }

  if (msg && typeof msg === "object" && msg.type === "containers") {
    const updated = await store.mergePageContainers(tabId, msg.ids || []);
    if (updated) broadcast(tabId, { type: "session", session: updated });
    return;
  }

  if (typeof msg !== "string") return;
  let parsed;
  try {
    parsed = Flatted.parse(msg);
  } catch (error) {
    return;
  }
  if (!parsed) return;

  if (parsed.gtmMeta) {
    const changed = await store.setGtmInjected(tabId, parsed.gtmInjected === true);
    if (changed) broadcast(tabId, { type: "append", entries: [], gtmInjected: true });
    return;
  }

  if (parsed.event !== "dataLayerData" || !Array.isArray(parsed.dlData)) return;

  if (typeof parsed.gtmInjected === "boolean") {
    await store.setGtmInjected(tabId, parsed.gtmInjected);
  }

  const docId = parsed.meta && parsed.meta.docId ? String(parsed.meta.docId) : null;
  const docUrl = (parsed.meta && parsed.meta.url) || frameUrl || "";

  // Nuovo documento nel frame principale (anche prerender/bfcache, dove webNavigation tace):
  // garantisce un separatore di navigazione dedicato.
  let navChanged = false;
  if (frame === "top" && docId) navChanged = await store.noteTopDocument(tabId, docId, docUrl);

  const current = await store.get(tabId);
  if (!current || !current.active) return;

  const startIndex = typeof parsed.startIndex === "number" ? parsed.startIndex : 0;
  const now = Date.now();
  // Un timestamp per posizione, crescente: nello snapshot l'ora vera dei push storici non
  // esiste, ma con un solo Date.now() per tutti gli eventi la lista mostra orari identici e
  // correlateNewHit non ha modo di scegliere il vicino giusto (a parita' di distanza vince
  // il primo dell'array, cioe' gtm.js).
  const count = parsed.dlData.length;
  const entries = parsed.dlData.map((data, k) => ({
    ts: count > 1 ? now - (count - 1 - k) : now,
    navId: current.navId,
    frameId: frameId,
    frame: frame,
    docId: docId,
    pos: startIndex + k,
    url: docUrl,
    data: data,
  }));

  let result;
  if (docId) result = await store.mergeDocEntries(tabId, docId, entries, parsed.mode === "snapshot", parsed.reset === true);
  else if (parsed.mode === "snapshot") result = await store.replaceNavFrameEvents(tabId, current.navId, frameId, entries);
  else result = await store.appendEvents(tabId, entries);

  const updated = await store.get(tabId);
  const linkedHits = [];
  if (updated) {
    correlateNewEvents(updated, result.entries);
    const hitIds = new Set();
    result.entries.forEach((entry) => (entry.hits || []).forEach((id) => hitIds.add(id)));
    if (hitIds.size) {
      updated.hits.forEach((hit) => {
        if (hitIds.has(hit.id)) linkedHits.push(hit);
      });
    }
    await store.save(tabId);
  }
  collectFor(tabId, result.entries);

  if (navChanged || result.trimmed > 0 || result.removed > 0) {
    broadcast(tabId, { type: "session", session: await store.get(tabId) });
  } else {
    broadcast(tabId, { type: "append", entries: result.entries, hits: linkedHits, gtmInjected: parsed.gtmInjected === true });
  }
}

// ---------- Hit inspector (webRequest, observe only) ----------
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId == null || details.tabId < 0) return;
    serial(details.tabId, () => handleHit(details));
  },
  { urls: VENDOR_URL_FILTERS },
  []
);

async function handleHit(details) {
  {
    const session = await store.get(details.tabId);
    if (!session || !session.active) return;

    const decoded = decodeHit(details.url);
    const hit = {
      ts: Date.now(),
      navId: session.navId,
      frameId: details.frameId || 0,
      frame: frameKindFromDetails(details),
      url: details.url,
      method: details.method || "GET",
      status: "pending",
      requestId: details.requestId,
      vendor: decoded.vendor,
      vendorLabel: decoded.vendorLabel,
      eventName: decoded.eventName,
      path: decoded.path,
      params: decoded.params,
      userProps: decoded.userProps,
      ids: decoded.ids,
      eventIndex: null,
    };
    const { hit: storedHit, trimmed } = await store.appendHit(details.tabId, hit);
    if (!storedHit) return;

    const containerIds = extractContainerIdsFromUrl(details.url);
    if (containerIds.length) await store.mergePageContainers(details.tabId, containerIds);

    const updated = await store.get(details.tabId);
    let linkedEntry = null;
    if (updated) {
      correlateNewHit(updated, storedHit);
      if (storedHit.eventIndex) {
        linkedEntry = updated.events.find((entry) => entry.i === storedHit.eventIndex) || null;
      }
      await store.save(details.tabId);
    }

    if (trimmed > 0 || containerIds.length) {
      broadcast(details.tabId, { type: "session", session: await store.get(details.tabId) });
    } else {
      if (linkedEntry) broadcast(details.tabId, { type: "event-update", entries: [linkedEntry] });
      broadcast(details.tabId, { type: "hits", hits: [storedHit] });
    }
  }
}

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId == null || details.tabId < 0) return;
    serial(details.tabId, async () => {
      const hit = await store.updateHitStatus(details.tabId, details.requestId, details.statusCode);
      if (hit) broadcast(details.tabId, { type: "hit-update", requestId: hit.requestId, status: hit.status });
    });
  },
  { urls: VENDOR_URL_FILTERS },
  []
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    if (details.tabId == null || details.tabId < 0) return;
    serial(details.tabId, async () => {
      const hit = await store.updateHitStatus(details.tabId, details.requestId, "error");
      if (hit) broadcast(details.tabId, { type: "hit-update", requestId: hit.requestId, status: hit.status, error: details.error || "" });
    });
  },
  { urls: VENDOR_URL_FILTERS },
  []
);

// ---------- Navigation ----------
// Il separatore di navigazione per il frame principale viene creato quando arriva lo snapshot
// del nuovo documento (store.noteTopDocument): funziona anche con prerender e back/forward cache.
// Qui si aggancia solo il collector, su più eventi per non perdere nessun caso.
function maybeInject(details) {
  if (details.tabId == null || details.tabId < 0) return;
  if (!isActiveDoc(details)) return;
  const top = isTopDetails(details);
  if (!top && !isSandboxUrl(details.url)) return;
  store.get(details.tabId).then((session) => {
    if (!session || !session.active) return;
    injectInto(details.tabId, details.frameId);
    if (!top) markPixel(details.tabId);
  });
}

chrome.webNavigation.onDOMContentLoaded.addListener(maybeInject);

// Segnale più precoce del Pixel: il commit dell'iframe sandbox, prima ancora che carichi.
chrome.webNavigation.onCommitted.addListener((details) => {
  if (isTopDetails(details) || !isSandboxUrl(details.url)) return;
  store.get(details.tabId).then((session) => {
    if (session && session.active) markPixel(details.tabId);
  });
});
chrome.webNavigation.onCompleted.addListener(maybeInject);

chrome.webNavigation.onCommitted.addListener((details) => {
  if (!isTopDetails(details) || !isActiveDoc(details)) return;
  serial(details.tabId, async () => {
    const session = await store.get(details.tabId);
    if (!session || !session.active) return;
    // Marker "in attesa": verrà associato allo snapshot del nuovo documento.
    const updated = await store.addNavMarker(details.tabId, "navigate", details.url);
    if (updated) broadcast(details.tabId, { type: "session", session: updated });
  });
  // Back/forward cache: la pagina torna senza DOMContentLoaded.
  const qualifiers = details.transitionQualifiers || [];
  if (qualifiers.includes("forward_back")) maybeInject(details);
});

// Prerender attivato / cambi URL non coperti da webNavigation: riaggancia il collector.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url && changeInfo.status !== "complete") return;
  serial(tabId, async () => {
    const session = await store.get(tabId);
    if (session && session.active) {
      injectCollector(tabId);
      return;
    }
    // Tab in test chiusa (o browser riavviato): la prima tab che apre lo stesso sito
    // diventa automaticamente la nuova tab in test, con lo storico precedente.
    const target = await getTarget();
    if (!target || target.tabId != null || !target.host) return;
    const host = hostOf((tab && tab.url) || changeInfo.url);
    if (host !== target.host) return;
    await pinTarget(tabId);
  });
});

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (!isTopDetails(details) || !isActiveDoc(details)) return;
  serial(details.tabId, async () => {
    const session = await store.get(details.tabId);
    if (!session || !session.active) return;
    const updated = await store.addNavMarker(details.tabId, "spa", details.url);
    if (updated) broadcast(details.tabId, { type: "session", session: updated });
  });
});

// Prerender attivato (vecchio modello): la sessione segue la tab che prende il posto.
chrome.webNavigation.onTabReplaced.addListener((details) => {
  serial(details.replacedTabId, async () => {
    const moved = await store.rekey(details.replacedTabId, details.tabId);
    if (moved) injectCollector(details.tabId);
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  serial(tabId, async () => {
    const target = await getTarget();
    const session = await store.get(tabId);
    if (target && target.tabId === tabId) {
      // Si conserva lo storico: verrà riagganciato quando il sito viene riaperto.
      if (session) await store.setActive(tabId, false);
      await setTarget({ ...target, tabId: null, orphanTabId: session ? tabId : null });
      return;
    }
    if (!session) return;
    await store.remove(tabId);
    broadcast(tabId, { type: "tab-closed" });
  });
});

// ---------- Tab in test ----------
async function pinTarget(tabId) {
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (error) {
    return { ok: false, reason: "no-tab" };
  }
  const host = hostOf(tab && tab.url);
  if (!host) return { ok: false, reason: "not-https" };

  const previous = await getTarget();
  // Riaggancio dello stesso sito dopo chiusura tab: lo storico segue la nuova tab.
  if (previous && previous.orphanTabId != null && previous.host === host && previous.orphanTabId !== tabId) {
    await store.rekey(previous.orphanTabId, tabId);
  }
  // Una sola tab catturata alla volta: le altre sessioni vanno in pausa (dati conservati).
  for (const session of await store.list()) {
    if (session.active && String(session.tabId) !== String(tabId)) await stopSession(session.tabId);
  }
  const target = { tabId: tabId, host: host, title: tab.title || host, pinnedAt: Date.now(), orphanTabId: null };
  await setTarget(target);
  await startSession(tabId);
  return { ok: true, target: target };
}

async function unpinTarget() {
  const target = await getTarget();
  if (target && target.tabId != null) await stopSession(target.tabId);
  await setTarget(null);
}

// ---------- UI port (popup/window -> background) ----------
function handleUI(port) {
  const entry = { port: port, tabId: null };
  uiPorts.add(entry);
  port.onDisconnect.addListener(() => uiPorts.delete(entry));
  port.onMessage.addListener(async (msg) => {
    if (!msg || typeof msg !== "object" || !msg.cmd) return;
    if (msg.cmd === "watch") {
      entry.tabId = msg.tabId == null ? null : msg.tabId;
      const session = entry.tabId == null ? null : await store.get(entry.tabId);
      safePost(port, { type: "session", session: session });
      // Apertura del popup = risincronizzazione: riaggancia i collector (idempotente,
      // gli snapshot sono deduplicati) così si vedono sempre i dati della pagina corrente.
      if (session && session.active) injectCollector(entry.tabId);
    } else if (msg.cmd === "start") {
      entry.tabId = msg.tabId == null ? null : msg.tabId;
      if (entry.tabId != null) await startSession(entry.tabId);
    } else if (msg.cmd === "pin") {
      if (msg.tabId == null) return;
      entry.tabId = msg.tabId;
      const result = await serial(msg.tabId, () => pinTarget(msg.tabId));
      safePost(port, { type: "pin-result", ok: !!(result && result.ok), reason: result && result.reason });
    } else if (msg.cmd === "unpin") {
      await unpinTarget();
    } else if (msg.cmd === "collect-set" || msg.cmd === "collect-clear") {
      const target = await getTarget();
      if (!target || !target.host) return;
      await serial("collect", async () => {
        if (msg.cmd === "collect-clear") return collector.clearItems(target.host);
        const session = target.tabId != null ? await store.get(target.tabId) : null;
        // Recupera anche gli eventi già scattati in questa sessione.
        return collector.setNames(target.host, collector.parseNames((msg.names || []).join(",")), target.tabId, session ? session.events : []);
      });
    } else if (msg.cmd === "stop") {
      if (msg.tabId != null) await stopSession(msg.tabId);
    } else if (msg.cmd === "clear") {
      if (msg.tabId != null) await clearSession(msg.tabId);
    }
  });
}

function safePost(port, message) {
  try {
    port.postMessage(message);
  } catch (error) {}
}

function broadcast(tabId, message) {
  for (const entry of uiPorts) {
    if (String(entry.tabId) === String(tabId)) safePost(entry.port, message);
  }
}
