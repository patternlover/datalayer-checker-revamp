// Impostazioni: tre righe, nessuna prosa. Ogni riga ha il suo interruttore e, dove serve, un
// triangolino che apre le due o tre cose avanzate. Il container non si scrive: si legge dalla pagina.
import { $ } from "./util.js";
import { state } from "./store.js";
import { injector, setOn, chooseContainer, containersFor, injectIntoActiveTab } from "./injector.js";

let ctx;
let els;
let detected = [];

const TA_KEY = "injectorTA";
const MIRROR_KEY = "pixelmirror";
const MIRROR_SCOPE_KEY = "pixelmirrorScope";
const MIRROR_SCOPES = ["solo-checkout", "sempre"];

const mirror = { on: false, scope: "solo-checkout" };

const UI_MODES = ["popup", "sidepanel", "tab"];
const UI_MODE_LABELS = { popup: "Popup", sidepanel: "Pannello laterale", tab: "Nuova tab" };

export function init(context) {
  ctx = context;
  els = {
    uimodeRow: $("#uimode-row"),
    uimodeBody: $("#uimode-body"),
    uimodeValue: $("#uimode-value"),
    injectorRow: $("#injector-row"),
    injectorBody: $("#injector-body"),
    injectorToggle: $("#injector-toggle"),
    injectorTa: $("#injector-ta"),
    container: $("#injector-container"),
    mirrorRow: $("#mirror-row"),
    mirrorBody: $("#mirror-body"),
    mirrorToggle: $("#mirror-toggle"),
    mirrorScope: $("#mirror-scope"),
  };
  bindDisclosure(els.uimodeRow, els.uimodeBody);
  bindDisclosure(els.injectorRow, els.injectorBody);
  bindDisclosure(els.mirrorRow, els.mirrorBody);
  bindUiMode();
  bindInjector();
  bindMirror();
  fill();
  loadMirror();
  showVersion();
  return { render, refresh };
}

function showVersion() {
  const el = $("#app-version");
  if (el) el.textContent = "v" + chrome.runtime.getManifest().version + " · uso interno";
}

function bindDisclosure(row, body) {
  if (!row || !body) return;
  row.addEventListener("click", () => {
    const open = body.hidden;
    body.hidden = !open;
    row.setAttribute("aria-expanded", String(open));
  });
}

// ---------- Apertura ----------
async function bindUiMode() {
  const radios = document.querySelectorAll('input[name="uimode"]');
  if (!chrome.sidePanel) $("#uimode-sidepanel").classList.add("is-hidden");
  const stored = await chrome.storage.local.get(["dlcUiMode"]);
  // "window" era la vecchia modalità finestra: ora la più vicina è la tab.
  const raw = stored.dlcUiMode === "window" ? "tab" : stored.dlcUiMode;
  const mode = UI_MODES.includes(raw) ? raw : "popup";
  const apply = (next) => {
    radios.forEach((radio) => (radio.checked = radio.value === next));
    els.uimodeValue.textContent = UI_MODE_LABELS[next];
  };
  apply(mode);
  radios.forEach((radio) => {
    radio.addEventListener("change", async () => {
      if (!radio.checked) return;
      await chrome.storage.local.set({ dlcUiMode: radio.value });
      apply(radio.value);
      ctx.toast("L'icona aprirà: " + UI_MODE_LABELS[radio.value].toLowerCase());
    });
  });
}

// ---------- Injector ----------
function bindInjector() {
  els.injectorToggle.addEventListener("change", async () => {
    const want = els.injectorToggle.checked;
    if (!want) {
      await setOn(false);
      fill();
      return;
    }
    const result = await setOn(true, { tabId: state.tabId });
    if (!result.ok && result.reason === "choose") {
      detected = result.containers || [];
      renderContainers();
      openBody(els.injectorRow, els.injectorBody, true);
      els.injectorToggle.checked = false;
      ctx.toast("Ci sono " + detected.length + " container: scegli quale iniettare");
      return;
    }
    if (!result.ok) {
      els.injectorToggle.checked = false;
      ctx.toast(
        result.reason === "no-container"
          ? "Nessun container in questa pagina: aprine una dello store"
          : "Serve una tab in test: premi «Testa …» qui sopra"
      );
      return;
    }
    fill();
    ctx.toast("Inietto " + injector.container + " su " + injector.domains[0]);
  });

  els.container.addEventListener("change", async () => {
    await chooseContainer(els.container.value);
    els.injectorToggle.checked = injector.on;
    fill();
    ctx.toast("Inietto " + els.container.value);
  });

  els.injectorTa.addEventListener("change", async () => {
    await chrome.storage.sync.set({ [TA_KEY]: els.injectorTa.checked });
    injectIntoActiveTab();
    ctx.toast(els.injectorTa.checked ? "Container in debug per Tag Assistant" : "Container senza debug");
  });
}

function openBody(row, body, open) {
  body.hidden = !open;
  row.setAttribute("aria-expanded", String(open));
}

// Le opzioni del selettore: prima quella in uso, poi quelle trovate in pagina.
function renderContainers() {
  const current = injector.container;
  const ids = [];
  if (current) ids.push(current);
  detected.forEach((c) => {
    if (c.id && !ids.includes(c.id)) ids.push(c.id);
  });
  els.container.innerHTML = "";
  if (!ids.length) {
    const opt = document.createElement("option");
    opt.textContent = "nessuno in pagina";
    opt.value = "";
    els.container.appendChild(opt);
    els.container.disabled = true;
    return;
  }
  els.container.disabled = false;
  ids.forEach((id) => {
    const opt = document.createElement("option");
    opt.value = id;
    const where = (detected.find((c) => c.id === id) || {}).frame;
    opt.textContent = where === "pixel" ? id + " · pixel" : where === "top" ? id + " · pagina" : id;
    els.container.appendChild(opt);
  });
  els.container.value = current || ids[0];
}

// ---------- Ponte ----------
async function loadMirror() {
  const stored = await chrome.storage.sync.get([MIRROR_KEY, MIRROR_SCOPE_KEY]);
  mirror.on = stored[MIRROR_KEY] === true;
  mirror.scope = MIRROR_SCOPES.includes(stored[MIRROR_SCOPE_KEY]) ? stored[MIRROR_SCOPE_KEY] : "solo-checkout";
  els.mirrorToggle.checked = mirror.on;
  els.mirrorScope.value = mirror.scope;
}

function bindMirror() {
  els.mirrorToggle.addEventListener("change", async () => {
    mirror.on = els.mirrorToggle.checked;
    await chrome.storage.sync.set({ [MIRROR_KEY]: mirror.on });
    if (mirror.on) openBody(els.mirrorRow, els.mirrorBody, true);
    ctx.toast(mirror.on ? "Ponte acceso" : "Ponte spento");
  });
  els.mirrorScope.addEventListener("change", async () => {
    mirror.scope = MIRROR_SCOPES.includes(els.mirrorScope.value) ? els.mirrorScope.value : "solo-checkout";
    await chrome.storage.sync.set({ [MIRROR_SCOPE_KEY]: mirror.scope });
    ctx.toast(mirror.scope === "sempre" ? "Rispecchio su tutte le pagine" : "Rispecchio solo checkout e ordini");
  });
}

// ---------- Rinfresco ----------
export async function fill() {
  els.injectorToggle.checked = injector.on;
  const ta = await chrome.storage.sync.get([TA_KEY]);
  // Attivo di base: la chiave manca finché non lo si spegne.
  els.injectorTa.checked = ta[TA_KEY] !== false;
  renderContainers();
}

// All'apertura della vista si rilegge cosa c'è in pagina: il selettore deve mostrare la verità.
export async function refresh() {
  if (!els) return;
  await fill();
  if (!els.injectorBody.hidden || !injector.container) {
    detected = await containersFor(state.tabId).catch(() => []);
    renderContainers();
  }
}

export function render() {
  if (!els) return;
  els.injectorToggle.checked = injector.on;
  els.mirrorToggle.checked = mirror.on;
}
