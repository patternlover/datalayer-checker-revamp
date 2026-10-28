import { $, parseDomains, gtmCodeWarning } from "./util.js";
import { state } from "./store.js";
import { injector, setOn, saveSettings } from "./injector.js";

let ctx;
let els;

export function init(context) {
  ctx = context;
  els = {
    card: $("#injector-card"),
    domains: $("#gtm-domains"),
    code: $("#gtm-code"),
    toggle: $("#injector-toggle"),
    save: $("#save-settings"),
    conflict: $("#container-conflict"),
  };
  bind();
  fillFields();
  initUiMode();
  showVersion();
  return { render };
}

// La versione serve a loro, non a noi: quando una segnalazione arriva, la prima domanda è
// "quale build hai caricato".
function showVersion() {
  const el = $("#app-version");
  if (!el) return;
  el.textContent = "v" + chrome.runtime.getManifest().version + " · uso interno";
}

// Modalità di apertura: finestra separata (default, anche Arc) o pannello laterale (Chrome).
async function initUiMode() {
  const radios = document.querySelectorAll('input[name="uimode"]');
  if (!chrome.sidePanel) $("#uimode-sidepanel").classList.add("is-hidden");
  const stored = await chrome.storage.local.get("dlcUiMode");
  const mode = stored.dlcUiMode === "sidepanel" ? "sidepanel" : "window";
  radios.forEach((radio) => {
    radio.checked = radio.value === mode;
    radio.addEventListener("change", async () => {
      if (!radio.checked) return;
      await chrome.storage.local.set({ dlcUiMode: radio.value });
      ctx.toast(radio.value === "sidepanel" ? "L'icona aprirà il pannello laterale" : "L'icona aprirà la finestra separata");
    });
  });
}

function bind() {
  els.toggle.addEventListener("change", async () => {
    const wantOn = els.toggle.checked;
    if (wantOn) {
      const parsed = parseDomains(els.domains.value);
      if (!parsed.list.length) {
        els.toggle.checked = false;
        ctx.toast(parsed.dropped ? "Domini non validi" : "Inserisci almeno un dominio");
        return;
      }
      injector.domains = parsed.list;
      els.domains.value = injector.domains.join(", ");
    }
    const result = await setOn(wantOn, els.code.value);
    if (!result.ok) {
      els.toggle.checked = false;
      if (result.reason === "no-code") ctx.toast("Incolla lo snippet del container");
      else ctx.toast(result.reason === "no-domains" ? "Inserisci almeno un dominio" : "Impossibile attivare");
    }
    render();
  });

  els.save.addEventListener("click", async () => {
    const result = await saveSettings({ code: els.code.value, domainsRaw: els.domains.value });
    fillFields();
    if (result.turnedOff) {
      ctx.toast("Injector disattivato: nessun dominio");
      return;
    }
    const warning = gtmCodeWarning(els.code.value);
    if (warning) {
      ctx.toast(warning);
      return;
    }
    ctx.toast(result.parsed.dropped ? "Salvato (domini non validi ignorati)" : "Impostazioni salvate");
  });
}

export function fillFields() {
  els.domains.value = injector.domains.join(", ");
  els.code.value = injector.code;
  els.toggle.checked = injector.on;
}

export function render() {
  els.card.classList.toggle("is-on", injector.on);
  // Sempre editabile: prima si incolla lo snippet e si scelgono i domini, poi si accende.
  els.toggle.checked = injector.on;

  const containers = state.session ? state.session.containers : null;
  const conflict = containers && containers.conflict;
  if (conflict) {
    els.conflict.classList.remove("is-hidden");
    els.conflict.textContent =
      "⚠ Conflitto: il container iniettato è già presente in pagina (" + containers.injected.join(", ") + ").";
  } else {
    els.conflict.classList.add("is-hidden");
    els.conflict.textContent = "";
  }
}
