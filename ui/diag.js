// "Stato della pagina": legge la pagina in world MAIN e mostra i fatti che decidono se il debug
// può funzionare. Serve a smettere di indovinare quando qualcosa non si vede: se il container non
// c'è, se non è in debug, o se manca il canale di Tag Assistant, qui è scritto.
import { $ } from "./util.js";
import { state } from "./store.js";

let els;
let ctx;
let last = null;

// Eseguita nella pagina. Deve essere autosufficiente: chrome.scripting serializza il testo.
function probePage() {
  var gtm = window.google_tag_manager || {};
  var ids = Object.keys(gtm).filter(function (k) {
    return /^(GTM|G|AW|DC|MC)-/.test(k);
  });
  var dl = Array.isArray(window.dataLayer) ? window.dataLayer : [];
  var events = dl
    .map(function (e) {
      return e && e.event;
    })
    .filter(Boolean);
  var sandboxes = [];
  var frames = document.querySelectorAll('iframe[src*="/custom/web-pixel-"], iframe[src*="/sandbox/"]');
  for (var i = 0; i < frames.length; i++) sandboxes.push(String(frames[i].src || "").slice(0, 160));
  return {
    url: location.href.slice(0, 220),
    browser: navigator.userAgent.slice(0, 130),
    injectorRan: !!window.__dlcGtmInjectedCode,
    containers: ids,
    taAttribute: document.documentElement.getAttribute("data-tag-assistant-prod-present"),
    taApi: typeof window.__TAG_ASSISTANT_API,
    debugQueue: Array.isArray(window["google.tagmanager.debugui2.queue"]),
    gtmDebugParam: new URLSearchParams(location.search).has("gtm_debug"),
    assistantCookie: document.cookie.indexOf("__TAG_ASSISTANT") !== -1,
    dataLayerCount: dl.length,
    checkoutEvents: events.filter(function (n) {
      return /checkout|payment_info|purchase/i.test(String(n));
    }),
    lastEvents: events.slice(-12),
    sandboxes: sandboxes,
  };
}

export function init(context) {
  ctx = context;
  els = {
    card: $("#diag-card"),
    run: $("#diag-run"),
    out: $("#diag-output"),
  };
  if (els.run) els.run.addEventListener("click", () => refresh());
  return { render, refresh };
}

export async function refresh() {
  if (!els || !els.out) return;
  if (state.tabId == null) {
    els.out.textContent = "Nessuna tab in test: premi prima «Testa …» qui sopra.";
    return;
  }
  els.out.textContent = "Leggo la pagina…";
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: state.tabId },
      world: "MAIN",
      func: probePage,
    });
    last = result && result.result;
    els.out.textContent = last ? format(last) : "La pagina non ha risposto.";
  } catch (error) {
    els.out.textContent =
      "Non riesco a leggere questa pagina: " + (error && error.message ? error.message : String(error));
  }
}

// Righe leggibili, con il verdetto sulle tre cose che contano davvero.
function format(p) {
  const lines = [];
  lines.push("url            " + p.url);
  lines.push("browser        " + p.browser);
  lines.push("");
  lines.push("container      " + (p.containers.length ? p.containers.join(", ") : "nessuno in pagina"));
  lines.push("injector       " + (p.injectorRan ? "ha iniettato su questa pagina" : "non ha iniettato (spento, dominio fuori, o snippet rifiutato)"));
  lines.push("debug TA       " + (p.taAttribute ? "attributo presente (" + p.taAttribute + ")" : "attributo assente"));
  lines.push("canale TA      " + (p.taApi === "object" ? "API della companion presente" : "API assente (senza Tag Assistant Companion il pannello non legge la tab)"));
  lines.push("coda debug     " + (p.debugQueue ? "presente" : "assente"));
  lines.push("gtm_debug      " + (p.gtmDebugParam ? "in URL" : "non in URL"));
  lines.push("cookie TA      " + (p.assistantCookie ? "__TAG_ASSISTANT presente" : "assente"));
  lines.push("dataLayer      " + p.dataLayerCount + " push");
  lines.push("eventi checkout " + (p.checkoutEvents.length ? p.checkoutEvents.join(", ") : "nessuno"));
  lines.push("sandbox pixel  " + (p.sandboxes.length ? p.sandboxes.length + " iframe" : "non trovato"));
  (p.sandboxes.length ? p.sandboxes : []).slice(0, 3).forEach((s) => lines.push("               " + s));
  if (p.lastEvents.length) {
    lines.push("");
    lines.push("ultimi eventi  " + p.lastEvents.join(", "));
  }
  return lines.join("\n");
}

export function render() {
  if (!els || !els.card) return;
  els.card.classList.toggle("is-hidden", false);
}
