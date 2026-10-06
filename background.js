chrome.runtime.onInstalled.addListener(async () => {
  try {
    chrome.scripting.registerContentScripts([
      {
        id: "gtm-code",
        matches: ["<all_urls>"],
        js: ["scripts/gtmcode.js"],
        runAt: "document_end",
        world: "MAIN",
      },
    ]);

    chrome.scripting.registerContentScripts([
      {
        id: "bridge-code",
        matches: ["<all_urls>"],
        js: ["scripts/bridge.js"],
        runAt: "document_end",
      },
    ]);
  } catch (error) {
    console.log(error);
  }
});

chrome.webNavigation.onDOMContentLoaded.addListener(async (element) => {
  let { frame } = await chrome.storage.sync.get(["frame"]);
  if (element.url.includes("/sandbox/modern/") === true && element.url.includes("shopify-custom-pixel") === false && element.frameType === "sub_frame" && frame === "iframe") {
    try {
      chrome.scripting.executeScript({
        target: { tabId: element.tabId, frameIds: [element.frameId] },
        injectImmediately: true,
        files: ["scripts/listener.js"],
        world: "MAIN",
      });
    } catch (error) {
      console.log(error);
    }
  }
});

// --- Warning: GTM Injector left active ---
async function refreshGtmBadge() {
  const { gtmcodepush } = await chrome.storage.sync.get(["gtmcodepush"]);
  if (gtmcodepush === true) {
    chrome.action.setBadgeBackgroundColor({ color: "#D93025" });
    chrome.action.setBadgeText({ text: "ON" });
    chrome.action.setTitle({ title: "GTM Injector ATTIVO - disattivalo quando hai finito il debug" });
  } else {
    chrome.action.setBadgeText({ text: "" });
    chrome.action.setTitle({ title: "DataLayer Checker Plus" });
  }
}

chrome.runtime.onStartup.addListener(refreshGtmBadge);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.gtmcodepush) {
    refreshGtmBadge();
  }
});
refreshGtmBadge();
