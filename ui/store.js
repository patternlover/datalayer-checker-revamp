import { hostnameOf, frameOf } from "./util.js";
import { getTarget, TARGET_KEY, hostOf } from "../lib/target.js";

const listeners = new Set();
let readyResolve = null;
let readyPromise = null;

export const state = {
  tabId: null,
  tabUrl: null,
  tabHost: null,
  frame: "top",
  session: null,
  port: null,
  // Tab in test (fissata dall'utente) e tab attiva nella finestra del pannello.
  target: null,
  active: { tabId: null, url: null, host: null },
};

let pinResultHandler = null;
export function onPinResult(fn) {
  pinResultHandler = fn;
}

export function frameEvents(frame) {
  const events = state.session && Array.isArray(state.session.events) ? state.session.events : [];
  const target = frame || state.frame;
  return events.filter((entry) => frameOf(entry) === target);
}

export function frameHits(frame) {
  const hits = state.session && Array.isArray(state.session.hits) ? state.session.hits : [];
  const target = frame || state.frame;
  return hits.filter((hit) => frameOf(hit) === target);
}

export function onUpdate(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function whenReady() {
  if (!readyPromise) {
    readyPromise = new Promise((resolve) => {
      readyResolve = resolve;
    });
  }
  return readyPromise;
}

function emit() {
  listeners.forEach((fn) => fn());
}

// La UI mostra SEMPRE la tab in test, mai "la tab attiva": il focus può passare a
// Google Sheets o ad altre tab senza che la vista cambi.
export async function loadTarget() {
  state.target = await getTarget();
  state.tabId = state.target && state.target.tabId != null ? state.target.tabId : null;
  return state.target;
}

let ownTabId;
async function getOwnTabId() {
  if (ownTabId !== undefined) return ownTabId;
  try {
    const own = await chrome.tabs.getCurrent();
    ownTabId = own ? own.id : null;
  } catch (e) {
    ownTabId = null;
  }
  return ownTabId;
}

function isOwnTab(tab, ownId) {
  if (!tab) return false;
  if (ownId != null && tab.id === ownId) return true;
  return typeof tab.url === "string" && tab.url.startsWith(chrome.runtime.getURL(""));
}

// Tab da proporre per "Testa questa tab". La pagina dell'estensione NON conta mai: in split view
// (Arc/Chrome) cliccare nel pannello dell'estensione le dà il focus, e senza questa regola il
// candidato sparirebbe proprio mentre si preme il pulsante. Si usa quindi la tab attiva se è un
// sito, altrimenti la tab https usata più di recente nella stessa finestra.
export async function refreshActive() {
  try {
    const ownId = await getOwnTabId();
    let win = null;
    try {
      win = await chrome.windows.getLastFocused({ populate: true, windowTypes: ["normal"] });
    } catch (e) {}
    let tabs = win && win.tabs ? win.tabs : null;
    if (!tabs) tabs = await chrome.tabs.query({ currentWindow: true });
    let tab = tabs.find((t) => t.active && !isOwnTab(t, ownId)) || null;
    if (!tab || !hostOf(tab.url)) {
      const activeIsOwn = tabs.some((t) => t.active && isOwnTab(t, ownId));
      if (activeIsOwn) {
        // Focus sull'estensione: ultima tab https usata (split view), oppure il candidato precedente.
        const recent = tabs
          .filter((t) => !isOwnTab(t, ownId) && hostOf(t.url))
          .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
        if (recent && recent.lastAccessed) tab = recent;
        else if (state.active.tabId != null) return;
      }
    }
    state.active = { tabId: tab ? tab.id : null, url: tab ? tab.url || null : null, host: tab ? hostOf(tab.url) : null };
  } catch (e) {
    state.active = { tabId: null, url: null, host: null };
  }
}

export function watchTargetChanges() {
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "local" || !changes[TARGET_KEY]) return;
    const prevTabId = state.tabId;
    await loadTarget();
    await refreshTabInfo();
    if (state.tabId !== prevTabId) {
      state.session = null;
      if (state.port) state.port.postMessage({ cmd: "watch", tabId: state.tabId });
    }
    emit();
  });
  const update = () => refreshActive().then(emit);
  chrome.tabs.onActivated.addListener(update);
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (info.url || info.status === "complete" || info.title) {
      if (tabId === state.tabId) refreshTabInfo().then(emit);
      update();
    }
  });
  if (chrome.windows && chrome.windows.onFocusChanged) chrome.windows.onFocusChanged.addListener(update);
}

export function pinTab(tabId) {
  if (state.port && tabId != null) state.port.postMessage({ cmd: "pin", tabId: tabId });
}

export function unpin() {
  if (state.port) state.port.postMessage({ cmd: "unpin" });
}

export async function refreshTabInfo() {
  if (state.tabId == null) {
    state.tabUrl = null;
    state.tabHost = null;
    return;
  }
  try {
    const tab = await chrome.tabs.get(state.tabId);
    state.tabUrl = tab && tab.url ? tab.url : null;
    state.tabHost = hostnameOf(state.tabUrl);
  } catch (e) {
    state.tabUrl = null;
    state.tabHost = null;
  }
}

export function connect() {
  try {
    state.port = chrome.runtime.connect({ name: "dlc-ui" });
  } catch (e) {
    state.port = null;
    return;
  }
  state.port.onMessage.addListener(handleMessage);
  state.port.onDisconnect.addListener(() => {
    state.port = null;
    setTimeout(() => {
      if (!state.port) connect();
    }, 400);
  });
  state.port.postMessage({ cmd: "watch", tabId: state.tabId });
}

function mergeEntries(incoming) {
  if (!state.session || !Array.isArray(incoming)) return;
  incoming.forEach((entry) => {
    if (!entry || typeof entry.i === "undefined") return;
    const index = state.session.events.findIndex((existing) => existing.i === entry.i);
    if (index === -1) state.session.events.push(entry);
    else state.session.events[index] = entry;
  });
}

function mergeHits(incoming) {
  if (!state.session || !Array.isArray(incoming)) return;
  incoming.forEach((hit) => {
    if (!hit || typeof hit.id === "undefined") return;
    const index = state.session.hits.findIndex((existing) => existing.id === hit.id);
    if (index === -1) state.session.hits.push(hit);
    else state.session.hits[index] = hit;
  });
}

function handleMessage(msg) {
  if (!msg || !msg.type) return;
  if (msg.type === "pin-result") {
    if (pinResultHandler) pinResultHandler(msg);
    return;
  }
  if (msg.type === "session") {
    // Risposta relativa a una tab non più in test (cambio target in corso): ignorata.
    if (msg.session && String(msg.session.tabId) !== String(state.tabId)) return;
    state.session = msg.session || null;
    if (readyResolve) {
      readyResolve();
      readyResolve = null;
    }
    emit();
    return;
  }
  // Dati incrementali senza una sessione locale (o con buchi): si richiede lo stato completo.
  if (!state.session && state.tabId != null && (msg.type === "append" || msg.type === "hits" || msg.type === "event-update")) {
    requestResync();
    return;
  }
  if (msg.type === "append") {
    if (!state.session) return;
    mergeEntries(msg.entries);
    mergeHits(msg.hits);
    if (typeof msg.gtmInjected === "boolean") {
      state.session.gtmInjected = msg.gtmInjected;
    }
    emit();
    return;
  }
  if (msg.type === "event-update") {
    if (!state.session) return;
    mergeEntries(msg.entries);
    emit();
    return;
  }
  if (msg.type === "hits") {
    if (!state.session) return;
    mergeHits(msg.hits);
    emit();
    return;
  }
  if (msg.type === "hit-update") {
    if (!state.session) return;
    const hit = state.session.hits.find((entry) => entry.requestId === msg.requestId);
    if (hit) {
      hit.status = msg.status;
      emit();
    }
    return;
  }
  if (msg.type === "tab-closed") {
    state.session = null;
    emit();
  }
}

let resyncTimer = null;
function requestResync() {
  if (resyncTimer || !state.port) return;
  resyncTimer = setTimeout(() => {
    resyncTimer = null;
    if (state.port) state.port.postMessage({ cmd: "watch", tabId: state.tabId });
  }, 150);
}

export function startDebug() {
  if (state.port) state.port.postMessage({ cmd: "start", tabId: state.tabId });
}

export function stopDebug() {
  if (state.port) state.port.postMessage({ cmd: "stop", tabId: state.tabId });
}

export function clearDebug() {
  if (state.port) state.port.postMessage({ cmd: "clear", tabId: state.tabId });
}
