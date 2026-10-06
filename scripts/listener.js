(function () {
  var tries = 0;
  var timer = setInterval(function () {
    tries++;
    if (window.dataLayer || tries > 500) {
      clearInterval(timer);
      if (!window.dataLayer) window.dataLayer = [];
      if (window.__dlcPixelMirrorReady) return;
      window.__dlcPixelMirrorReady = true;

      var seed = [].slice.call(window.dataLayer, 0);
      window.parent.postMessage({ event_source: "customPixelSeed", data: seed }, "*");

      var oldPush = window.dataLayer.push;
      window.dataLayer.push = function () {
        var states = [].slice.call(arguments, 0);
        window.parent.postMessage({ event_source: "customPixel", data: states }, "*");
        return oldPush.apply(window.dataLayer, states);
      };
    }
  }, 200);
})();
