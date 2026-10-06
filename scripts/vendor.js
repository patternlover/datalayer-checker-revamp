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

(function () {
  if (self.__dlcStreamReady) return;
  self.__dlcStreamReady = true;

  var POLL_MS = 250;
  var timer = null;
  var ref = null;
  var sent = 0;

  function post(mode, items, startIndex) {
    window.postMessage(Flatted.stringify({ event: "dataLayerData", mode: mode, dlData: items, startIndex: startIndex || 0 }), "*");
  }

  function tick() {
    var dl = window.dataLayer || [];
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

  function start() {
    if (timer) return;
    window.dataLayer = window.dataLayer || [];
    ref = window.dataLayer;
    sent = ref.length;
    post("snapshot", ref.slice(0), 0);
    timer = setInterval(tick, POLL_MS);
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  window.addEventListener("message", function (event) {
    if (event.source !== window || !event.data || typeof event.data !== "object") return;
    if (event.data.__dlc === "start") start();
    else if (event.data.__dlc === "stop") stop();
  });
})();
