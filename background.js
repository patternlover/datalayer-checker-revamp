import * as store from "./lib/session-store.js";
import Flatted from "./lib/flatted.js";
import { extractContainerIdsFromCode } from "./lib/vendors.js";
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
// Default: popup agganciato all'icona, come le altre estensioni (si apre al click e si chiude
// cliccando altrove). In alternativa finestra separata persistente (funziona ovunque, anche su
// Arc che non supporta il side panel) o pannello laterale (solo Chrome).
const UI_MODE_KEY = "dlcUiMode"; // "popup" | "window" | "sidepanel"
const SIDEPANEL_BROKEN_KEY = "dlcSidePanelBroken"; // true = qui il pannello laterale non si apre
const UI_POPUP_URL = "index.html?popup=1";

async function uiMode() {
  const stored = await chrome.storage.local.get(UI_MODE_KEY);
  const mode = stored[UI_MODE_KEY];
  if (mode === "sidepanel" && chrome.sidePanel) return "sidepanel";
  if (mode === "tab" || mode === "window") return "tab";
  return "popup";
}

// Popup e finestra si escludono a vicenda: con un popup dichiarato Chrome non emette
// action.onClicked, quindi per le altre modalità il popup va tolto (stringa vuota).
//
// Il click resta SEMPRE nostro: `openPanelOnActionClick` lo prende il browser, e i browser che
// espongono l'API senza mostrare il pannello (Arc) non lo restituiscono a nessuno: l'icona diventa
// muta e l'unico modo per uscirne era rimuovere e ricaricare l'estensione. Con il click in mano
// nostra il pannello si apre da `openFromAction()`, che può sempre ripiegare sulla finestra.
async function syncUiMode() {
  const mode = await uiMode();
  try {
    if (chrome.action.setPopup) await chrome.action.setPopup({ popup: mode === "popup" ? UI_POPUP_URL : "" });
  } catch (error) {}
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
  }
}
syncUiMode();

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

// Apertura in una tab: se la UI è già aperta la si porta davanti, altrimenti se ne crea una.
// Niente finestre separate: sono un'altra cosa da gestire, e il pannello laterale copre il caso
// "accanto alla pagina".
async function openUiTab() {
  const existing = await findUiTab();
  if (existing) {
    try {
      await chrome.tabs.update(existing.tabId, { active: true });
      if (existing.windowId != null) await chrome.windows.update(existing.windowId, { focused: true });
      return;
    } catch (error) {}
  }
  await chrome.tabs.create({ url: UI_URL, active: true }).catch(() => {});
}

// Il pannello laterale si apre e poi si VERIFICA: l'API c'è anche dove il pannello non esiste
// (Arc non lo implementa, ma `chrome.sidePanel` risponde). Se dopo l'apertura nessun documento del
// pannello è vivo, il browser viene segnato come rotto, si apre la finestra e i click successivi
// vanno dritti lì senza aspettare. Il segno dura fino al riavvio, così un aggiornamento del browser
// che ripara il pannello lo riaccende da solo.
async function sidePanelBroken() {
  const stored = await chrome.storage.local.get(SIDEPANEL_BROKEN_KEY);
  return stored[SIDEPANEL_BROKEN_KEY] === true;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Il documento del pannello in QUESTA finestra (o in una qualunque, se windowId è null).
async function sidePanelDocument(windowId) {
  if (!chrome.runtime.getContexts) return null;
  try {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ["SIDE_PANEL"] });
    return (
      contexts.find(
        (c) =>
          typeof c.documentUrl === "string" &&
          c.documentUrl.startsWith(UI_URL) &&
          (windowId == null || c.windowId == null || c.windowId === windowId)
      ) || null
    );
  } catch (error) {
    return null;
  }
}

async function trySidePanel(tab) {
  if (!chrome.sidePanel || typeof chrome.sidePanel.open !== "function") return false;
  if (await sidePanelBroken()) return false;
  const windowId = tab && tab.windowId != null ? tab.windowId : null;

  // Già aperto: il click lo chiude, se il browser sa chiuderlo (Chrome 141+). Prima il toggle lo
  // faceva `openPanelOnActionClick`, che però non restituiva mai il click all'estensione.
  if (await sidePanelDocument(windowId)) {
    if (typeof chrome.sidePanel.close === "function") {
      try {
        await chrome.sidePanel.close(windowId != null ? { windowId: windowId } : {});
      } catch (error) {}
    }
    return true;
  }

  try {
    await chrome.sidePanel.open(windowId != null ? { windowId: windowId } : {});
  } catch (error) {
    await chrome.storage.local.set({ [SIDEPANEL_BROKEN_KEY]: true });
    return false;
  }
  for (let i = 0; i < 6; i++) {
    if (await sidePanelDocument(windowId)) return true;
    await sleep(100);
  }
  await chrome.storage.local.set({ [SIDEPANEL_BROKEN_KEY]: true });
  return false;
}

async function openFromAction(tab) {
  const mode = await uiMode();
  if (mode === "sidepanel" && (await trySidePanel(tab))) return;
  await openUiTab();
}

// Arriva solo quando il popup è tolto, cioè nelle modalità finestra e pannello laterale.
chrome.action.onClicked.addListener((tab) => {
  openFromAction(tab);
});
// Usato dai test automatici (non si può cliccare l'icona della toolbar da Playwright).
globalThis.__dlcOpenUi = openUiTab;
globalThis.__dlcOpenFromAction = openFromAction;

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
  syncUiMode();
});
chrome.runtime.onStartup.addListener(() => {
  // Era un segno permanente in storage.local: un browser aggiornato che ripara il pannello restava
  // segnato per sempre. Vale per la sessione, si riprova a ogni avvio.
  chrome.storage.local.remove(SIDEPANEL_BROKEN_KEY).catch(() => {});
  syncInjectorScripts();
});

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
  if (area === "local" && changes[UI_MODE_KEY]) syncUiMode();
  if (area !== "sync") return;
  if (changes.gtmcodepush || changes.gtmDomains) {
    syncInjectorScripts();
    injectBannerAllTabs(changes.gtmDomains && changes.gtmDomains.oldValue);
    syncInjectedContainers();
  }
  if (changes.gtmcode) {
    syncInjectedContainers();
  }
  // Il ponte si aggancia alle tab gia' aperte: senza questo il toggle avrebbe effetto solo al
  // prossimo caricamento della pagina.
  if (changes[MIRROR_KEY] || changes[MIRROR_SCOPE_KEY]) {
    chrome.tabs.query({}).then((tabs) => {
      for (const tab of tabs) {
        if (tab.id) serial(tab.id, () => injectCollector(tab.id));
      }
    });
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

// ---------- Rispecchia pixel sul Top ----------
// Gli eventi del checkout nascono nel sandbox del Custom Pixel e il dataLayer della pagina non
// li vede mai: il container del tema non li riceve e non li ricevera. Con `pixelmirror` acceso i
// push del frame pixel vengono ripushati IDENTICI nel dataLayer del frame principale, dove
// Tag Assistant li legge (con un container presente nel Top, che e' quello che l'Injector mette).
const MIRROR_KEY = "pixelmirror";
const MIRROR_SCOPE_KEY = "pixelmirrorScope";
const MIRROR_SCOPES = ["solo-checkout", "sempre"];

async function mirrorSettings() {
  const stored = await chrome.storage.sync.get([MIRROR_KEY, MIRROR_SCOPE_KEY]);
  return {
    on: stored[MIRROR_KEY] === true,
    scope: MIRROR_SCOPES.includes(stored[MIRROR_SCOPE_KEY]) ? stored[MIRROR_SCOPE_KEY] : "solo-checkout",
  };
}

// Il path della pagina vera sta DENTRO l'URL del sandbox, che la traccia:
//   /web-pixels@<hash>/custom/web-pixel-123@4/sandbox/modern/checkouts/cn/<token>/en-us
// Qui si legge da li' e non dal Top: con il checkout a pagina unica la rotta del Top non cambia
// fra i passi, e le pagine prerenderizzate hanno un frameId che non e' 0.
function sandboxPagePath(url) {
  const marker = "/sandbox/modern";
  const at = typeof url === "string" ? url.indexOf(marker) : -1;
  if (at === -1) return "";
  const rest = url.slice(at + marker.length);
  const cut = rest.search(/[?#]/);
  return cut === -1 ? rest : rest.slice(0, cut);
}

function mirrorInScope(url, scope) {
  if (scope === "sempre") return true;
  return /^\/(checkouts|orders)\//.test(sandboxPagePath(url));
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

// Nel frame del sandbox: aggancia dataLayer.push e manda ogni push al background.
function injectMirror(tabId, frameId) {
  chrome.scripting
    .executeScript({
      target: { tabId: tabId, frameIds: [frameId] },
      files: ["scripts/mirror.js"],
      world: "MAIN",
      injectImmediately: true,
    })
    .catch(() => {});
}

// Il Top non e' sempre frameId 0: si cerca il frame senza padre.
async function topFrameId(tabId) {
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId: tabId });
    const tops = (frames || []).filter((f) => f.parentFrameId === -1).map((f) => f.frameId);
    if (tops.length) return tops[0];
  } catch (error) {}
  return 0;
}

// Eseguita in world MAIN nel frame principale. L'evento arriva identico tranne le chiavi che GTM
// usa per il proprio ciclo di vita: `gtm.uniqueEventId` collide con quello del Top e il container
// scarterebbe l'evento come gia' visto.
function pushMirrored(events) {
  var dl = (window.dataLayer = window.dataLayer || []);
  for (var i = 0; i < events.length; i++) {
    var ev = events[i];
    if (!ev || typeof ev !== "object") continue;
    var copy = {};
    for (var key in ev) {
      if (!Object.prototype.hasOwnProperty.call(ev, key)) continue;
      if (key === "gtm.uniqueEventId" || key === "gtm.start") continue;
      copy[key] = ev[key];
    }
    dl.push(copy);
  }
}

// mode "seed" = il backlog gia' presente nel dataLayer del sandbox, "push" = un evento nuovo.
async function mirrorToTop(tabId, frameUrl, events) {
  const settings = await mirrorSettings();
  if (!settings.on) return;
  if (!mirrorInScope(frameUrl, settings.scope)) return;
  const list = Array.isArray(events) ? events.filter((ev) => ev && typeof ev === "object") : [];
  if (!list.length) return;
  const frameIds = [await topFrameId(tabId)];
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId, frameIds: frameIds },
      world: "MAIN",
      func: pushMirrored,
      args: [list],
    });
  } catch (error) {
    console.warn("dlc: rispecchia sul top", error);
  }
}

// Carica il collector su Top e sandbox, e il ponte dove serve.
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
  const mirror = await mirrorSettings();
  let pixel = false;
  for (const f of frames) {
    if (!isActiveDoc(f)) continue;
    if (isSandboxFrame(f)) {
      pixel = true;
      if (mirror.on) injectMirror(tabId, f.frameId);
    }
    if (isTopDetails(f) || isSandboxFrame(f)) injectInto(tabId, f.frameId);
  }
  if (pixel) await markPixel(tabId);
}

async function syncInjectedContainers(onlyTabId) {
  const { gtmcode, gtmcodepush } = await chrome.storage.sync.get(["gtmcode", "gtmcodepush"]);
  const ids = gtmcodepush === true ? extractContainerIdsFromCode(gtmcode) : [];
  // Codice nuovo = il vecchio esito ("non era uno snippet") non vale più.
  if (onlyTabId != null) await store.setFlags(onlyTabId, { gtmInvalid: false });
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
    const updated = await store.mergePageContainers(tabId, msg.ids || [], frame);
    if (updated) broadcast(tabId, { type: "session", session: updated });
    return;
  }

  if (msg && typeof msg === "object" && msg.type === "gtmInvalid") {
    const updated = await store.setFlags(tabId, { gtmInvalid: true });
    if (updated) broadcast(tabId, { type: "session", session: updated });
    return;
  }

  if (msg && typeof msg === "object" && msg.type === "pixelMirror") {
    // Non si aspetta: l'executeScript verso il Top passa per il bridge del browser, e questa
    // funzione gira nella coda `serial` della tab insieme a snapshot e navigazioni. Aspettandolo,
    // un push ogni secondo basta a mettersi in fila davanti alla lettura del dataLayer.
    mirrorToTop(tabId, frameUrl, msg.events || []).catch(() => {});
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
  // esiste, e con un solo Date.now() per tutti gli eventi la lista mostrerebbe orari identici.
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
  if (updated) await store.save(tabId);
  collectFor(tabId, result.entries);

  if (navChanged || result.trimmed > 0 || result.removed > 0) {
    broadcast(tabId, { type: "session", session: await store.get(tabId) });
  } else {
    broadcast(tabId, { type: "append", entries: result.entries, gtmInjected: parsed.gtmInjected === true });
  }
}

// ---------- Navigation ----------
// Il separatore di navigazione per il frame principale viene creato quando arriva lo snapshot
// del nuovo documento (store.noteTopDocument): funziona anche con prerender e back/forward cache.
// Qui si aggancia solo il collector, su più eventi per non perdere nessun caso.
function maybeInject(details) {
  if (details.tabId == null || details.tabId < 0) return;
  if (!isActiveDoc(details)) return;
  const top = isTopDetails(details);
  if (!top && !isSandboxUrl(details.url)) return;
  Promise.all([store.get(details.tabId), mirrorSettings()]).then(([session, mirror]) => {
    if (!session || !session.active) return;
    injectInto(details.tabId, details.frameId);
    if (top) return;
    markPixel(details.tabId);
    if (mirror.on) injectMirror(details.tabId, details.frameId);
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
  if (target && target.tabId != null) {
    // Chiudere la sessione azzera anche gli eventi: riaprire lo stesso sito deve partire da zero,
    // non ritrovare lo storico di un debug finito. (La raccolta UAT resta: è per host, non per tab.)
    await stopSession(target.tabId);
    await clearSession(target.tabId);
  }
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
