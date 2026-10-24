import { $, eventLabel, formatTime, copyText, el } from "./util.js";
import { state, frameHits } from "./store.js";

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
let vendorFilter = new Set();

export function init(context) {
  ctx = context;
  els = {
    list: $("#hits-list"),
    count: $("#hits-total"),
    search: $("#hits-search"),
    searchClear: $("#hits-search-clear"),
    chips: $("#vendor-chips"),
    vendor: $("#hit-vendor"),
    name: $("#hit-name"),
    hitMeta: $("#hit-meta"),
    body: $("#hit-body"),
    empty: $("#hit-empty"),
    detail: $("#hit-detail"),
    params: $("#hit-params"),
    userProps: $("#hit-userprops"),
    ids: $("#hit-ids"),
    url: $("#hit-url"),
    copyUrl: $("#hit-copy-url"),
    correlation: $("#hit-correlation"),
  };
  bind();
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

  els.list.addEventListener("click", (e) => {
    const row = e.target.closest(".event-row");
    if (!row) return;
    selectHit(Number(row.dataset.id));
  });

  els.chips.addEventListener("click", (e) => {
    const chip = e.target.closest(".type-chip");
    if (!chip) return;
    if (chip.dataset.vendor === "__reset") {
      vendorFilter.clear();
    } else {
      const id = chip.dataset.vendor;
      if (vendorFilter.has(id)) vendorFilter.delete(id);
      else vendorFilter.add(id);
    }
    render();
  });

  els.copyUrl.addEventListener("click", async () => {
    const hit = selectedHit();
    if (!hit) return;
    const ok = await copyText(hit.url);
    ctx.toast(ok ? "URL copiato!" : "Copia non riuscita");
  });
}

export function selectHit(id) {
  setSelectedHitId(Number(id));
  render();
}

function selectedHit() {
  const session = state.session;
  if (!session) return null;
  return frameHits().find((hit) => hit.id === getSelectedHitId()) || null;
}

function hitMatches(hit) {
  if (vendorFilter.size && !vendorFilter.has(hit.vendor || "other")) return false;
  if (searchQuery) {
    const hay = [
      hit.url,
      hit.eventName,
      hit.vendorLabel,
      hit.path,
      JSON.stringify(hit.params || {}),
      JSON.stringify(hit.userProps || {}),
      JSON.stringify(hit.ids || {}),
    ]
      .join(" ")
      .toLowerCase();
    if (hay.indexOf(searchQuery) === -1) return false;
  }
  return true;
}

function statusLabel(hit) {
  if (hit.status === "pending") return "…";
  if (typeof hit.status === "number") return String(hit.status);
  if (hit.status === "error") return "errore";
  return String(hit.status || "");
}

export function render() {
  const session = state.session;
  const allHits = frameHits();
  const hits = allHits.filter((hit) => hit.eventIndex);

  if (!hits.some((hit) => hit.id === getSelectedHitId())) {
    setSelectedHitId(hits.length ? hits[hits.length - 1].id : null);
  }

  renderVendorChips(hits);
  const filtered = hits.filter(hitMatches);
  const filtering = !!searchQuery || vendorFilter.size > 0;
  els.count.textContent = filtering ? filtered.length + "/" + hits.length : String(hits.length);
  renderList(filtered, hits);
  renderDetail(session, hits, allHits);
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
  if (vendorFilter.size) {
    const reset = el("button", "type-chip reset", "Reset");
    reset.type = "button";
    reset.dataset.vendor = "__reset";
    els.chips.appendChild(reset);
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
    els.list.appendChild(el("div", "list-empty", allHits.length ? "Nessuna hit trovata" : "Nessuna hit correlata"));
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
    const name = el("span", "event-name", hit.eventName || hit.path || "hit");
    name.title = hit.url;
    row.appendChild(vendor);
    row.appendChild(name);
    if (hit.eventIndex) row.appendChild(el("span", "event-hits", "#" + hit.eventIndex));
    row.appendChild(el("span", "event-meta", statusLabel(hit)));
    els.list.appendChild(row);
  }
  const activeRow = els.list.querySelector(".event-row.active");
  if (activeRow) activeRow.scrollIntoView({ block: "nearest" });
}

function renderDetail(session, hits, allHits) {
  const hit = selectedHit();
  if (!hit) {
    els.detail.classList.add("is-hidden");
    els.empty.classList.remove("is-hidden");
    els.vendor.textContent = "–";
    els.vendor.dataset.vendor = "";
    els.name.textContent = "Nessuna hit";
    els.hitMeta.textContent = "";
    els.correlation.classList.add("is-hidden");
    els.correlation.innerHTML = "";
    els.empty.innerHTML = "";
    const heading = el("h3");
    const body = el("div", "empty-body");
    if (!session) {
      heading.textContent = "In attesa della sessione…";
      body.appendChild(el("p", null, state.target ? "Aggancio alla tab in test in corso…" : "Scegli prima la tab da testare («Testa questa tab»)."));
    } else if (!hits.length) {
      heading.textContent = "Nessuna hit correlata a eventi";
      if (allHits.length) {
        body.appendChild(el("p", null, "Le chiamate di tracking non collegate a eventi dataLayer sono nascoste."));
      } else {
        body.appendChild(el("p", null, "Qui compaiono solo le chiamate di GA4/GTM, Meta, TikTok, LinkedIn, Pinterest, Hotjar e Clarity agganciate a un evento."));
      }
    }
    els.empty.appendChild(heading);
    els.empty.appendChild(body);
    return;
  }

  els.empty.classList.add("is-hidden");
  els.detail.classList.remove("is-hidden");
  els.vendor.textContent = hit.vendorLabel || "Altro";
  els.vendor.dataset.vendor = hit.vendor || "other";
  els.name.textContent = hit.eventName || hit.path || "hit";
  els.name.title = hit.url;
  els.hitMeta.textContent = formatTime(hit.ts) + " · " + statusLabel(hit) + " · frame " + hit.frameId;

  fillTable(els.params, hit.params || {});
  fillTable(els.userProps, hit.userProps || {});
  fillTable(els.ids, hit.ids || {});
  els.url.textContent = hit.url;

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

function fillTable(tableEl, obj) {
  tableEl.innerHTML = "";
  const keys = Object.keys(obj);
  if (!keys.length) {
    const row = document.createElement("tr");
    const cell = el("td", "kv-empty", "–");
    cell.colSpan = 2;
    row.appendChild(cell);
    tableEl.appendChild(row);
    return;
  }
  keys.forEach((key) => {
    const row = document.createElement("tr");
    row.appendChild(el("td", "kv-key", key));
    row.appendChild(el("td", "kv-value", String(obj[key])));
    tableEl.appendChild(row);
  });
}
