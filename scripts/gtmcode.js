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

    // Custom pixel mirroring only makes sense in the top frame.
    if (window.top !== window) return;

    if (data.event_source === "customPixel" || data.event_source === "customPixelSeed") {
      var list;
      if (data.event_source === "customPixelSeed") list = Array.isArray(data.data) ? data.data : [];
      else list = data.data && data.data.length ? [data.data[0]] : [];
      window.dataLayer = window.dataLayer || [];
      for (var i = 0; i < list.length; i++) {
        var ev = list[i];
        if (!ev || typeof ev !== "object") continue;
        if (ev.event === "gtm.dom" || ev.event === "gtm.load") continue;
        window.dataLayer.push(ev);
      }
    }
  });

  window.postMessage({ action: "gtmCodeReady" }, "*");
})();
