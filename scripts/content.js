self.Flatted = (function (n) {
  "use strict";
  function t(n) {
    return (
      (t =
        "function" == typeof Symbol && "symbol" == typeof Symbol.iterator
          ? function (n) {
              return typeof n;
            }
          : function (n) {
              return n && "function" == typeof Symbol && n.constructor === Symbol && n !== Symbol.prototype ? "symbol" : typeof n;
            }),
      t(n)
    );
  }
  var r = JSON.parse,
    e = JSON.stringify,
    o = Object.keys,
    u = String,
    f = "string",
    i = {},
    c = "object",
    a = function (n, t) {
      return t;
    },
    l = function (n) {
      return n instanceof u ? u(n) : n;
    },
    s = function (n, r) {
      return t(r) === f ? new u(r) : r;
    },
    y = function n(r, e, f, a) {
      for (var l = [], s = o(f), y = s.length, p = 0; p < y; p++) {
        var v = s[p],
          S = f[v];
        if (S instanceof u) {
          var b = r[S];
          t(b) !== c || e.has(b) ? (f[v] = a.call(f, v, b)) : (e.add(b), (f[v] = i), l.push({ k: v, a: [r, e, b, a] }));
        } else f[v] !== i && (f[v] = a.call(f, v, S));
      }
      for (var m = l.length, g = 0; g < m; g++) {
        var h = l[g],
          O = h.k,
          d = h.a;
        f[O] = a.call(f, O, n.apply(null, d));
      }
      return f;
    },
    p = function (n, t, r) {
      var e = u(t.push(r) - 1);
      return n.set(r, e), e;
    },
    v = function (n, e) {
      var o = r(n, s).map(l),
        u = o[0],
        f = e || a,
        i = t(u) === c && u ? y(o, new Set(), u, f) : u;
      return f.call({ "": i }, "", i);
    },
    S = function (n, r, o) {
      for (
        var u =
            r && t(r) === c
              ? function (n, t) {
                  return "" === n || -1 < r.indexOf(n) ? t : void 0;
                }
              : r || a,
          i = new Map(),
          l = [],
          s = [],
          y = +p(i, l, u.call({ "": n }, "", n)),
          v = !y;
        y < l.length;

      )
        (v = !0), (s[y] = e(l[y++], S, o));
      return "[" + s.join(",") + "]";
      function S(n, r) {
        if (v) return (v = !v), r;
        var e = u.call(this, n, r);
        switch (t(e)) {
          case c:
            if (null === e) return e;
          case f:
            return i.get(e) || p(i, l, e);
        }
        return e;
      }
    };
  return (
    (n.fromJSON = function (n) {
      return v(e(n));
    }),
    (n.parse = v),
    (n.stringify = S),
    (n.toJSON = function (n) {
      return r(S(n));
    }),
    n
  );
})({});

function injectVendor(callback) {
  var node = document.head || document.getElementsByTagName("head")[0];
  var script = document.createElement("script");
  script.setAttribute("type", "text/javascript");
  script.setAttribute("src", chrome.runtime.getURL("scripts/vendor.js"));
  script.id = "dlc_vendor";
  script.onload = function () {
    var el = document.getElementById("dlc_vendor");
    if (el) el.remove();
    callback();
  };
  node.appendChild(script);
}

// Canale privato con gli script della pagina: eventi DOM dedicati, mai window.postMessage.
function sendToPage(obj) {
  document.dispatchEvent(new CustomEvent("__dlc_msg:isolated", { detail: JSON.stringify(obj) }));
}

function startStream() {
  sendToPage({ __dlc: "start" });
}

if (window.__dlcPort) {
  try {
    window.__dlcPort.disconnect();
  } catch (e) {}
  window.__dlcPort = null;
}

window.__dlcReconnectTries = 0;

// ID stabile per documento: permette al background di deduplicare gli snapshot del dataLayer
// quando il content script viene re-iniettato o la porta si riconnette.
if (!window.__dlcDocId) {
  window.__dlcDocId = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

function connectCapture() {
  var port;
  try {
    // Il ruolo nel nome della porta: il background non può fidarsi di frameId === 0
    // (le pagine prerenderizzate mantengono un frameId diverso anche dopo l'attivazione).
    port = chrome.runtime.connect({ name: "dlc-capture|" + (window.top === window ? "top" : "sub") });
  } catch (e) {
    return;
  }
  window.__dlcPort = port;
  port.onMessage.addListener(function (msg) {
    // Il background, dopo aver accettato la porta, chiede uno snapshot completo.
    if (msg && msg.cmd === "resync") startStream();
  });
  setTimeout(function () {
    if (window.__dlcPort === port) window.__dlcReconnectTries = 0;
  }, 3000);
  port.onDisconnect.addListener(function () {
    if (window.__dlcPort !== port) return;
    window.__dlcPort = null;
    if (window.__dlcReconnectTries >= 5) {
      sendToPage({ __dlc: "stop" });
      return;
    }
    window.__dlcReconnectTries++;
    setTimeout(function () {
      connectCapture();
      if (window.__dlcPort) startStream();
    }, 800);
  });
}

connectCapture();

function onPageMessage(event) {
  var data;
  try {
    data = JSON.parse(event.detail);
  } catch (e) {
    return;
  }
  if (!data || typeof data !== "object") return;
  var port = window.__dlcPort;
  if (!port) return;
  try {
    if (data.__dlc === "gtmInjected") {
      port.postMessage(Flatted.stringify({ gtmMeta: true, gtmInjected: true }));
    } else if (data.__dlc === "platform") {
      port.postMessage({ type: "platform", shopify: !!data.shopify });
    } else if ((data.__dlc === "containers" || data.__dlc === "gtmSkipped") && Array.isArray(data.ids)) {
      port.postMessage({ type: "containers", ids: data.ids });
    } else if (data.event === "dataLayerData" && Array.isArray(data.dlData)) {
      data.meta = {
        url: location.href,
        host: location.host,
        docId: window.__dlcDocId,
        isTop: window.top === window,
        isShopifySandbox: location.href.indexOf("/sandbox/modern/") !== -1,
        gtmInjected: !!data.gtmInjected,
      };
      port.postMessage(Flatted.stringify(data));
    }
  } catch (err) {}
}

// Un solo listener anche se lo script viene iniettato più volte.
if (window.__dlcOnPageMessage) document.removeEventListener("__dlc_msg:main", window.__dlcOnPageMessage);
window.__dlcOnPageMessage = onPageMessage;
document.addEventListener("__dlc_msg:main", onPageMessage);

if (window.__dlcVendorInjected) {
  if (window.__dlcPort) startStream();
} else {
  window.__dlcVendorInjected = true;
  injectVendor(function () {
    if (window.__dlcPort) startStream();
  });
}
