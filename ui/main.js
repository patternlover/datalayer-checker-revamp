import { $ } from "./util.js";
import {
  state,
  loadTarget,
  refreshActive,
  watchTargetChanges,
  pinTab,
  unpin,
  onPinResult,
  refreshTabInfo,
  connect,
  onUpdate,
  whenReady,
  startDebug,
  stopDebug,
  clearDebug,
  frameEvents,
} from "./store.js";
import * as injector from "./injector.js";
import * as events from "./events.js";
import * as collect from "./collect.js";
import * as settings from "./settings.js";

let eventsView;
let collectView;
let settingsView;
let currentView = "events";
let toastTimer;

const ctx = {
  showView: (name) => showView(name),
  toast: (message) => toast(message),
  startDebug: () => {
    if (state.tabId == null) {
      toast("Nessun tab valido");
      return;
    }
    startDebug();
  },
  setFrame: (frame, opts) => setFrame(frame, opts),
  pinActive: (tabId) => pinActive(tabId),
  stopDebug: () => stopDebug(),
  clearDebug: () => clearDebug(),
  goToEvent: (index) => {
    eventsView.selectEvent(index, { reveal: true });
    showView("events");
  },
};

async function boot() {
  await loadTarget();
  await refreshTabInfo();
  await refreshActive();
  await injector.load();
  state.frame = await readFramePref();

  wireChrome();
  setEnvUI(state.frame === "pixel" ? "iframe" : "top_frame");

  await events.restore();
  eventsView = events.init(ctx);
  collectView = collect.init(ctx);
  settingsView = settings.init(ctx);

  onPinResult((result) => {
    if (result.ok) toast("Tab in test: " + (state.target ? state.target.host : ""));
    else toast(result.reason === "not-https" ? "Serve una pagina https" : "Tab non disponibile");
  });
  connect();
  watchTargetChanges();
  onUpdate(scheduleRender);

  if (state.port) {
    await whenReady();
    ensureCapture();
  }

  renderAll();
}

// Il debug parte solo sulla tab in test, mai sulla tab che ha il focus.
function ensureCapture() {
  if (state.tabId == null) return;
  if (state.session && state.session.active) return;
  pinTab(state.tabId);
}

// Il pulsante ricorda la tab che sta proponendo (data-tab-id, aggiornato a ogni render):
// al click si aggancia quella, anche se nel frattempo il focus è passato all'estensione.
function pinActive(tabId) {
  const id = tabId != null ? tabId : state.active.tabId;
  if (id == null || (tabId == null && !state.active.host)) {
    toast("Apri una pagina https da testare");
    return;
  }
  pinTab(id);
}

async function focusTarget() {
  if (state.tabId == null) return;
  try {
    const tab = await chrome.tabs.update(state.tabId, { active: true });
    if (tab && tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
  } catch (e) {}
}

function renderTargetBar() {
  const target = state.target;
  const hostEl = $("#target-host");
  const pinBtn = $("#target-pin");
  const unpinBtn = $("#target-unpin");
  const bar = $("#target-bar");
  const activeIsTarget = state.active.tabId != null && state.active.tabId === state.tabId;
  const canPin = !!state.active.host && !activeIsTarget;

  const live = !!(target && state.tabId != null && state.session && state.session.active);
  bar.classList.toggle("is-empty", !target);
  bar.classList.toggle("is-waiting", !!target && state.tabId == null);
  bar.classList.toggle("is-live", live);
  if (!target) {
    hostEl.textContent = "Nessun sito in test";
    hostEl.title = "";
  } else if (state.tabId == null) {
    hostEl.textContent = target.host + " · chiusa";
    hostEl.title = "Riapri " + target.host + ": verrà riagganciata in automatico con lo storico";
  } else {
    hostEl.textContent = state.tabHost || target.host;
    hostEl.title = (state.tabUrl || "") + "\nClick: vai alla tab in test";
  }
  hostEl.disabled = state.tabId == null;
  unpinBtn.classList.toggle("is-hidden", !target);

  $("#target-pin-strip").classList.toggle("is-hidden", !canPin);
  $("#target-pin-strip").classList.toggle("is-switch", !!target);
  if (canPin) pinBtn.dataset.tabId = String(state.active.tabId);
  pinBtn.textContent = target ? "Passa a " + state.active.host : "Testa " + state.active.host;
  pinBtn.title = target
    ? "Sposta il test sulla tab attiva (" + state.active.host + "). Lo storico di " + target.host + " resta in pausa."
    : "Aggancia l'estensione a questa tab";
}

async function readFramePref() {
  const stored = await chrome.storage.sync.get(["frame"]);
  return stored.frame === "iframe" ? "pixel" : "top";
}

function setEnvUI(env) {
  document.querySelectorAll("#env-select .seg-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.env === env);
  });
}

// Top e Pixel vengono catturati in parallelo: cambiare ambiente è solo un cambio di vista,
// istantaneo e senza perdita di dati, così si possono confrontare i due dataLayer.
function setFrame(frame, opts) {
  const next = frame === "pixel" ? "pixel" : "top";
  if (next === state.frame) return;
  state.frame = next;
  const env = next === "pixel" ? "iframe" : "top_frame";
  chrome.storage.sync.set({ frame: env }).catch(() => {});
  setEnvUI(env);
  renderAll();
}

// Selettore Top/Pixel visibile solo se la tab in test ha un Shopify Custom Pixel.
// Il rilevamento è "appiccicoso" per la sessione: una volta visto, il selettore resta.
function hasPixel() {
  const session = state.session;
  if (!session) return false;
  return !!(session.platform && session.platform.shopify) || !!session.pixelSeen || frameEvents("pixel").length > 0;
}

function renderEnvSelect() {
  const show = hasPixel();
  $("#env-select").classList.toggle("is-hidden", !show);
  if (!show && state.frame === "pixel") setFrame("top");
  renderEnvCounts();
}

function renderEnvCounts() {
  ["top", "pixel"].forEach((frame) => {
    const badge = document.querySelector('#env-select .seg-count[data-frame="' + frame + '"]');
    if (!badge) return;
    const count = frameEvents(frame).length;
    badge.textContent = String(count);
    badge.classList.toggle("is-hidden", count === 0);
  });
}

function wireChrome() {
  document.querySelectorAll("#env-select .seg-btn").forEach((btn) => {
    btn.addEventListener("click", () => setFrame(btn.dataset.env === "iframe" ? "pixel" : "top"));
  });

  // Scorciatoia: T / P per alternare rapidamente le viste (fuori dai campi di testo).
  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = e.target && e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (!hasPixel()) return;
    if (e.key === "t" || e.key === "T") setFrame("top");
    else if (e.key === "p" || e.key === "P") setFrame("pixel");
  });

  document.querySelectorAll(".tab-btn[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => showView(btn.dataset.view));
  });

  // pointerdown: legge la tab proposta prima che il click sposti il focus.
  let pressedTabId = null;
  $("#target-pin").addEventListener("pointerdown", (e) => {
    pressedTabId = e.currentTarget.dataset.tabId ? Number(e.currentTarget.dataset.tabId) : null;
  });
  $("#target-pin").addEventListener("click", (e) => {
    const fromButton = e.currentTarget.dataset.tabId ? Number(e.currentTarget.dataset.tabId) : null;
    pinActive(pressedTabId != null ? pressedTabId : fromButton);
    pressedTabId = null;
  });
  $("#target-host").addEventListener("click", () => focusTarget());
  $("#target-unpin").addEventListener("click", () => unpin());

  // L'ingranaggio apre e chiude le impostazioni.
  $("#settings-toggle").addEventListener("click", () => showView(currentView === "settings" ? "events" : "settings"));
}

function showView(name) {
  currentView = name;
  const views = {
    events: $("#events-view"),
    uat: $("#uat-view"),
    settings: $("#settings-view"),
  };
  Object.keys(views).forEach((key) => views[key].classList.toggle("is-hidden", key !== name));
  document.querySelectorAll(".tab-btn[data-view]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === name);
  });
  $(".app").classList.toggle("is-settings", name === "settings");
  renderAll();
}

// Raggruppa gli aggiornamenti (gli eventi arrivano a raffica): al massimo un ridisegno per frame.
let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    renderAll();
  });
}

function renderAll() {
  injector.updateChip($("#injector-chip"));
  renderTargetBar();
  renderEnvSelect();
  // Nessun evento nell'ambiente corrente: solo il messaggio guida, senza lista e intestazione vuote.
  $(".app").classList.toggle("no-events", frameEvents().length === 0);

  if (currentView === "events" && eventsView) eventsView.render();
  else if (currentView === "uat" && collectView) collectView.render();
  else if (currentView === "settings" && settingsView) settingsView.render();
}

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-visible"), 1800);
}

boot();
