(function () {
  if (window.__dlcGtmListenerReady) return;
  window.__dlcGtmListenerReady = true;

  // Canale privato con il content script: un evento DOM dedicato invece di window.postMessage,
  // così i listener "message" del sito non ricevono mai i messaggi dell'estensione.
  var CHANNEL = "__dlc_msg";
  function send(obj) {
    document.dispatchEvent(new CustomEvent(CHANNEL + ":main", { detail: JSON.stringify(obj) }));
  }

  function injectCode(codeToPush, tag) {
    var tagName = document.getElementsByTagName(tag)[0];
    if (!tagName) return;
    var script = document.createElement("script");
    script.textContent = codeToPush;
    if (tag === "head") {
      try {
        tagName.prepend(script);
      } catch (error) {
        console.log(error);
      }
    } else if (tag === "body") {
      try {
        tagName.appendChild(script);
      } catch (error) {
        console.log(error);
      }
    }
  }

  // Container già caricati dal sito: iniettarli una seconda volta duplica tag e listener
  // e può rompere funzioni del sito (carrello, wishlist...).
  function containersOnPage(ids) {
    return ids.filter(function (id) {
      try {
        if (window.google_tag_manager && window.google_tag_manager[id]) return true;
      } catch (e) {}
      return !!document.querySelector('script[src*="id=' + id + '"]');
    });
  }

  // gtm.js decide se è in debug da quattro segnali (sorgente di gtm.js, 2026-11-20):
  // `gtm_debug` in query, referrer di tagassistant.google.com, cookie `__TAG_ASSISTANT`, oppure
  // l'attributo `data-tag-assistant-prod-present` su <html> (il timestamp deve stare nella
  // finestra che gtm.js accetta). Sul checkout i primi tre non ci sono: senza segnale il
  // container iniettato gira ma non si collega alla preview, e Tag Assistant resta vuoto.
  function markTagAssistant() {
    try {
      document.documentElement.setAttribute("data-tag-assistant-prod-present", String(Date.now()));
    } catch (error) {}
  }

  function injectOnce(code, position) {
    if (typeof code !== "string" || code === "") return;
    if (window.__dlcGtmInjectedCode === code) return;
    var ids = code.match(/GTM-[A-Z0-9]+/g) || [];
    var dup = containersOnPage(ids);
    if (dup.length) {
      window.__dlcGtmInjectedCode = code;
      console.warn("[DataLayer Checker Plus] GTM Injector: " + dup.join(", ") + " \u00e8 gi\u00e0 nella pagina, iniezione saltata.");
      send({ __dlc: "gtmSkipped", ids: dup });
      return;
    }
    window.__dlcGtmInjectedCode = code;
    injectCode(code, position === "body" ? "body" : "head");
    send({ __dlc: "gtmInjected" });
  }

  document.addEventListener(CHANNEL + ":isolated", function (event) {
    var data;
    try {
      data = JSON.parse(event.detail);
    } catch (e) {
      return;
    }
    if (data && data.action === "setGTMCode") {
      if (data.ta) markTagAssistant();
      injectOnce(data.code, data.position);
    }
  });

  send({ action: "gtmCodeReady" });
})();
