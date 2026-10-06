chrome.runtime.onInstalled.addListener(async () => {
  try {
    chrome.scripting.registerContentScripts([
      {
        id: "gtm-code",
        matches: ["<all_urls>"],
        js: ["scripts/gtmcode.js"],
        runAt: "document_end",
        world: "MAIN",
        allFrames: true,
      },
    ]);

    chrome.scripting.registerContentScripts([
      {
        id: "bridge-code",
        matches: ["<all_urls>"],
        js: ["scripts/bridge.js"],
        runAt: "document_end",
        allFrames: true,
      },
    ]);

    chrome.scripting.registerContentScripts([
      {
        id: "banner-code",
        matches: ["<all_urls>"],
        js: ["scripts/banner.js"],
        runAt: "document_end",
        allFrames: false,
      },
    ]);
  } catch (error) {
    console.log(error);
  }
});

async function shouldMirror() {
  const { frame, injectTarget, mirrorPixel } = await chrome.storage.sync.get(["frame", "injectTarget", "mirrorPixel"]);
  if (mirrorPixel === "off") return false;
  if (mirrorPixel === "on") return true;
  return frame === "iframe" && injectTarget !== "pixel";
}

function isPixelSandboxFrame(frame) {
  return frame.url.includes("/sandbox/modern/") && !frame.url.includes("shopify-custom-pixel") && frame.frameType === "sub_frame";
}

function injectMirrorIntoFrame(tabId, frameId) {
  chrome.scripting
    .executeScript({
      target: { tabId: tabId, frameIds: [frameId] },
      injectImmediately: true,
      files: ["scripts/listener.js"],
      world: "MAIN",
    })
    .catch(() => {});
}

chrome.webNavigation.onDOMContentLoaded.addListener(async (element) => {
  if (!(await shouldMirror())) return;
  if (isPixelSandboxFrame(element)) {
    injectMirrorIntoFrame(element.tabId, element.frameId);
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

async function injectBannerAllTabs() {
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch (error) {
    return;
  }
  for (const tab of tabs) {
    if (!tab.id || !tab.url || !/^https:\/\//.test(tab.url)) continue;
    chrome.scripting
      .executeScript({ target: { tabId: tab.id }, files: ["scripts/banner.js"] })
      .catch(() => {});
  }
}

async function injectMirrorAllTabs() {
  if (!(await shouldMirror())) return;
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch (error) {
    return;
  }
  for (const tab of tabs) {
    if (!tab.id || !tab.url || !/^https:\/\//.test(tab.url)) continue;
    chrome.webNavigation.getAllFrames({ tabId: tab.id }, (frames) => {
      if (!frames) return;
      for (const frame of frames) {
        if (isPixelSandboxFrame(frame)) injectMirrorIntoFrame(tab.id, frame.frameId);
      }
    });
  }
}

chrome.runtime.onStartup.addListener(refreshGtmBadge);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  if (changes.gtmcodepush) {
    refreshGtmBadge();
    injectBannerAllTabs();
  }
  if (changes.frame || changes.injectTarget || changes.mirrorPixel) {
    injectMirrorAllTabs();
  }
});
refreshGtmBadge();
