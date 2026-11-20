(function () {
  if (window.__dlcGtmListenerReady) return;
  window.__dlcGtmListenerReady = true;

  // Canale privato con il content script: un evento DOM dedicato invece di window.postMessage,
  // così i listener "message" del sito non ricevono mai i messaggi dell'estensione.
  var CHANNEL = "__dlc_msg";
  function send(obj) {
    document.dispatchEvent(new CustomEvent(CHANNEL + ":main", { detail: JSON.stringify(obj) }));
  }

  // Lo snippet può arrivare in tre forme: il loader standard (una funzione che crea lo script), un
  // <script async src="...gtm.js?id=...">, oppure il solo ID del container. Prima si trattava tutto
  // come testo da mettere in un <script>, e un loader con src perdeva l'URL: non si iniettava nulla.
  function buildLoader(id) {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ "gtm.start": new Date().getTime(), event: "gtm.js" });
    var script = document.createElement("script");
    script.async = true;
    script.src = "https://www.googletagmanager.com/gtm.js?id=" + id;
    return [script];
  }

  function nodesFromSnippet(raw) {
    var nodes = [];
    var re = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
    var found = false;
    var match;
    while ((match = re.exec(raw))) {
      found = true;
      var srcMatch = /src\s*=\s*["']([^"']+)["']/i.exec(match[1] || "");
      var el = document.createElement("script");
      if (srcMatch) {
        if (!/gtm\.js/i.test(srcMatch[1])) continue;
        el.async = true;
        el.src = srcMatch[1];
      } else if ((match[2] || "").trim()) {
        el.textContent = match[2];
      } else {
        continue;
      }
      nodes.push(el);
    }
    if (!found) nodes.push(Object.assign(document.createElement("script"), { textContent: raw }));
    return nodes;
  }

  function injectCode(raw, tag) {
    var tagName = document.getElementsByTagName(tag)[0];
    if (!tagName) return;
    var trimmed = String(raw || "").trim();
    var nodes = /^GTM-[A-Z0-9]+$/.test(trimmed) ? buildLoader(trimmed) : nodesFromSnippet(trimmed);
    var first = nodes[0];
    nodes.forEach(function (node, index) {
      if (index === 0 && tag === "head") {
        try {
          tagName.prepend(node);
          return;
        } catch (error) {}
      }
      tagName.appendChild(node);
    });
    return first;
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

  // Il campo accetta tre forme: il blocco completo (funzione loader o <script src>), il solo ID
  // (GTM-XXXX, da cui buildLoader costruisce il loader) e JavaScript incollato a mano. Prosa o un
  // refuso non devono finire in pagina come script: li' si ferma e la card lo dice.
  function looksLikeSnippet(code) {
    if (/googletagmanager\.com\/gtm\.js/.test(code)) return true;
    if (/^GTM-[A-Z0-9]+$/.test(String(code).trim())) return true;
    return /[=();{}]/.test(code);
  }

  function injectOnce(code, position) {
    if (typeof code !== "string" || code === "") return;
    if (!looksLikeSnippet(code)) {
      console.error(
        "[DataLayer Checker] GTM Injector: nel campo non c'e' ne' uno snippet GTM ne' un ID (GTM-XXXX): incolla il blocco completo o il solo ID del container."
      );
      send({ __dlc: "gtmInvalid" });
      return;
    }
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
    console.info("[DataLayer Checker] GTM Injector: container iniettato (" + ids.join(", ") + ")");
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
