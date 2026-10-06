(function () {
  function isTopFrame() {
    return window.top === window;
  }

  function isSandboxFrame() {
    try {
      return window.top !== window && location.href.indexOf("/sandbox/modern/") !== -1;
    } catch (e) {
      return false;
    }
  }

  function cleanGtmCode(gtmcode) {
    return gtmcode
      .replace(/<!-- Google Tag Manager -->\n/g, "")
      .replace(/<script>/g, "")
      .replace(/<\/script>/g, "")
      .replace(/\n<!-- End Google Tag Manager -->/g, "");
  }

  async function sendGtmCode() {
    var { gtmcode } = await chrome.storage.sync.get(["gtmcode"]);
    var { gtmcodepush } = await chrome.storage.sync.get(["gtmcodepush"]);
    var { injectTarget } = await chrome.storage.sync.get(["injectTarget"]);
    if (gtmcodepush !== true || typeof gtmcode !== "string" || gtmcode === "") return;

    var target = injectTarget === "pixel" ? "pixel" : "top";
    var injectHere = target === "pixel" ? isSandboxFrame() : isTopFrame();
    if (!injectHere) return;

    var position = target === "pixel" ? "body" : "head";
    window.postMessage({ action: "setGTMCode", code: cleanGtmCode(gtmcode), position: position }, "*");
  }

  if (!window.__dlcBridgeReady) {
    window.__dlcBridgeReady = true;

    window.addEventListener("message", function (event) {
      if (event.source !== window || !event.data) return;
      if (event.data.action === "gtmCodeReady") sendGtmCode();
    });

    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== "sync") return;
      if (changes.gtmcodepush || changes.gtmcode || changes.injectTarget) sendGtmCode();
    });
  }

  sendGtmCode();
})();
