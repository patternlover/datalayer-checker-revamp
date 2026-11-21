// Injector: un container GTM nel frame principale, preso da quello che la pagina già carica.
// Non c'è più un campo da compilare: il dominio è quello della tab in test, il container è quello
// che si trova in pagina (top per primo, poi il sandbox del pixel).
import { hostMatches, hostnameOf } from "./util.js";
import { state } from "./store.js";

export const injector = {
  on: false,
  container: "",
  domains: [],
};

const PUSH_KEY = "gtmcodepush";
const CODE_KEY = "gtmcode";
const DOMAINS_KEY = "gtmDomains";

export async function load() {
  const stored = await chrome.storage.sync.get([PUSH_KEY, CODE_KEY, DOMAINS_KEY]);
  injector.container = typeof stored[CODE_KEY] === "string" ? stored[CODE_KEY].trim() : "";
  injector.domains = Array.isArray(stored[DOMAINS_KEY]) ? stored[DOMAINS_KEY].filter((d) => typeof d === "string") : [];
  injector.on = stored[PUSH_KEY] === true && !!injector.container && injector.domains.length > 0;
  await chrome.storage.sync.remove(["injectTarget", "mirrorPixel"]);
}

// `gtmcode` può contenere un ID, uno snippet completo o JavaScript: qui interessa solo l'ID, perché
// è quello che serve al selettore.
function containerIdFrom(value) {
  const text = typeof value === "string" ? value : "";
  const match = text.match(/GTM-[A-Z0-9]+/);
  return match ? match[0] : "";
}

// Legge i container presenti in pagina: prima il frame principale, poi i sandbox del pixel.
export async function containersFor(tabId) {
  if (tabId == null) return [];
  let frames = [];
  try {
    frames = await chrome.webNavigation.getAllFrames({ tabId: tabId });
  } catch (error) {}
  const ordered = (frames || [])
    .filter((f) => f.documentLifecycle !== "prerender")
    .slice()
    .sort((a, b) => (a.parentFrameId === -1 ? -1 : b.parentFrameId === -1 ? 1 : 0));

  const found = [];
  for (const frame of ordered) {
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tabId, frameIds: [frame.frameId] },
        world: "MAIN",
        func: function () {
          try {
            return Object.keys(window.google_tag_manager || {}).filter(function (k) {
              return /^GTM-[A-Z0-9]+$/.test(k);
            });
          } catch (e) {
            return [];
          }
        },
      });
      const ids = (result && result.result) || [];
      const frameKind = frame.parentFrameId === -1 ? "top" : "pixel";
      ids.forEach((id) => {
        if (!found.some((f) => f.id === id)) found.push({ id: id, frame: frameKind });
      });
    } catch (error) {}
  }
  return found;
}

async function save(container, host) {
  injector.container = container;
  injector.domains = [host];
  injector.on = true;
  await chrome.storage.sync.set({ [PUSH_KEY]: true, [CODE_KEY]: container, [DOMAINS_KEY]: [host] });
  injectIntoActiveTab();
}

export async function setOn(on, options = {}) {
  if (!on) {
    injector.on = false;
    await chrome.storage.sync.set({ [PUSH_KEY]: false });
    return { ok: true };
  }
  const tabId = options.tabId;
  if (tabId == null) return { ok: false, reason: "no-tab" };
  let host = null;
  try {
    const tab = await chrome.tabs.get(tabId);
    host = hostnameOf((tab && tab.url) || "");
  } catch (error) {}
  if (!host) return { ok: false, reason: "no-tab" };

  // Se un container è già stato scelto, si usa quello; altrimenti si legge dalla pagina.
  let chosen = containerIdFrom(injector.container);
  if (!chosen) {
    const found = await containersFor(tabId);
    if (!found.length) return { ok: false, reason: "no-container" };
    if (found.length > 1) return { ok: false, reason: "choose", containers: found };
    chosen = found[0].id;
  }
  await save(chosen, host);
  return { ok: true, id: chosen, host: host };
}

export async function chooseContainer(container) {
  const id = containerIdFrom(container);
  if (!id) return { ok: false };
  const host = (await hostOfActiveTab()) || injector.domains[0] || null;
  if (!host) return { ok: false, reason: "no-tab" };
  await save(id, host);
  return { ok: true, id: id, host: host };
}

// Il dominio è quello della tab in test: dopo un `storage.clear()` non è più in memoria, e senza
// questo la scelta del container non aveva nulla su cui salvarsi.
async function hostOfActiveTab() {
  if (state.tabId == null) return null;
  try {
    const tab = await chrome.tabs.get(state.tabId);
    return hostnameOf((tab && tab.url) || "");
  } catch (error) {
    return null;
  }
}

// Il frame principale non è sempre frameId 0 (pagine prerenderizzate: vedi background.js).
export async function injectIntoActiveTab() {
  if (state.tabId == null) return;
  let frameIds = [0];
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId: state.tabId });
    const tops = (frames || []).filter((frame) => frame.parentFrameId === -1).map((frame) => frame.frameId);
    if (tops.length) frameIds = tops;
  } catch (error) {}
  chrome.scripting
    .executeScript({ target: { tabId: state.tabId, frameIds: frameIds }, files: ["scripts/gtmcode.js"], world: "MAIN" })
    .catch(() => {});
  chrome.scripting
    .executeScript({ target: { tabId: state.tabId, frameIds: frameIds }, files: ["scripts/bridge.js"] })
    .catch(() => {});
}

export function updateChip(dotEl) {
  if (!dotEl) return;
  const on = injector.on;
  const inDomain = on && hostMatches(state.tabHost, injector.domains);
  dotEl.classList.remove("chip-on", "chip-off", "chip-warn");
  dotEl.classList.toggle("is-hidden", !on);
  if (!on) return;
  if (!inDomain) {
    dotEl.classList.add("chip-warn");
    dotEl.title = "Injector acceso ma fuori dominio · attivo su " + injector.domains.join(", ");
    return;
  }
  const injected = !!(state.session && state.session.gtmInjected);
  dotEl.classList.add(injected ? "chip-on" : "chip-warn");
  dotEl.title = injected
    ? "Container iniettato" + (injector.container ? ": " + injector.container : "")
    : "Injector acceso, container non ancora in pagina";
}

