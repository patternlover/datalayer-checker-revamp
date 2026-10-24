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

  // Container gi\u00e0 caricati dal sito: iniettarli una seconda volta duplica tag e listener
  // e pu\u00f2 rompere funzioni del sito (carrello, wishlist...).
  function containersOnPage(ids) {
    return ids.filter(function (id) {
      try {
        if (window.google_tag_manager && window.google_tag_manager[id]) return true;
      } catch (e) {}
      return !!document.querySelector('script[src*="id=' + id + '"]');
    });
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
    if (data && data.action === "setGTMCode") injectOnce(data.code, data.position);
  });

  send({ action: "gtmCodeReady" });
})();
