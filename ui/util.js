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

export function eventLabel(obj) {
  if (!obj || typeof obj !== "object") return "Message";
  if (typeof obj.event === "string") return EVENT_LABELS[obj.event] || obj.event;
  if (typeof obj["0"] !== "undefined") return String(obj["0"]);
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
