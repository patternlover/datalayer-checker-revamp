(function () {
  if (window.__dlcGtmListenerReady) return;
  window.__dlcGtmListenerReady = true;

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

  function injectOnce(code, position) {
    if (typeof code !== "string" || code === "") return;
    if (window.__dlcGtmInjectedCode === code) return;
    window.__dlcGtmInjectedCode = code;
    injectCode(code, position === "body" ? "body" : "head");
  }

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || typeof data !== "object") return;

    if (data.action === "setGTMCode") {
      injectOnce(data.code, data.position);
      return;
    }

    if (data.event_source === "custom_pixel_dataLayer_replace") {
      if (Array.isArray(data.data)) window.dataLayer = data.data;
      return;
    }

    if (data.event_source === "customPixel") {
      var first = data.data && data.data[0];
      if (!first) return;
      if (first.event === "gtm.dom" || first.event === "gtm.load") return;
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push(first);
    }
  });

  window.postMessage({ action: "gtmCodeReady" }, "*");
})();
