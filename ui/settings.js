import { $, parseDomains, gtmCodeWarning } from "./util.js";
import { state } from "./store.js";
import { injector, setOn, saveSettings, autoConfigure } from "./injector.js";

let ctx;
let els;

export function init(context) {
  ctx = context;
  els = {
    card: $("#injector-card"),
    domains: $("#gtm-domains"),
    code: $("#gtm-code"),
    toggle: $("#injector-toggle"),
    ta: $("#injector-ta"),
    invalid: $("#injector-invalid"),
    save: $("#save-settings"),
    conflict: $("#container-conflict"),
    mirrorToggle: $("#mirror-toggle"),
    mirrorScope: $("#mirror-scope"),
    mirrorNote: $("#mirror-note"),
    autoconfig: $("#injector-autoconfig"),
  };
  bind();
  bindAutoconfig();
  bindTagAssistant();
  bindMirror();
  fillFields();
  loadMirror();
  initUiMode();
  showVersion();
  return { render };
}

// ---------- Rispecchia pixel sul Top ----------
// Gli eventi del checkout vivono solo nel sandbox del Custom Pixel: il container del tema non li
// riceve. Il background li ripusha identici nel dataLayer del Top, dove Tag Assistant li legge.
const MIRROR_KEY = "pixelmirror";
const MIRROR_SCOPE_KEY = "pixelmirrorScope";
const MIRROR_SCOPES = ["solo-checkout", "sempre"];

const mirror = { on: false, scope: "solo-checkout" };

async function loadMirror() {
  const stored = await chrome.storage.sync.get([MIRROR_KEY, MIRROR_SCOPE_KEY]);
  mirror.on = stored[MIRROR_KEY] === true;
  mirror.scope = MIRROR_SCOPES.includes(stored[MIRROR_SCOPE_KEY]) ? stored[MIRROR_SCOPE_KEY] : "solo-checkout";
  els.mirrorToggle.checked = mirror.on;
  els.mirrorScope.value = mirror.scope;
  render();
}

function bindMirror() {
  els.mirrorToggle.addEventListener("change", async () => {
    mirror.on = els.mirrorToggle.checked;
    await chrome.storage.sync.set({ [MIRROR_KEY]: mirror.on });
    render();
    ctx.toast(mirror.on ? "Ponte acceso: eventi del pixel nel Top" : "Ponte spento");
  });
  els.mirrorScope.addEventListener("change", async () => {
    mirror.scope = MIRROR_SCOPES.includes(els.mirrorScope.value) ? els.mirrorScope.value : "solo-checkout";
    await chrome.storage.sync.set({ [MIRROR_SCOPE_KEY]: mirror.scope });
    ctx.toast(mirror.scope === "sempre" ? "Rispecchio su tutte le pagine" : "Rispecchio solo checkout e ordini");
  });
}

// La versione serve a loro, non a noi: quando una segnalazione arriva, la prima domanda è
// "quale build hai caricato".
function showVersion() {
  const el = $("#app-version");
  if (!el) return;
  el.textContent = "v" + chrome.runtime.getManifest().version + " · uso interno";
}

// Modalità di apertura: popup (default, come le altre estensioni), finestra separata
// (funziona anche su Arc) o pannello laterale (solo Chrome).
const UI_MODES = ["popup", "window", "sidepanel"];
const UI_MODE_LABELS = {
  popup: "L'icona aprirà il popup",
  window: "L'icona aprirà la finestra separata",
  sidepanel: "L'icona aprirà il pannello laterale",
};

async function initUiMode() {
  const radios = document.querySelectorAll('input[name="uimode"]');
  const note = $("#uimode-note");
  const reset = $("#uimode-reset");
  if (!chrome.sidePanel) $("#uimode-sidepanel").classList.add("is-hidden");
  const stored = await chrome.storage.local.get(["dlcUiMode", "dlcSidePanelBroken"]);
  // Le versioni fino alla 1.6 scrivevano solo "window"/"sidepanel": chi aveva scelto la
  // finestra resta sulla finestra, tutti gli altri passano al nuovo default, il popup.
  const mode = UI_MODES.includes(stored.dlcUiMode) ? stored.dlcUiMode : "popup";
  // Il pannello laterale è stato scelto ma il browser non lo mostra: il background lo ha
  // segnato e apre la finestra. Meglio dirlo che lasciare l'icona muta.
  const broken = stored.dlcSidePanelBroken === true;
  if (broken) {
    note.textContent =
      "Questo browser espone l'API del pannello laterale ma non lo mostra (Arc non lo supporta): l'icona apre la finestra separata. Al prossimo avvio si riprova il pannello da solo.";
    note.classList.remove("is-hidden");
  }
  reset.classList.toggle("is-hidden", mode === "popup");
  reset.addEventListener("click", async () => {
    await chrome.storage.local.set({ dlcUiMode: "popup" });
    radios.forEach((radio) => (radio.checked = radio.value === "popup"));
    reset.classList.add("is-hidden");
    ctx.toast(UI_MODE_LABELS.popup);
  });
  radios.forEach((radio) => {
    radio.checked = radio.value === mode;
    radio.addEventListener("change", async () => {
      if (!radio.checked) return;
      await chrome.storage.local.set({ dlcUiMode: radio.value });
      reset.classList.toggle("is-hidden", radio.value === "popup");
      ctx.toast(UI_MODE_LABELS[radio.value] || "Apertura aggiornata");
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
    // Salvare snippet e domini con l'interruttore spento è il modo più facile per credere di aver
    // configurato l'iniezione e non vedere niente in pagina: lo si dice qui.
    if (!injector.on) {
      ctx.toast("Salvato. L'Injector è spento: accendilo per iniettare");
      return;
    }
    ctx.toast(result.parsed.dropped ? "Salvato (domini non validi ignorati)" : "Impostazioni salvate");
  });
}

// gtm.js decide se è in debug da `gtm_debug` in query, referrer di tagassistant.google.com,
// cookie `__TAG_ASSISTANT` o l'attributo `data-tag-assistant-prod-present` su <html>.
// Sul checkout i primi tre non esistono: il container iniettato gira e non si collega alla
// preview, e Tag Assistant resta vuoto. Questa opzione mette l'attributo prima di iniettare.
const TA_KEY = "injectorTA";

async function bindTagAssistant() {
  if (!els.ta) return;
  const stored = await chrome.storage.sync.get([TA_KEY]);
  els.ta.checked = stored[TA_KEY] !== false;
  els.ta.addEventListener("change", async () => {
    await chrome.storage.sync.set({ [TA_KEY]: els.ta.checked });
    ctx.toast(els.ta.checked ? "Container iniettato in debug: la preview lo vede" : "Container iniettato senza debug");
  });
}

// Un click al posto di quattro campi, tre interruttori e un pin: il container si legge dalla pagina
// e chi lo usa non deve sapere in che forma va scritto.
function bindAutoconfig() {
  if (!els.autoconfig) return;
  els.autoconfig.addEventListener("click", async () => {
    if (state.tabId == null) {
      ctx.toast("Prima scegli la tab in test («Testa …» qui sopra)");
      return;
    }
    const result = await autoConfigure(state.tabId).catch(() => ({ ok: false, reason: "error" }));
    if (!result.ok) {
      ctx.toast(
        result.reason === "no-container"
          ? "Nessun container GTM in questa pagina: apri una pagina dello store dove il pixel o il tema lo caricano"
          : "Non riesco a configurare da questa pagina"
      );
      return;
    }
    await loadMirror();
    fillFields();
    render();
    ctx.toast("Configurato: " + result.id + " su " + result.host + " · Injector e ponte accesi");
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

  // Il container non è partito perché il campo non contiene né uno snippet né un ID GTM.
  if (els.invalid) {
    const bad = !!(state.session && state.session.gtmInvalid);
    els.invalid.classList.toggle("is-hidden", !bad);
    els.invalid.textContent = bad
      ? "⚠ Nel campo non c'è né uno snippet GTM né un ID (GTM-XXXX): incolla il blocco completo, il solo ID del container o il JavaScript da eseguire. Il container non è stato caricato."
      : "";
  }

  // Il ponte ha un costo che va detto prima di accenderlo in un sito vero: se lo stesso container
  // gira anche nel sandbox del pixel, i suoi tag partono una seconda volta sugli eventi
  // rispecchiati, e un purchase finisce doppio.
  const pixelIds = containers && Array.isArray(containers.pixel) ? containers.pixel : [];
  const injected = containers && Array.isArray(containers.injected) ? containers.injected : [];
  const twice = injected.filter((id) => pixelIds.includes(id));
  let note = "";
  if (mirror.on && !injector.on) {
    // Il caso più frequente: il ponte c'è, ma nel Top non gira nessun container, quindi Tag
    // Assistant non ha a cosa agganciarsi e la preview resta vuota (o si sgancia navigando).
    note =
      "⚠ Il ponte non ha un container nel Top: senza GTM Injector acceso la preview non può mostrare niente. Metti lo snippet in questa card e accendila.";
  } else if (mirror.on && twice.length) {
    note =
      "⚠ " + twice.join(", ") + " gira già nel pixel: rispecchiare qui lo fa partire due volte (un purchase risulterebbe doppio).";
  }
  els.mirrorNote.classList.toggle("is-hidden", !note);
  els.mirrorNote.textContent = note;
}
