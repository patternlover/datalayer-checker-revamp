// Ponte standard: porta nel frame principale i push del dataLayer del sandbox.
(function () {
  var CHANNEL = "shopify-pixel-to-top";
  var queue = [];
  var acked = false;

  function post(payload, isGtag) {
    try {
      window.top.postMessage({ channel: CHANNEL, type: "push", payload: payload, isGtag: !!isGtag }, "*");
    } catch (e) {}
  }

  function isGtagPush(a) {
    return !!a && typeof a === "object" &&
      (Object.prototype.toString.call(a) === "[object Arguments]" ||
        Object.prototype.hasOwnProperty.call(a, "callee"));
  }

  function skip(ev) {
    if (!ev || typeof ev !== "object") return true;
    return typeof ev.event === "string" && ev.event.indexOf("gtm.") === 0;
  }

  // Una sola strada per backlog e push nuovi: se un push è in stile gtag va classificato anche
  // quando è già dentro il dataLayer, altrimenti nel Top arriva come oggetto e non come comando.
  function handle(a) {
    if (isGtagPush(a)) {
      var arr = Array.prototype.slice.call(a);
      if (acked) post(arr, true); else queue.push({ payload: arr, isGtag: true });
      return;
    }
    if (skip(a)) return;
    if (acked) post(a, false); else queue.push({ payload: a, isGtag: false });
  }

  function flush() {
    while (queue.length) {
      var m = queue.shift();
      post(m.payload, m.isGtag);
    }
  }

  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || d.channel !== CHANNEL) return;
    if (e.source !== window.top) return;      // solo il frame principale
    if (d.type !== "ready") return;
    acked = true;
    flush();
  });

  // Si aggancia appena il dataLayer esiste, mandando subito il backlog che trova.
  var timer = setInterval(function () {
    if (!Array.isArray(window.dataLayer)) return;
    clearInterval(timer);
    window.dataLayer.forEach(handle);
    var push = window.dataLayer.push;
    window.dataLayer.push = function () {
      // Il ponte non deve mai rompere i push del pixel: se qualcosa qui dentro va storto, il push
      // originale parte comunque.
      try {
        for (var i = 0; i < arguments.length; i++) handle(arguments[i]);
      } catch (e) {}
      return push.apply(window.dataLayer, arguments);
    };
  }, 100);

  // Il ricevitore può nascere dopo di noi: si ritenta, e appena qualcuno risponde la coda si svuota.
  function hello() {
    try { window.top.postMessage({ channel: CHANNEL, type: "hello" }, "*"); } catch (e) {}
  }
  hello();
  setTimeout(function () { if (!acked) hello(); }, 1000);
  setTimeout(function () { if (!acked) hello(); }, 3000);
})();
