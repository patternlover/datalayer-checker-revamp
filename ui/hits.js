import { $, eventLabel, formatTime, copyText, el } from "./util.js";
import { state, frameHits } from "./store.js";
import { initSplit } from "./split.js";

let ctx;
let els;
// Hit selezionata per ambiente (Top/Pixel), come per gli eventi.
const selectedHitIds = { top: null, pixel: null };
const frameKey = () => (state.frame === "pixel" ? "pixel" : "top");
const getSelectedHitId = () => selectedHitIds[frameKey()];
const setSelectedHitId = (id) => {
  selectedHitIds[frameKey()] = id;
};
let searchQuery = "";
const vendorFilter = new Set();
let onlyLinked = false;

// Nomi dei gruppi di parametri. I provider di Omnibug usano chiavi inglesi; qui si traducono le
// più comuni, le altre restano leggibili così come sono (prima lettera maiuscola).
const GROUP_NAMES = {
  general: "Generale",
  event: "Evento",
  events: "Eventi",
  ecommerce: "E-commerce",
  context: "Contesto",
  campaign: "Campagna",
  promo: "Promozioni",
  contentgroup: "Content Group",
  timing: "Timing",
  custom: "Dati evento",
  products: "Prodotti",
  other: "Altro",
};

export function init(context) {
  ctx = context;
  els = {
    list: $("#hits-list"),
    count: $("#hits-count"),
    search: $("#hits-search"),
    searchClear: $("#hits-search-clear"),
    chips: $("#vendor-chips"),
    view: $("#hits-view"),
    sidebar: $("#hits-view .events-sidebar"),
    split: $("#hits-split"),
    vendor: $("#hit-vendor"),
    name: $("#hit-name"),
    meta: $("#hit-meta"),
    empty: $("#hit-empty"),
    detail: $("#hit-detail"),
    fields: $("#hit-fields"),
    url: $("#hit-url"),
    copyCurl: $("#hit-copy-curl"),
    docs: $("#hit-docs"),
    correlation: $("#hit-correlation"),
  };
  bind();
  initSplit({ view: els.view, sidebar: els.sidebar, handle: els.split, key: "dlcHitsSplit" });
  return { render, selectHit };
}

function bind() {
  els.search.addEventListener("input", () => {
    searchQuery = els.search.value.trim().toLowerCase();
    els.searchClear.classList.toggle("is-hidden", !els.search.value);
    render();
  });

  els.search.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    els.search.value = "";
    searchQuery = "";
    els.searchClear.classList.add("is-hidden");
    render();
  });

  els.searchClear.addEventListener("click", () => {
    els.search.value = "";
    searchQuery = "";
    els.searchClear.classList.add("is-hidden");
    els.search.focus();
    render();
  });

  // pointerdown come nella lista eventi: se nel frattempo arrivano hit, il click non va perso.
  els.list.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const row = e.target.closest(".event-row");
    if (row) selectHit(Number(row.dataset.id));
  });
  els.list.addEventListener("click", (e) => {
    const row = e.target.closest(".event-row");
    if (row && e.detail === 0) selectHit(Number(row.dataset.id));
  });

  els.chips.addEventListener("click", (e) => {
    const chip = e.target.closest(".type-chip");
    if (!chip) return;
    if (chip.dataset.vendor === "__reset") {
      vendorFilter.clear();
      onlyLinked = false;
    } else if (chip.dataset.vendor === "__linked") {
      onlyLinked = !onlyLinked;
    } else {
      const id = chip.dataset.vendor;
      if (vendorFilter.has(id)) vendorFilter.delete(id);
      else vendorFilter.add(id);
    }
    render();
  });

  els.copyCurl.addEventListener("click", async () => {
    const hit = selectedHit();
    if (!hit) return;
    const ok = await copyText(curlOf(hit));
    ctx.toast(ok ? "Comando cURL copiato" : "Copia non riuscita");
  });

  els.url.addEventListener("click", async () => {
    const hit = selectedHit();
    if (!hit) return;
    const ok = await copyText(hit.url);
    ctx.toast(ok ? "URL copiato" : "Copia non riuscita");
  });

  // Il nome del parametro copia la chiave grezza (serve nel codice del sito), il valore copia il
  // valore. Con una selezione di testo attiva il click non copia: la si sta facendo a mano.
  els.fields.addEventListener("click", (e) => copyFromFields(e.target));
  els.fields.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (copyFromFields(e.target)) e.preventDefault();
  });
}

function copyFromFields(target) {
  const zone = target && target.closest ? target.closest(".kv-key, .kv-value") : null;
  if (!zone) return false;
  const selection = window.getSelection ? String(window.getSelection()) : "";
  if (selection.length) return false;
  const isKey = zone.classList.contains("kv-key");
  const text = isKey ? zone.dataset.key : zone.dataset.value;
  if (text == null) return false;
  copyText(text).then((ok) => {
    if (!ok) return ctx.toast("Copia non riuscita");
    ctx.toast(isKey ? "Parametro copiato: " + text : "Valore copiato: " + (text.length > 40 ? text.slice(0, 40) + "…" : text));
  });
  return true;
}

function curlOf(hit) {
  const lines = ["curl '" + hit.url + "'"];
  if (hit.postBody) {
    lines.push("-X " + (hit.method || "POST"));
    lines.push("--data-raw '" + String(hit.postBody).replace(/'/g, "'\\''") + "'");
  }
  return lines.join(" ");
}

export function selectHit(id) {
  setSelectedHitId(Number(id));
  render();
}

function selectedHit() {
  if (!state.session) return null;
  return frameHits().find((hit) => hit.id === getSelectedHitId()) || null;
}

// Le hit di versioni precedenti non hanno i campi decodificati: si mostrano comunque, partendo
// dai vecchi gruppi (params / userProps / ids).
function fieldsOf(hit) {
  if (Array.isArray(hit.fields)) return hit.fields;
  const out = [];
  const push = (obj, group) => {
    Object.keys(obj || {}).forEach((key) => out.push({ key: key, field: key, value: String(obj[key]), group: group }));
  };
  push(hit.params, "other");
  push(hit.userProps, "other");
  push(hit.ids, "general");
  return out;
}

function labelOf(hit) {
  return hit.requestType || hit.eventName || hit.path || "hit";
}

function hitMatches(hit) {
  if (vendorFilter.size && !vendorFilter.has(hit.vendor || "other")) return false;
  if (onlyLinked && !hit.eventIndex) return false;
  if (!searchQuery) return true;
  const hay = [hit.url, hit.eventName, hit.requestType, hit.vendorLabel, hit.account, hit.postBody]
    .concat(fieldsOf(hit).map((field) => field.key + " " + field.field + " " + field.value))
    .join(" ")
    .toLowerCase();
  return hay.indexOf(searchQuery) !== -1;
}

function statusLabel(hit) {
  if (hit.status === "pending") return "…";
  if (typeof hit.status === "number") return String(hit.status);
  if (hit.status === "error") return "errore";
  return String(hit.status || "");
}

export function render() {
  const session = state.session;
  const hits = frameHits();

  if (!hits.some((hit) => hit.id === getSelectedHitId())) {
    setSelectedHitId(hits.length ? hits[hits.length - 1].id : null);
  }

  renderVendorChips(hits);
  const filtered = hits.filter(hitMatches);
  // Il conteggio sta nella barra di ricerca (l'intestazione non ha spazio per altro).
  els.count.textContent = String(filtered.length);
  els.count.classList.toggle("is-filtered", filtered.length !== hits.length);
  els.count.classList.toggle("is-hidden", !hits.length);
  renderList(filtered, hits);
  renderDetail(session, hits);
}

function renderVendorChips(hits) {
  const counts = new Map();
  hits.forEach((hit) => {
    const id = hit.vendor || "other";
    const label = hit.vendorLabel || "Altro";
    if (!counts.has(id)) counts.set(id, { label: label, count: 0 });
    counts.get(id).count += 1;
  });

  els.chips.innerHTML = "";
  if (!counts.size) return;
  if (vendorFilter.size || onlyLinked) {
    const reset = el("button", "type-chip reset", "Reset");
    reset.type = "button";
    reset.dataset.vendor = "__reset";
    els.chips.appendChild(reset);
  }
  const linked = hits.filter((hit) => hit.eventIndex).length;
  if (linked && linked < hits.length) {
    const chip = el("button", "type-chip" + (onlyLinked ? " active" : ""));
    chip.type = "button";
    chip.dataset.vendor = "__linked";
    chip.title = "Mostra solo le hit collegate a un evento del dataLayer";
    chip.appendChild(el("span", "type-chip-label", "Collegate"));
    chip.appendChild(el("span", "type-chip-count", String(linked)));
    els.chips.appendChild(chip);
  }

  Array.from(counts.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .forEach(([id, info]) => {
      const chip = el("button", "type-chip" + (vendorFilter.has(id) ? " active" : ""));
      chip.type = "button";
      chip.dataset.vendor = id;
      chip.title = info.label;
      chip.appendChild(el("span", "type-chip-label", info.label));
      chip.appendChild(el("span", "type-chip-count", String(info.count)));
      els.chips.appendChild(chip);
    });
}

function renderList(filtered, allHits) {
  els.list.innerHTML = "";
  if (!filtered.length) {
    els.list.appendChild(el("div", "list-empty", allHits.length ? "Nessuna hit trovata" : "Nessuna hit"));
    return;
  }
  for (let i = filtered.length - 1; i >= 0; i--) {
    const hit = filtered[i];
    const row = document.createElement("button");
    row.type = "button";
    row.className = "event-row hit-row";
    row.dataset.id = hit.id;
    if (hit.id === getSelectedHitId()) row.classList.add("active");

    const vendor = el("span", "vendor-badge", hit.vendorLabel || "Altro");
    vendor.dataset.vendor = hit.vendor || "other";
    const name = el("span", "event-name", labelOf(hit));
    name.title = hit.url;
    row.appendChild(vendor);
    row.appendChild(name);
    if (hit.account) row.appendChild(el("span", "hit-account", hit.account));
    if (hit.eventIndex) row.appendChild(el("span", "event-hits", "#" + hit.eventIndex));
    row.appendChild(el("span", "event-meta", statusLabel(hit)));
    els.list.appendChild(row);
  }
  const activeRow = els.list.querySelector(".event-row.active");
  if (activeRow) activeRow.scrollIntoView({ block: "nearest" });
}

function renderDetail(session, hits) {
  const hit = selectedHit();
  els.docs.classList.add("is-hidden");
  els.copyCurl.classList.add("is-hidden");

  if (!hit) {
    els.detail.classList.add("is-hidden");
    els.empty.classList.remove("is-hidden");
    els.vendor.textContent = "";
    els.vendor.dataset.vendor = "";
    els.name.textContent = "Nessuna hit";
    els.meta.textContent = "";
    els.correlation.classList.add("is-hidden");
    els.correlation.innerHTML = "";
    els.empty.innerHTML = "";
    const heading = el("h3");
    const body = el("div", "empty-body");
    if (!session) {
      heading.textContent = "In attesa della sessione…";
      body.appendChild(el("p", null, state.target ? "Aggancio alla tab in test in corso…" : "Scegli prima la tab da testare («Testa questa tab»)."));
    } else if (!hits.length) {
      heading.textContent = "Nessuna hit";
      body.appendChild(
        el("p", null, "Qui compaiono le chiamate di GA4, Universal Analytics, GTM, Meta, TikTok, LinkedIn, Pinterest, Snapchat, Reddit, Microsoft Ads, Criteo, Hotjar e Clarity che partono dalla pagina.")
      );
    }
    els.empty.appendChild(heading);
    els.empty.appendChild(body);
    return;
  }

  els.empty.classList.add("is-hidden");
  els.detail.classList.remove("is-hidden");
  els.vendor.textContent = hit.vendorLabel || "Altro";
  els.vendor.dataset.vendor = hit.vendor || "other";
  els.name.textContent = labelOf(hit);
  els.name.title = hit.eventName ? "Evento: " + hit.eventName : "";
  els.meta.textContent = [formatTime(hit.ts), hit.method || "GET", statusLabel(hit)].filter(Boolean).join(" · ");
  els.url.textContent = hit.url;
  els.url.title = "Clic per copiare l'URL";
  els.copyCurl.classList.remove("is-hidden");
  if (hit.docs) {
    els.docs.href = hit.docs;
    els.docs.classList.remove("is-hidden");
  }

  renderFields(hit);

  if (hit.eventIndex && session) {
    const event = session.events.find((entry) => entry.i === hit.eventIndex) || null;
    els.correlation.classList.remove("is-hidden");
    els.correlation.innerHTML = "";
    els.correlation.appendChild(el("span", "detail-hits-label", "Probabile trigger"));
    const chip = el("button", "hit-chip", "Evento #" + hit.eventIndex + (event ? " · " + eventLabel(event.data) : ""));
    chip.type = "button";
    chip.title = "Apri l'evento associato (correlazione per tempistica)";
    chip.addEventListener("click", () => ctx.goToEvent(hit.eventIndex));
    els.correlation.appendChild(chip);
  } else {
    els.correlation.classList.add("is-hidden");
    els.correlation.innerHTML = "";
  }
}

// Parametri raggruppati come li raggruppa il vendor (Generale, Eventi, E-commerce, …): un hit
// GA4 con 40 parametri letti in fila non si legge, diviso per gruppi sì. La chiave grezza resta
// accanto al nome, in piccolo: serve quando si va a cercare il parametro nel codice del sito.
function renderFields(hit) {
  els.fields.innerHTML = "";
  const fields = fieldsOf(hit);
  if (!fields.length) {
    els.fields.appendChild(el("p", "kv-empty", "Nessun parametro da decodificare."));
    return;
  }
  const known = Array.isArray(hit.groups) ? hit.groups.map((group) => group.key) : [];
  const used = [];
  fields.forEach((field) => {
    const key = field.group || "other";
    if (used.indexOf(key) === -1) used.push(key);
  });
  const order = known.filter((key) => used.indexOf(key) !== -1).concat(used.filter((key) => known.indexOf(key) === -1));

  order.forEach((groupKey) => {
    const groupFields = fields.filter((field) => (field.group || "other") === groupKey);
    if (!groupFields.length) return;
    const section = el("section", "hit-group");
    section.appendChild(el("h4", "hit-group-title", groupName(hit, groupKey)));
    const table = el("table", "kv");
    groupFields.forEach((field) => {
      const row = document.createElement("tr");
      const name = el("td", "kv-key", field.field || field.key);
      name.dataset.key = field.key;
      name.title = "Copia il parametro: " + field.key;
      name.setAttribute("role", "button");
      name.tabIndex = 0;
      const value = el("td", "kv-value", field.value);
      value.dataset.value = field.value;
      value.title = "Copia il valore";
      value.setAttribute("role", "button");
      value.tabIndex = 0;
      row.appendChild(name);
      row.appendChild(value);
      table.appendChild(row);
    });
    section.appendChild(table);
    els.fields.appendChild(section);
  });
}

function groupName(hit, key) {
  if (GROUP_NAMES[key]) return GROUP_NAMES[key];
  const declared = Array.isArray(hit.groups) ? hit.groups.find((group) => group.key === key) : null;
  if (declared && declared.name) return declared.name;
  return key.charAt(0).toUpperCase() + key.slice(1);
}
