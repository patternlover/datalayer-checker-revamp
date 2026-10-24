// Gira nel contesto della pagina: legge window.dataLayer e lo passa al content script.
// Regole per non interferire mai con il sito:
// - nessun window.postMessage (i listener "message" del sito non vedono nulla): solo un evento DOM privato;
// - nessuna variabile globale aggiunta, nessuna modifica a window.dataLayer (non viene creato se manca);
// - gli oggetti del dataLayer vengono copiati in modo sicuro: nodi DOM, window, funzioni e
//   riferimenti circolari diventano testo, cos\u00ec la serializzazione \u00e8 sempre leggera.
(function () {
  if (window.__dlcStreamReady) return;
  Object.defineProperty(window, "__dlcStreamReady", { value: true, enumerable: false });

  var POLL_MS = 250;
  var MAX_DEPTH = 14;
  var timer = null;
  var ref = null;
  var sent = 0;

  function describeNode(node) {
    try {
      if (node.nodeType !== 1) return "[" + (node.nodeName || "Node") + "]";
      var id = node.id ? "#" + node.id : "";
      var cls = typeof node.className === "string" && node.className.trim() ? "." + node.className.trim().split(/\s+/).slice(0, 3).join(".") : "";
      return "<" + node.tagName.toLowerCase() + id + cls + ">";
    } catch (e) {
      return "[Element]";
    }
  }

  function safeCopy(value, depth, seen) {
    if (value === null || typeof value !== "object") {
      if (typeof value === "function") return "[Function" + (value.name ? " " + value.name : "") + "]";
      if (typeof value === "undefined") return undefined;
      if (typeof value === "bigint" || typeof value === "symbol") return String(value);
      return value;
    }
    try {
      if (value === window || (typeof Window !== "undefined" && value instanceof Window)) return "[Window]";
      if (typeof Node !== "undefined" && value instanceof Node) return describeNode(value);
      if (typeof Event !== "undefined" && value instanceof Event) return "[Event " + value.type + "]";
      if (value instanceof Date) return value.toISOString();
    } catch (e) {
      return "[Object]";
    }
    if (depth > MAX_DEPTH) return "[\u2026]";
    if (seen.indexOf(value) !== -1) return "[Circular]";
    seen.push(value);
    var out;
    try {
      if (Array.isArray(value)) {
        out = [];
        for (var i = 0; i < value.length; i++) {
          var v = safeCopy(value[i], depth + 1, seen);
          out.push(v === undefined ? null : v);
        }
      } else {
        out = {};
        var keys = Object.keys(value);
        for (var k = 0; k < keys.length; k++) {
          var item;
          try {
            item = value[keys[k]];
          } catch (e) {
            item = "[Unreadable]";
          }
          var copy = safeCopy(item, depth + 1, seen);
          if (copy !== undefined) out[keys[k]] = copy;
        }
      }
    } catch (e) {
      out = "[Unreadable]";
    }
    seen.pop();
    return out;
  }

  function post(mode, items, startIndex) {
    var payload;
    try {
      payload = JSON.stringify({
        event: "dataLayerData",
        mode: mode,
        dlData: items.map(function (item) {
          return safeCopy(item, 0, []);
        }),
        startIndex: startIndex || 0,
        gtmInjected: !!window.__dlcGtmInjectedCode,
      });
    } catch (e) {
      return;
    }
    document.dispatchEvent(new CustomEvent("__dlc_msg:main", { detail: payload }));
  }

  function current() {
    var dl = window.dataLayer;
    return Array.isArray(dl) ? dl : null;
  }

  function tick() {
    var dl = current();
    if (!dl) return;
    if (dl !== ref) {
      ref = dl;
      sent = dl.length;
      post("snapshot", dl.slice(0), 0);
      return;
    }
    if (dl.length > sent) {
      var items = dl.slice(sent);
      sent = dl.length;
      post("append", items, sent - items.length);
    } else if (dl.length < sent) {
      sent = dl.length;
    }
  }

  // Ogni start (anche su stream gi\u00e0 attivo, es. dopo riconnessione) invia lo snapshot completo:
  // il background deduplica per documento, quindi non si perdono eventi n\u00e9 si duplicano.
  function start() {
    var dl = current();
    ref = dl;
    sent = dl ? dl.length : 0;
    if (dl) post("snapshot", dl.slice(0), 0);
    if (!timer) timer = setInterval(tick, POLL_MS);
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  var listenerOk = false;
  function onIsolated(event) {
    var data;
    try {
      data = JSON.parse(event.detail);
    } catch (e) {
      return;
    }
    if (!data) return;
    if (data.__dlc === "ping") listenerOk = true;
    else if (data.__dlc === "start") start();
    else if (data.__dlc === "stop") stop();
  }

  // Il sandbox dei Shopify Custom Pixel sostituisce document.addEventListener: si usa il metodo
  // del prototipo e si verifica subito che il canale funzioni.
  try {
    EventTarget.prototype.addEventListener.call(document, "__dlc_msg:isolated", onIsolated);
    document.dispatchEvent(new CustomEvent("__dlc_msg:isolated", { detail: '{"__dlc":"ping"}' }));
  } catch (e) {}

  // Avvio immediato: non dipende dal comando "start" del content script.
  start();

  // Canale di ritorno non disponibile (comandi start/stop non ricevibili): snapshot periodico.
  // È idempotente, il background scarta gli elementi già visti.
  if (!listenerOk) {
    setInterval(function () {
      var dl = current();
      if (dl) post("snapshot", dl.slice(0), 0);
    }, 2000);
  }
})();
