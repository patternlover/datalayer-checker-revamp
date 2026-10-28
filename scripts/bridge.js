(function () {
  function isTopFrame() {
    return window.top === window;
  }

  function hostMatches(host, list) {
    if (!host || !Array.isArray(list)) return false;
    return list.some(function (domain) {
      return host === domain || host.endsWith("." + domain);
    });
  }

  // Lo snippet si incolla dal sito GTM: arriva con \r\n su Windows e con i commenti HTML
  // attorno. Se si copia anche il secondo blocco, c'e' il <noscript> con un iframe: dentro
  // uno script quella roba e' un errore di sintassi che uccide il container, quindi si toglie.
  function cleanGtmCode(gtmcode) {
    return gtmcode
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<script[^>]*>/gi, "")
      .replace(/<\/script>/gi, "")
      .trim();
  }

  async function sendGtmCode() {
    if (!isTopFrame()) return;

    var { gtmcode, gtmcodepush, gtmDomains } = await chrome.storage.sync.get(["gtmcode", "gtmcodepush", "gtmDomains"]);
    if (gtmcodepush !== true) return;
    if (typeof gtmcode !== "string" || gtmcode === "") return;
    if (!hostMatches(location.hostname, gtmDomains)) return;

    // Canale privato (evento DOM): il codice del container non passa da window.postMessage,
    // quindi i listener "message" del sito non lo vedono.
    document.dispatchEvent(new CustomEvent("__dlc_msg:isolated", { detail: JSON.stringify({ action: "setGTMCode", code: cleanGtmCode(gtmcode) }) }));
  }

  if (!window.__dlcBridgeReady) {
    window.__dlcBridgeReady = true;

    document.addEventListener("__dlc_msg:main", function (event) {
      var data;
      try {
        data = JSON.parse(event.detail);
      } catch (e) {
        return;
      }
      if (data && data.action === "gtmCodeReady") sendGtmCode();
    });

    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== "sync") return;
      if (changes.gtmcodepush || changes.gtmcode || changes.gtmDomains) sendGtmCode();
    });
  }

  sendGtmCode();
})();
