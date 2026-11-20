// Ponte dal sandbox del Custom Pixel al dataLayer della pagina.
//
// Gira in world MAIN dentro il frame del sandbox, quindi vede il dataLayer del pixel: quello che
// il container del tema non vedra' mai. Manda i push al background sul canale privato
// `__dlc_msg:main` (content.js li inoltra sulla porta di cattura); il background decide se e dove
// rispecchiarli. Qui non si interpreta niente: si manda l'oggetto cosi' com'e'.
(function () {
  if (window.__dlcMirrorReady) return;
  window.__dlcMirrorReady = true;

  var CHANNEL = "__dlc_msg";

  function send(obj) {
    document.dispatchEvent(new CustomEvent(CHANNEL + ":main", { detail: JSON.stringify(obj) }));
  }

  // `gtm.*` e' il ciclo di vita del container che gira nel sandbox, non un evento del negozio:
  // rispecchiarlo farebbe partire il container del Top su gtm.js/gtm.dom/gtm.load.
  function keep(ev) {
    if (!ev || typeof ev !== "object") return false;
    return typeof ev.event !== "string" || ev.event.indexOf("gtm.") !== 0;
  }

  function clean(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      if (keep(list[i])) out.push(list[i]);
    }
    return out;
  }

  // Il pixel puo' pushare prima che lo script arrivi: si aspetta il dataLayer, si manda il
  // backlog una volta e poi si avvolge push. GTM non riassegna dataLayer, quindi il riferimento
  // resta valido.
  var tries = 0;
  var timer = setInterval(function () {
    tries++;
    var dl = window.dataLayer;
    if (!Array.isArray(dl)) {
      if (tries < 100) return;
      clearInterval(timer);
      return;
    }
    clearInterval(timer);
    if (window.__dlcMirrorHooked) return;
    window.__dlcMirrorHooked = true;

    var seed = clean([].slice.call(dl, 0));
    if (seed.length) send({ __dlc: "pixelMirror", mode: "seed", events: seed });

    var oldPush = dl.push;
    dl.push = function () {
      var events = clean([].slice.call(arguments, 0));
      if (events.length) send({ __dlc: "pixelMirror", mode: "push", events: events });
      return oldPush.apply(dl, arguments);
    };
  }, 100);
})();
