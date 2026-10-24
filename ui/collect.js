import { $, el, formatTime, copyText, sheetCell, extractEventNames, highlightJson } from "./util.js";
import { state } from "./store.js";
import { collectKey, parseNames, matcher } from "../lib/collect.js";

let ctx;
let els;
let collection = null;
let loadedHost = null;
let clearArmed = null;
let lastKey = null;
const expanded = new Set();

export function init(context) {
  ctx = context;
  els = {
    input: $("#collect-input"),
    add: $("#collect-add"),
    parsed: $("#collect-parsed"),
    summary: $("#collect-summary"),
    bar: $("#collect-bar"),
    list: $("#collect-list"),
    copy: $("#collect-copy"),
    clear: $("#collect-clear"),
  };
  bind();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !host()) return;
    const change = changes[collectKey(host())];
    if (!change) return;
    collection = change.newValue || null;
    render();
  });
  return { render };
}

function host() {
  return state.target ? state.target.host : null;
}

function names() {
  return collection ? collection.names : [];
}

function setNames(list) {
  if (state.port) state.port.postMessage({ cmd: "collect-set", names: list });
}

function showParsed(text) {
  els.parsed.textContent = text || "";
  els.parsed.classList.toggle("is-hidden", !text);
}

function bind() {
  // Incollando la colonna "DataLayer TO BE" (con o senza intestazione) si estraggono
  // i nomi evento in ordine: il campo mostra il risultato, Invio/Aggiungi conferma.
  els.input.addEventListener("paste", (e) => {
    const text = e.clipboardData ? e.clipboardData.getData("text") : "";
    const found = extractEventNames(text);
    if (!found.length) return; // testo semplice: incolla normale
    e.preventDefault();
    els.input.value = found.join(", ");
    showParsed(found.length + " eventi trovati nel DataLayer incollato. Premi Invio o Aggiungi per confermare.");
    els.input.focus();
    els.input.select();
  });

  // Conferma: i nomi si aggiungono all'elenco esistente, in ordine.
  const add = () => {
    const typed = parseNames(els.input.value);
    els.input.value = "";
    showParsed("");
    if (!typed.length) return;
    const list = names().slice();
    let added = 0;
    typed.forEach((name) => {
      if (!list.includes(name)) {
        list.push(name);
        added += 1;
      }
    });
    setNames(list);
    ctx.toast(added ? added + " eventi aggiunti" : "Eventi gi\u00e0 presenti");
  };
  els.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      add();
    } else if (e.key === "Escape") {
      els.input.value = "";
      showParsed("");
    }
  });
  els.add.addEventListener("click", add);

  els.list.addEventListener("change", (e) => {
    const box = e.target.closest("input[type=checkbox]");
    if (!box || box.checked) return;
    expanded.delete(box.value);
    setNames(names().filter((name) => name !== box.value));
  });

  els.list.addEventListener("click", async (e) => {
    if (e.target.closest("input[type=checkbox]")) return;
    const copyBtn = e.target.closest("[data-copy]");
    if (copyBtn) {
      const item = latestByName().get(copyBtn.dataset.copy);
      if (!item) return;
      const ok = await copyText(sheetCell(item.data));
      ctx.toast(ok ? "Copiato " + item.name : "Copia non riuscita");
      return;
    }
    const head = e.target.closest("[data-toggle]");
    if (!head) return;
    const name = head.dataset.toggle;
    if (!latestByName().has(name)) return;
    if (expanded.has(name)) expanded.delete(name);
    else expanded.add(name);
    render();
  });

  els.copy.addEventListener("click", async () => {
    const rows = exportRows();
    if (!rows.length) return ctx.toast("Nessun evento raccolto");
    const ok = await copyText(rows.map((item) => sheetCell(item.data)).join("\n"));
    const missing = pendingNames().length;
    ctx.toast(ok ? rows.length + " eventi copiati" + (missing ? " \u00b7 " + missing + " in attesa" : "") : "Copia non riuscita");
  });

  // Azzera: doppio click di conferma. Svuota i DataLayer raccolti, l'elenco eventi resta.
  els.clear.addEventListener("click", () => {
    if (!clearArmed) {
      els.clear.textContent = "Confermi?";
      clearArmed = setTimeout(() => {
        clearArmed = null;
        els.clear.textContent = "Azzera";
      }, 3000);
      return;
    }
    clearTimeout(clearArmed);
    clearArmed = null;
    els.clear.textContent = "Azzera";
    expanded.clear();
    if (state.port) state.port.postMessage({ cmd: "collect-clear" });
    ctx.toast("DataLayer raccolti azzerati");
  });
}

async function ensureLoaded() {
  const h = host();
  if (h === loadedHost) return;
  loadedHost = h;
  collection = null;
  if (!h) return;
  const stored = await chrome.storage.local.get(collectKey(h));
  if (loadedHost !== h) return;
  collection = stored[collectKey(h)] || { host: h, names: [], items: [] };
  render();
}

function latestByName() {
  const latest = new Map();
  (collection ? collection.items : []).forEach((item) => latest.set(item.name, item));
  return latest;
}

// Nomi effettivi nell'ordine dell'elenco UAT; i pattern con * si espandono negli eventi catturati.
function resolvedNames() {
  const latest = latestByName();
  const out = [];
  names().forEach((name) => {
    if (!name.includes("*")) {
      if (!out.includes(name)) out.push(name);
      return;
    }
    const isMatch = matcher([name]);
    (collection ? collection.items : []).forEach((item) => {
      if (isMatch(item.name) && !out.includes(item.name) && latest.has(item.name)) out.push(item.name);
    });
  });
  return out;
}

function pendingNames() {
  const latest = latestByName();
  return resolvedNames().filter((name) => !latest.has(name));
}

// Per la copia: l'ultima occorrenza di ogni evento, nell'ordine dell'elenco UAT.
function exportRows() {
  const latest = latestByName();
  return resolvedNames()
    .map((name) => latest.get(name))
    .filter(Boolean);
}

export function render() {
  ensureLoaded();
  const h = host();
  els.input.disabled = !h;
  els.add.disabled = !h;
  els.copy.disabled = !h;
  els.clear.disabled = !h;
  if (!h) {
    els.summary.textContent = "Scegli prima la tab da testare.";
    els.list.innerHTML = "";
    lastKey = null;
    return;
  }

  const latest = latestByName();
  const counts = new Map();
  (collection ? collection.items : []).forEach((item) => counts.set(item.name, (counts.get(item.name) || 0) + 1));

  const list = names();
  const resolved = resolvedNames();
  const done = resolved.filter((name) => latest.has(name)).length;
  els.summary.textContent = list.length ? done + " di " + resolved.length + " raccolti" : "";
  els.summary.parentElement.classList.toggle("is-hidden", !list.length);
  els.bar.style.width = resolved.length ? Math.round((done / resolved.length) * 100) + "%" : "0";
  els.copy.disabled = done === 0;
  els.clear.disabled = !collection || !collection.items.length;

  // Ridisegno solo se cambia qualcosa di visibile; lo scroll del JSON aperto resta dov'è.
  const key = JSON.stringify([list, resolved, [...expanded], [...latest].map(([n, it]) => n + it.key), [...counts]]);
  if (key === lastKey) return;
  lastKey = key;
  const jsonScroll = {};
  els.list.querySelectorAll(".collect-json").forEach((pre) => (jsonScroll[pre.dataset.name] = pre.scrollTop));

  els.list.innerHTML = "";
  list.forEach((name) => {
    // Pattern con *: una riga per il pattern + una per ogni evento catturato che corrisponde.
    const rowNames = name.includes("*") ? [name].concat(resolved.filter((n) => matcher([name])(n))) : [name];
    rowNames.forEach((rowName, idx) => {
      const isPatternChild = idx > 0;
      const item = latest.get(rowName);
      const isOpen = !!item && expanded.has(rowName);
      const row = el("div", "collect-row " + (item ? "ok" : "pending") + (isPatternChild ? " child" : "") + (isOpen ? " open" : ""));
      const head = el("div", "collect-head");
      head.dataset.toggle = rowName;
      if (!isPatternChild) {
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = true;
        box.value = rowName;
        box.title = "Togli la spunta per rimuovere dall'UAT";
        head.appendChild(box);
      }
      head.appendChild(el("span", "uat-name", rowName));
      if (rowName.includes("*")) {
        head.appendChild(el("span", "uat-meta", "pattern"));
      } else if (item) {
        const where = item.frame === "pixel" ? "Pixel" : "Top";
        const n = counts.get(rowName) || 1;
        head.appendChild(el("span", "uat-meta", where + (n > 1 ? " \u00b7 " + n + "\u00d7" : "")));
        head.appendChild(el("span", "collect-status ok", "\u2713 " + formatTime(item.ts).slice(0, 8)));
        head.title = "Clicca per vedere il DataLayer";
      } else {
        head.appendChild(el("span", "collect-status", "in attesa"));
      }
      row.appendChild(head);
      // Dettaglio espanso: DataLayer + copia nel formato Sheets.
      if (isOpen) {
        const body = el("div", "collect-body");
        const copyBtn = el("button", "btn btn-quiet", "Copia");
        copyBtn.type = "button";
        copyBtn.dataset.copy = rowName;
        body.appendChild(copyBtn);
        const pre = el("pre", "json collect-json");
        pre.dataset.name = rowName;
        pre.innerHTML = highlightJson(item.data);
        body.appendChild(pre);
        row.appendChild(body);
      }
      els.list.appendChild(row);
    });
  });
  els.list.querySelectorAll(".collect-json").forEach((pre) => {
    if (jsonScroll[pre.dataset.name]) pre.scrollTop = jsonScroll[pre.dataset.name];
  });
}
