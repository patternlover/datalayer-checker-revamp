import { $, eventLabel, formatTime, copyText, pathnameOf, el, sheetCell, highlightJson } from "./util.js";
import { state, frameEvents } from "./store.js";

let ctx;
let els;
let searchQuery = "";

// Selezione indipendente per ambiente: passando da Top a Pixel e ritorno
// si ritrova esattamente l'evento che si stava guardando.
const viewState = {
  top: { selected: -1, follow: true },
  pixel: { selected: -1, follow: true },
};

function vs() {
  return viewState[state.frame === "pixel" ? "pixel" : "top"];
}

function uiKey() {
  return "ui:" + state.tabId;
}

// Persistenza tra aperture del popup (chrome.storage.session: vive finché il browser è aperto).
export async function restore() {
  if (state.tabId == null) return;
  try {
    const stored = await chrome.storage.session.get(uiKey());
    const saved = stored[uiKey()];
    if (!saved) return;
    ["top", "pixel"].forEach((frame) => {
      if (saved[frame] && typeof saved[frame].selected === "number") {
        viewState[frame].selected = saved[frame].selected;
        viewState[frame].follow = saved[frame].follow !== false;
        viewState[frame].restored = true;
      }
    });
  } catch (e) {}
}

function persistViewState() {
  if (state.tabId == null) return;
  chrome.storage.session.set({ [uiKey()]: viewState }).catch(() => {});
}

export function init(context) {
  ctx = context;
  els = {
    list: $("#events-list"),
    count: $("#events-count"),
    search: $("#events-search"),
    searchClear: $("#search-clear"),
    detailIndex: $("#detail-index"),
    detailName: $("#detail-name"),
    detailTime: $("#detail-time"),
    detailJson: $("#detail-json"),
    detailBody: $("#detail-body"),
    detailHits: $("#detail-hits"),
    emptyState: $("#empty-state"),
    copyBtn: $("#copy-push"),
    containers: $("#containers-strip"),
  };
  bind();
  return { render, selectEvent };
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

  // Selezione su pointerdown: se nel frattempo arrivano eventi e la lista si aggiorna,
  // il click non va perso. "click" resta per la tastiera (Invio/Spazio).
  els.list.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const row = e.target.closest(".event-row");
    if (row) selectEvent(Number(row.dataset.index));
  });
  els.list.addEventListener("click", (e) => {
    const row = e.target.closest(".event-row");
    if (row && e.detail === 0) selectEvent(Number(row.dataset.index));
  });

  els.copyBtn.addEventListener("click", async () => {
    const entry = selectedEntry();
    if (!entry) return;
    // Stesso formato della Copia UAT: incollabile direttamente in una cella di Sheets.
    const ok = await copyText(sheetCell(entry.data));
    ctx.toast(ok ? "Copiato per Sheets" : "Copia non riuscita");
  });
}

export function selectEvent(index, opts) {
  const target = Number(index);
  if (opts && opts.reveal) revealSelected = true;
  const entry = state.session ? state.session.events.find((e) => e.i === target) : null;
  if (entry && entry.frame && entry.frame !== state.frame && ctx.setFrame) ctx.setFrame(entry.frame, { silent: true });
  const view = vs();
  const events = frameEvents();
  view.selected = target;
  // Selezionare l'evento più recente riattiva l'auto-follow dei nuovi eventi.
  view.follow = events.length > 0 && events[events.length - 1].i === target;
  persistViewState();
  render();
}

function selectedEntry() {
  const view = vs();
  return frameEvents().find((entry) => entry.i === view.selected) || null;
}

function matches(entry) {
  if (!searchQuery) return true;
  const hay = (eventLabel(entry.data) + " " + JSON.stringify(entry.data)).toLowerCase();
  return hay.indexOf(searchQuery) !== -1;
}

export function render() {
  const session = state.session;
  const events = frameEvents();
  const view = vs();

  // Selezione ripresa da un'apertura precedente: vale solo se si è ancora sulla stessa pagina.
  // Dopo una navigazione si torna a seguire l'evento più recente.
  if (view.restored && events.length) {
    view.restored = false;
    const prev = events.find((entry) => entry.i === view.selected);
    if (!prev || prev.navId !== events[events.length - 1].navId) view.follow = true;
  }

  if (view.follow && events.length) {
    view.selected = events[events.length - 1].i;
  }

  renderContainers(session);
  renderList(session, events);
  renderDetail(session);
}

function renderContainers(session) {
  const containers = session ? session.containers : null;
  const page = containers ? containers.page : [];
  const injected = containers ? containers.injected : [];
  // Visibile solo quando serve: container iniettato già presente in pagina (iniezione doppia).
  if (!containers || !containers.conflict) {
    els.containers.classList.add("is-hidden");
    els.containers.innerHTML = "";
    return;
  }
  els.containers.classList.remove("is-hidden");
  els.containers.innerHTML = "";
  els.containers.appendChild(el("span", "containers-label", "Container"));
  injected.forEach((id) => {
    const badge = el("span", "container-badge" + (page.includes(id) ? " warn" : ""), id + " · iniettato");
    els.containers.appendChild(badge);
  });
  page.forEach((id) => {
    const badge = el("span", "container-badge" + (injected.includes(id) ? " warn" : ""), id + " · pagina");
    els.containers.appendChild(badge);
  });
  if (containers.conflict) {
    els.containers.appendChild(el("span", "container-warn", "già presente nel sito: l'injector non lo carica una seconda volta"));
  }
}

// Riga "ancora": la prima visibile in alto. Dopo la ricostruzione della lista viene rimessa
// esattamente dov'era, così gli eventi che arrivano in cima non spostano ciò che si sta leggendo.
function captureAnchor() {
  const list = els.list;
  if (list.scrollTop <= 0) return null;
  const top = list.getBoundingClientRect().top;
  for (const row of list.querySelectorAll(".event-row")) {
    const rect = row.getBoundingClientRect();
    if (rect.bottom > top) return { index: row.dataset.index, offset: rect.top - top, scrollTop: list.scrollTop };
  }
  return { index: null, offset: 0, scrollTop: list.scrollTop };
}

function restoreAnchor(anchor) {
  const list = els.list;
  if (!anchor) return;
  const row = anchor.index != null ? list.querySelector('.event-row[data-index="' + anchor.index + '"]') : null;
  if (!row) {
    list.scrollTop = anchor.scrollTop;
    return;
  }
  const top = list.getBoundingClientRect().top;
  list.scrollTop += row.getBoundingClientRect().top - top - anchor.offset;
}

let revealSelected = true;
let lastListKey = null;
let lastListFrame = null;

function renderList(session, events) {
  const filtered = events.filter(matches);
  els.count.textContent = searchQuery ? filtered.length + "/" + events.length : String(events.length);

  const gap = currentPageGap(session, events);

  // Stessi eventi di prima: si aggiorna solo la riga attiva, senza ricostruire la lista.
  const key =
    state.frame + "|" + searchQuery + "|" + (gap ? gap.marker.navId + ":" + gap.otherCount : "") + "|" + filtered.map((e) => e.i + ":" + e.navId).join(",");
  if (key === lastListKey && els.list.childElementCount) {
    const selected = String(vs().selected);
    els.list.querySelectorAll(".event-row").forEach((row) => row.classList.toggle("active", row.dataset.index === selected));
    revealActive();
    return;
  }
  lastListKey = key;

  // Cambio Top/Pixel: è un'altra lista, si riparte dalla riga selezionata di quell'ambiente.
  const frameChanged = lastListFrame !== state.frame;
  lastListFrame = state.frame;
  const anchor = frameChanged ? null : captureAnchor();
  if (frameChanged) revealSelected = true;
  els.list.innerHTML = "";

  if (!events.length) return;
  if (!filtered.length) {
    els.list.appendChild(el("div", "list-empty", "Nessun evento trovato"));
    return;
  }

  if (gap) els.list.appendChild(pageGapNotice(gap));

  let currentNavId = null;
  for (let idx = filtered.length - 1; idx >= 0; idx--) {
    const entry = filtered[idx];
    if (entry.navId !== currentNavId) {
      currentNavId = entry.navId;
      els.list.appendChild(navDivider(session, entry.navId));
    }
    els.list.appendChild(eventRow(entry));
  }

  restoreAnchor(anchor);
  revealActive();
}

// Si scorre fino alla riga selezionata solo quando la selezione arriva da fuori (es. un link
// o la prima apertura), mai a ogni aggiornamento: altrimenti la lista "tira" mentre si scorre.
function revealActive() {
  if (!revealSelected) return;
  revealSelected = false;
  const activeRow = els.list.querySelector(".event-row.active");
  if (activeRow) activeRow.scrollIntoView({ block: "nearest" });
}

// Pagina corrente senza eventi nell'ambiente selezionato (es. checkout Shopify: il Top non ha
// dataLayer, tutto passa dal Custom Pixel). Senza avviso la lista mostrerebbe in cima gli eventi
// della pagina precedente e sembrerebbe che non sia successo nulla.
function currentPageGap(session, events) {
  if (!session || !Array.isArray(session.nav) || !session.nav.length || searchQuery) return null;
  const navigations = session.nav.filter((m) => m.type === "navigate");
  const marker = navigations[navigations.length - 1];
  if (!marker) return null;
  // Dalla navigazione corrente in poi (incluse le eventuali navigazioni SPA successive).
  const fromNav = marker.navId;
  if (events.some((e) => e.navId >= fromNav)) return null;
  const other = state.frame === "pixel" ? "top" : "pixel";
  const otherCount = frameEvents(other).filter((e) => e.navId >= fromNav).length;
  return { marker, other, otherCount };
}

function pageGapNotice(gap) {
  const wrap = el("div", "page-gap");
  const head = el("div", "nav-divider");
  head.appendChild(el("span", "nav-divider-label", "#" + gap.marker.navId + " · Pagina attuale"));
  if (gap.marker.url) {
    head.title = gap.marker.url;
    head.appendChild(el("span", "nav-divider-url", pathnameOf(gap.marker.url)));
  }
  wrap.appendChild(head);
  const note = el("div", "page-gap-note");
  const here = state.frame === "pixel" ? "Pixel" : "Top";
  const there = gap.other === "pixel" ? "Pixel" : "Top";
  const isCheckout = /\/checkouts?\//.test(gap.marker.url || "");
  let text = "Nessun evento in " + here + " su questa pagina.";
  if (isCheckout && state.frame === "top") text = "Nel checkout Shopify la pagina non ha dataLayer: gli eventi passano dal Custom Pixel.";
  note.appendChild(el("span", null, text));
  if (gap.otherCount) {
    const btn = el("button", "btn btn-quiet", "Vedi " + gap.otherCount + " in " + there);
    btn.type = "button";
    btn.addEventListener("click", () => ctx.setFrame(gap.other));
    note.appendChild(btn);
  }
  wrap.appendChild(note);
  return wrap;
}

function eventRow(entry) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "event-row";
  row.dataset.index = entry.i;
  if (entry.i === vs().selected) row.classList.add("active");

  // Eventi di sistema (gtm.*, messaggi senza event) in tono minore: risaltano quelli di business.
  const name = entry.data && typeof entry.data.event === "string" ? entry.data.event : "";
  if (!name || name.startsWith("gtm.")) row.classList.add("is-system");
  row.appendChild(el("span", "event-num", String(entry.i)));
  row.appendChild(el("span", "event-name", eventLabel(entry.data)));
  row.appendChild(el("span", "event-time", formatTime(entry.ts).slice(0, 8)));
  if ((entry.hits || []).length) {
    const hitsBadge = el("span", "event-hits", entry.hits.length + " hit");
    hitsBadge.title = entry.hits.length + " hit correlate (probabile)";
    row.appendChild(hitsBadge);
  }
  return row;
}

function navDivider(session, navId) {
  const marker = session && session.nav ? session.nav.find((m) => m.navId === navId) : null;
  const label = marker && marker.type === "spa" ? "Navigazione SPA" : "Navigazione";
  const wrap = el("div", "nav-divider");
  wrap.appendChild(el("span", "nav-divider-label", "#" + navId + " · " + label));
  if (marker && marker.url) {
    wrap.title = marker.url;
    wrap.appendChild(el("span", "nav-divider-url", pathnameOf(marker.url)));
  }
  return wrap;
}

function renderDetail(session) {
  const view = vs();
  const events = frameEvents();
  let entry = selectedEntry();
  if (!entry && events.length) {
    // Evento selezionato non più presente (trim/clear): ripiega sul più recente senza perdere lo stato dell'altro ambiente.
    view.selected = events[events.length - 1].i;
    entry = selectedEntry();
  }

  if (!entry) {
    view.follow = true;
    els.detailIndex.textContent = "–";
    els.detailName.textContent = "Nessun evento";
    els.detailTime.textContent = "";
    els.detailJson.textContent = "";
    delete els.detailJson.dataset.entry;
    els.detailJson.classList.add("is-hidden");
    els.detailHits.classList.add("is-hidden");
    els.detailHits.innerHTML = "";
    els.copyBtn.classList.add("is-hidden");
    renderEmpty(session);
    return;
  }

  els.emptyState.classList.add("is-hidden");
  els.detailIndex.textContent = entry.i;
  els.detailName.textContent = eventLabel(entry.data);
  els.detailTime.textContent = formatTime(entry.ts);
  els.detailTime.title = entry.url || "";
  // Il JSON si ridisegna solo se cambia evento: lo scroll del dettaglio resta dov'è.
  if (els.detailJson.dataset.entry !== String(entry.i)) {
    els.detailJson.innerHTML = highlightJson(entry.data);
    els.detailJson.dataset.entry = String(entry.i);
    els.detailBody.scrollTop = 0;
  }
  els.detailJson.classList.remove("is-hidden");
  els.copyBtn.classList.remove("is-hidden");
  renderDetailHits(session, entry);
}

function renderDetailHits(session, entry) {
  // Le hit che link() ha collegato a questo evento: la correlazione e' una finestra di 1,5 s
  // sullo stesso frame, quindi si dice "probabile" e si mostra l'URL al click, senza fingere
  // che sia un dato certo.
  const ids = new Set(Array.isArray(entry.hits) ? entry.hits : []);
  const hits = ids.size ? (session.hits || []).filter((hit) => ids.has(hit.id)) : [];
  if (!hits.length) {
    els.detailHits.classList.add("is-hidden");
    els.detailHits.innerHTML = "";
    return;
  }
  els.detailHits.classList.remove("is-hidden");
  els.detailHits.innerHTML = "";
  els.detailHits.appendChild(el("span", "detail-hits-label", "Hit correlate"));
  hits.forEach((hit) => {
    const chip = el(
      "button",
      "hit-chip",
      (hit.vendorLabel || "hit") + (hit.eventName ? " · " + hit.eventName : "") + " · " + formatTime(hit.ts).slice(0, 8)
    );
    chip.type = "button";
    chip.title = "Correlazione probabile (stesso frame, entro 1,5 s). Click: copia l'URL della hit.\n" + (hit.url || "");
    chip.addEventListener("click", async () => {
      const ok = await copyText(hit.url || "");
      ctx.toast(ok ? "URL della hit copiato" : "Copia non riuscita");
    });
    els.detailHits.appendChild(chip);
  });
}

function renderEmpty(session) {
  els.emptyState.classList.remove("is-hidden");
  const heading = el("h3");
  const body = el("div", "empty-body");
  if (!state.target) {
    heading.textContent = "Scegli il sito da testare";
    body.appendChild(el("p", null, state.active.host
      ? "Premi «Testa " + state.active.host + "» qui sopra. Resta agganciato anche quando lavori su altre tab."
      : "Apri il sito in una tab: qui sopra comparirà il pulsante per testarlo."));
  } else if (state.tabId == null) {
    heading.textContent = "Tab di " + state.target.host + " chiusa";
    body.appendChild(el("p", null, "Riapri " + state.target.host + ": verrà riagganciata in automatico, con lo storico raccolto finora."));
  } else if (!session) {
    heading.textContent = "Aggancio in corso…";
    body.appendChild(el("p", null, "Avvio della cattura sulla tab in test."));
  } else if (!frameEvents().length) {
    const other = state.frame === "pixel" ? "top" : "pixel";
    const otherCount = frameEvents(other).length;
    if (state.frame === "pixel") {
      heading.textContent = "Nessun evento dal Pixel";
      body.appendChild(el("p", null, "Compariranno qui appena un Custom Pixel di Shopify scrive nel suo dataLayer."));
    } else if (/\/checkouts?\//.test(state.tabUrl || "")) {
      heading.textContent = "Nessun evento in Top";
      body.appendChild(el("p", null, "Nel checkout Shopify la pagina non ha dataLayer: gli eventi passano dal Custom Pixel."));
    } else {
      heading.textContent = "In attesa di eventi";
      body.appendChild(el("p", null, "Naviga sul sito: ogni push nel dataLayer compare qui in tempo reale."));
    }
    if (otherCount) {
      const btn = el("button", "btn btn-quiet", "Vedi " + otherCount + " in " + (other === "pixel" ? "Pixel" : "Top"));
      btn.type = "button";
      btn.style.marginTop = "10px";
      btn.addEventListener("click", () => ctx.setFrame(other));
      body.appendChild(btn);
    }
    if (!session.active) body.appendChild(el("p", null, "Il debug è in pausa."));
  }
  els.emptyState.innerHTML = "";
  els.emptyState.appendChild(heading);
  els.emptyState.appendChild(body);
}
