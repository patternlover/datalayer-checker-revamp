(function () {
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
    var { frame } = await chrome.storage.sync.get(["frame"]);
    if (gtmcodepush !== true || typeof gtmcode !== "string" || gtmcode === "") return;
    var position = frame === "iframe" ? "body" : "head";
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
      if (changes.gtmcodepush || changes.gtmcode || changes.frame) sendGtmCode();
    });
  }

  sendGtmCode();
})();
