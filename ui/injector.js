import { parseDomains, hostMatches, hostnameOf } from "./util.js";
import { state } from "./store.js";

export const injector = {
  on: false,
  code: "",
  domains: [],
};

export async function load() {
  const stored = await chrome.storage.sync.get(["gtmcodepush", "gtmcode", "gtmDomains", "gtmInjectionPage"]);
  await chrome.storage.sync.remove(["injectTarget", "mirrorPixel"]);

  let domains = Array.isArray(stored.gtmDomains)
    ? stored.gtmDomains.filter((domain) => typeof domain === "string" && domain)
    : [];
  const legacyPage = typeof stored.gtmInjectionPage === "string" && stored.gtmInjectionPage ? stored.gtmInjectionPage : null;
  if (!domains.length && legacyPage) {
    const legacyHost = hostnameOf(legacyPage);
    if (legacyHost) domains = [legacyHost];
  }

  injector.code = typeof stored.gtmcode === "string" ? stored.gtmcode : "";
  injector.domains = domains;
  injector.on = stored.gtmcodepush === true;

  if (!Array.isArray(stored.gtmDomains) || domains.join(",") !== stored.gtmDomains.join(",")) {
    await chrome.storage.sync.set({ gtmDomains: domains });
  }
  if (legacyPage) await chrome.storage.sync.remove("gtmInjectionPage");
  if (injector.on && !injector.domains.length) {
    injector.on = false;
    await chrome.storage.sync.set({ gtmcodepush: false });
  }
}

export async function saveSettings(fields) {
  const parsed = parseDomains(fields.domainsRaw);
  injector.code = fields.code;
  injector.domains = parsed.list;
  await chrome.storage.sync.set({ gtmcode: injector.code, gtmDomains: injector.domains });

  let turnedOff = false;
  if (injector.on && !injector.domains.length) {
    injector.on = false;
    turnedOff = true;
    await chrome.storage.sync.set({ gtmcodepush: false });
  }
  if (injector.on) injectIntoActiveTab();
  return { parsed: parsed, turnedOff: turnedOff };
}

export async function setOn(on, code) {
  if (on) {
    if (!injector.domains.length) return { ok: false, reason: "no-domains" };
    const snippet = typeof code === "string" ? code : injector.code;
    if (!snippet.trim()) return { ok: false, reason: "no-code" };
    injector.code = snippet;
    injector.on = true;
    // Lo snippet si salva qui, non solo con "Salva impostazioni": accendere l'injector senza
    // salvare era il modo più facile per vedere "GTM Injector ON" e nessun container in pagina.
    await chrome.storage.sync.set({ gtmcodepush: true, gtmDomains: injector.domains, gtmcode: snippet });
    injectIntoActiveTab();
    return { ok: true };
  }
  injector.on = false;
  await chrome.storage.sync.set({ gtmcodepush: false });
  return { ok: true };
}

// Il frame principale non è sempre frameId 0 (pagine prerenderizzate: vedi background.js):
// cercare il top vero evita che l'iniezione su una tab già aperta finisca nel vuoto.
export async function injectIntoActiveTab() {
  if (state.tabId == null) return;
  let frameIds = [0];
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId: state.tabId });
    const tops = (frames || []).filter((frame) => frame.parentFrameId === -1).map((frame) => frame.frameId);
    if (tops.length) frameIds = tops;
  } catch (e) {}
  chrome.scripting
    .executeScript({ target: { tabId: state.tabId, frameIds: frameIds }, files: ["scripts/gtmcode.js"], world: "MAIN" })
    .catch(() => {});
  chrome.scripting
    .executeScript({ target: { tabId: state.tabId, frameIds: frameIds }, files: ["scripts/bridge.js"] })
    .catch(() => {});
}

export function updateChip(chipEl) {
  const on = injector.on;
  const inDomain = on && hostMatches(state.tabHost, injector.domains);
  const injected = !!(state.session && state.session.gtmInjected);

  chipEl.classList.remove("chip-on", "chip-off", "chip-warn");
  // Visibile solo con l'injector acceso: da spento non serve ricordarlo nell'header.
  chipEl.classList.toggle("is-hidden", !on);
  if (!on) return;
  if (!injector.domains.length) {
    chipEl.textContent = "GTM Injector ON · nessun dominio";
    chipEl.classList.add("chip-warn");
    chipEl.title = "Aggiungi almeno un dominio nelle impostazioni";
    return;
  }
  if (!inDomain) {
    chipEl.textContent = "GTM Injector ON · fuori dominio";
    chipEl.classList.add("chip-warn");
    chipEl.title = "Injection attiva su: " + injector.domains.join(", ");
    return;
  }
  chipEl.textContent = injected ? "GTM Injector ON ✓" : "GTM Injector ON";
  chipEl.classList.add("chip-on");
  chipEl.title = injected ? "GTM iniettato su questa pagina" : "Injection attiva su " + state.tabHost;
}
