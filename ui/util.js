import { eventNameOf } from "../lib/event-name.js";

export { eventNameOf };

export const $ = (selector, root) => (root || document).querySelector(selector);

export const EVENT_LABELS = {
  "gtm.init_consent": "Consent Initialization",
  "gtm.init": "Initialization",
  "gtm.js": "Container Loaded",
  "gtm.dom": "DOM Ready",
  "gtm.load": "Window Loaded",
  "gtm.scrollDepth": "Scroll Depth",
  "gtm.timer": "Timer",
  "gtm.elementVisibility": "Element Visibility",
  "gtm.click": "Click",
  "gtm.linkClick": "Link Click",
  "gtm.formSubmit": "Form Submit",
  "gtm.formStart": "Form Start",
  "gtm.video": "YouTube Video",
  "gtm.historyChange": "History",
  "gtm.triggerGroup": "Trigger Group",
  "gtm.pageError": "JavaScript Error",
};

export function eventLabel(data) {
  const name = eventNameOf(data);
  if (name) return EVENT_LABELS[name] || name;
  // Push senza event (variabili di pagina, messaggi): stesso nome neutro di sempre.
  return "Message";
}

// Ambiente di provenienza di un evento/hit: "top" o "pixel" (sessioni legacy: dedotto da frameId).
export function frameOf(item) {
  if (!item) return "top";
  if (item.frame === "top" || item.frame === "pixel") return item.frame;
  return item.frameId === 0 || item.frameId == null ? "top" : "pixel";
}

export function hostnameOf(url) {
  try {
    return new URL(url).hostname || null;
  } catch (e) {
    return null;
  }
}

export function pathnameOf(url) {
  try {
    const parsed = new URL(url);
    return parsed.pathname + parsed.search;
  } catch (e) {
    return url;
  }
}

export function parseDomains(raw) {
  const tokens = String(raw || "")
    .split(/[\s,;]+/)
    .map((token) => token.trim())
    .filter(Boolean);
  const list = [];
  let dropped = 0;
  tokens.forEach((token) => {
    const value = token
      .toLowerCase()
      .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
      .replace(/\/.*$/, "")
      .replace(/:\d+$/, "")
      .replace(/\.+$/, "");
    const valid = value && /^[a-z0-9.-]+$/.test(value) && (value.indexOf(".") !== -1 || value === "localhost");
    if (!valid) {
      dropped++;
      return;
    }
    if (list.indexOf(value) === -1) list.push(value);
  });
  return { list: list, dropped: dropped };
}

export function hostMatches(host, list) {
  if (!host || !Array.isArray(list)) return false;
  return list.some((domain) => host === domain || host.endsWith("." + domain));
}

export function formatTime(ts) {
  if (!ts) return "–";
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return hh + ":" + mm + ":" + ss + "." + ms;
}

export function pathGet(obj, path) {
  return String(path)
    .split(".")
    .reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch (e) {
    return false;
  }
}

export function downloadJson(filename, data) {
  try {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  } catch (e) {
    return false;
  }
}

// Chiavi in ordine alfabetico (ricorsivo), con "event" sempre per primo al livello radice.
function orderedForSheet(value, top) {
  if (Array.isArray(value)) return value.map((v) => orderedForSheet(v, false));
  if (!value || typeof value !== "object") return value;
  const keys = Object.keys(value).sort();
  if (top && keys.includes("event")) {
    keys.splice(keys.indexOf("event"), 1);
    keys.unshift("event");
  }
  const out = {};
  keys.forEach((key) => (out[key] = orderedForSheet(value[key], false)));
  return out;
}

// Una cella di Google Sheets: JSON indentato tra virgolette, virgolette interne raddoppiate.
export function sheetCell(data) {
  return '"' + JSON.stringify(orderedForSheet(data, true), null, 2).replace(/"/g, '""') + '"';
}

// Estrae i nomi evento, in ordine e senza duplicati, da testo libero: colonna "DataLayer TO BE"
// copiata da Sheets (con o senza intestazione), dataLayer.push(...), JSON o lista separata da virgole.
export function extractEventNames(text) {
  const raw = String(text || "");
  const names = [];
  const add = (name) => {
    const clean = String(name || "").trim();
    if (clean && !names.includes(clean)) names.push(clean);
  };
  // event: "x" | "event": "x" | event: ""x"" (celle Sheets) | event: 'x'
  const re = /(?:^|[^A-Za-z0-9_.$])["']{0,2}event["']{0,2}\s*:\s*["'`]{1,2}([^"'`\s,}]+)["'`]{1,2}/g;
  let match;
  while ((match = re.exec(raw))) add(match[1]);
  return names;
}

// JSON indentato con colori per chiavi, stringhe, numeri e null/booleani (HTML già escapato).
export function highlightJson(value) {
  const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const json = JSON.stringify(value, null, 2);
  if (json === undefined) return "";
  return esc(json).replace(
    /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
    (match, str, colon, lit) => {
      if (str) return colon ? '<span class="j-key">' + str + "</span>" + colon : '<span class="j-str">' + str + "</span>";
      if (lit) return '<span class="j-lit">' + match + "</span>";
      return '<span class="j-num">' + match + "</span>";
    }
  );
}

// ---------- Albero del push: ogni riga porta il proprio path ----------
// Il <pre> JSON non basta più: il path di un parametro non si legge dalla formattazione, ma
// dalla gerarchia. Ogni riga è un pulsante che copia il path nel formato che vuole il nome di
// una Data Layer Variable di GTM: chiavi unite da punto, indici di array come numero
// (ecommerce.items.0.item_id).

function pathWith(parent, key) {
  return parent ? parent + "." + key : String(key);
}

// Il nome del push va sempre in cima: è la prima cosa che si guarda, mentre la posizione
// delle chiavi la decide chi ha fatto il push (a volte ecommerce prima, a volte in ordine
// alfabetico). Vale solo al livello radice.
function keysEventFirst(keys) {
  const at = keys.indexOf("event");
  if (at <= 0) return keys;
  return ["event"].concat(keys.slice(0, at), keys.slice(at + 1));
}

// Copia superficiale con event in cima: serve a chi mostra il push come JSON (scheda UAT).
export function eventFirst(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const keys = keysEventFirst(Object.keys(data));
  const out = {};
  keys.forEach((key) => (out[key] = data[key]));
  return out;
}

function jsonValueNode(value) {
  const node = document.createElement("span");
  node.setAttribute("role", "button");
  node.tabIndex = 0;
  if (value === null) {
    node.className = "json-val j-lit";
    node.textContent = "null";
    node.dataset.value = "null";
    node.title = "Copia il valore";
    return node;
  }
  if (typeof value === "string") {
    node.className = "json-val j-str";
    node.textContent = '"' + value + '"';
    node.dataset.value = value;
    node.title = "Copia il valore";
    return node;
  }
  node.className = typeof value === "number" ? "json-val j-num" : "json-val j-lit";
  node.textContent = String(value);
  node.dataset.value = String(value);
  node.title = "Copia il valore";
  return node;
}

// Due zone cliccabili per riga: il nome copia il path (per la Data Layer Variable), il valore
// copia il valore. Sono <span>, non <button>: il testo del push deve restare selezionabile, e
// in Chrome il contenuto di un button non si seleziona.
function jsonRow(key, path, depth, marker) {
  const row = document.createElement("div");
  row.className = key === "event" ? "json-row is-event" : "json-row";
  row.style.paddingLeft = 10 + depth * 15 + "px";
  const name = document.createElement("span");
  name.className = "json-key";
  name.textContent = key;
  name.dataset.path = path;
  name.setAttribute("role", "button");
  name.tabIndex = 0;
  name.title = "Copia il path: " + path;
  row.appendChild(name);
  if (marker) {
    row.appendChild(document.createTextNode(" "));
    const brace = document.createElement("span");
    brace.className = "json-brace";
    brace.textContent = marker;
    row.appendChild(brace);
    return row;
  }
  const colon = document.createElement("span");
  colon.className = "json-colon";
  colon.textContent = ": ";
  row.appendChild(colon);
  return row;
}

function jsonCloseRow(depth, marker) {
  const row = document.createElement("div");
  row.className = "json-close";
  row.style.paddingLeft = 10 + depth * 15 + "px";
  row.textContent = marker;
  return row;
}

// Restituisce il frammento già pronto: le righe con figli mostrano la graffa aperta e quella
// di chiusura non è cliccabile (non è un path).
export function renderJsonTree(data) {
  const frag = document.createDocumentFragment();
  // Push non oggetto (una stringa, un numero): niente path da copiare, solo il valore.
  if (data === null || typeof data !== "object") {
    const line = document.createElement("div");
    line.className = "json-close";
    line.style.paddingLeft = "10px";
    const value = jsonValueNode(data);
    line.appendChild(value);
    frag.appendChild(line);
    return frag;
  }
  const keys = keysEventFirst(Object.keys(data));
  if (!keys.length) {
    frag.appendChild(jsonCloseRow(0, Array.isArray(data) ? "[]" : "{}"));
    return frag;
  }

  const walk = (value, key, path, depth) => {
    const isObject = value !== null && typeof value === "object";
    if (!isObject) {
      const row = jsonRow(key, path, depth, null);
      row.appendChild(jsonValueNode(value));
      frag.appendChild(row);
      return;
    }
    const isArray = Array.isArray(value);
    const children = Object.keys(value);
    if (!children.length) {
      frag.appendChild(jsonRow(key, path, depth, isArray ? "[]" : "{}"));
      return;
    }
    frag.appendChild(jsonRow(key, path, depth, isArray ? "[" : "{"));
    children.forEach((child) => walk(value[child], child, pathWith(path, child), depth + 1));
    frag.appendChild(jsonCloseRow(depth, isArray ? "]" : "}"));
  };

  keys.forEach((key) => walk(data[key], key, pathWith("", key), 0));
  return frag;
}

// Tutti i path (dotted) di un push, per la ricerca: cercando "ecommerce.items.3.item_category2"
// si trova l'evento che ha quel parametro sul quarto item, non solo chi contiene quella stringa
// in un valore. Gli indici degli array sono numeri, come nel path di una DLV.
export function dataPaths(value) {
  const out = [];
  const walk = (val, path) => {
    if (path) out.push(path);
    if (val === null || typeof val !== "object") return;
    Object.keys(val).forEach((key) => walk(val[key], pathWith(path, key)));
  };
  walk(value, "");
  return out;
}

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// Controllo dello snippet GTM al salvataggio: l'injector lo esegue nella pagina, dove un
// errore di sintassi non si vede e il container semplicemente non parte. Qui si dice prima.
// Il codice non si compila (una pagina di estensione MV3 non puo' usare eval): si guarda che
// resti solo JavaScript dopo aver tolto i blocchi che bridge.js toglie davvero.
export function gtmCodeWarning(raw) {
  const source = String(raw || "");
  if (!source.trim()) return null;
  if (!/GTM-[A-Z0-9]+/.test(source)) return "Nessun ID GTM-… nel codice: sembra incollato male";
  const leftover = source
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .trim();
  if (leftover) return "C'è HTML fuori dai blocchi script: l'injector lo ignora";
  return null;
}
