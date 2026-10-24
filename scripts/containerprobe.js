(function () {
  if (window.__dlcContainerProbeReady) return;
  window.__dlcContainerProbeReady = true;

  var sent = {};

  // Canale privato con il content script: evento DOM dedicato, invisibile ai listener "message".
  function send(obj) {
    document.dispatchEvent(new CustomEvent("__dlc_msg:main", { detail: JSON.stringify(obj) }));
  }

  // Shopify: oggetto globale o script del Web Pixels Manager presenti nella pagina.
  function isShopify() {
    try {
      if (window.Shopify && (window.Shopify.shop || window.Shopify.theme || window.Shopify.routes)) return true;
      if (document.querySelector('script[src*="cdn.shopify.com"], script[id^="web-pixels-manager"], link[href*="cdn.shopify.com"]')) return true;
    } catch (e) {}
    return false;
  }

  function scan() {
    // Inviato a ogni scansione: il primo messaggio può arrivare prima che il collector ascolti.
    if (window.top === window && isShopify()) {
      send({ __dlc: "platform", shopify: true });
    }

    var ids = [];
    try {
      var gtm = window.google_tag_manager || {};
      Object.keys(gtm).forEach(function (key) {
        if (/^(GTM|G|DC|AW|MC)-/.test(key)) ids.push(key);
      });
    } catch (e) {}
    var fresh = ids.filter(function (id) {
      return !sent[id];
    });
    if (!fresh.length) return;
    fresh.forEach(function (id) {
      sent[id] = true;
    });
    send({ __dlc: "containers", ids: fresh });
  }

  [0, 1500, 3500].forEach(function (delay) {
    setTimeout(scan, delay);
  });
})();
