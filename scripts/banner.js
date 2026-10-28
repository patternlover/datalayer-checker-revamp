(function () {
  var BANNER_ID = "gtm-injector-banner";
  // Chiudere il banner non deve spegnere l'iniezione: sono due cose diverse. Il flag vive
  // quanto il documento: alla navigazione dopo il banner torna (e riavvisa), quindi non si
  // può "dimenticare" l'iniezione accesa per giorni.
  var hidden = false;

  function showInjectorBanner() {
    if (window.top !== window) return;
    if (hidden) return;
    if (document.getElementById(BANNER_ID)) return;
    var parent = document.body || document.documentElement;
    if (!parent) return;

    var banner = document.createElement("div");
    banner.id = BANNER_ID;
    banner.setAttribute("role", "status");
    banner.style.cssText = [
      "position:fixed",
      "right:12px",
      "bottom:12px",
      "z-index:2147483647",
      "display:flex",
      "align-items:center",
      "gap:10px",
      "padding:7px 10px 7px 12px",
      "background:#CDFF00",
      "color:#004544",
      "font:600 12px/1.3 system-ui,-apple-system,Segoe UI,Roboto,sans-serif",
      "border-radius:10px",
      "box-shadow:0 4px 14px rgba(0,69,68,.3)",
      "pointer-events:auto",
    ].join(";");

    var label = document.createElement("span");
    label.textContent = "GTM Injector attivo";

    var off = document.createElement("button");
    off.type = "button";
    off.textContent = "Disattiva";
    off.style.cssText = [
      "cursor:pointer",
      "background:#004544",
      "border:0",
      "border-radius:7px",
      "padding:4px 9px",
      "font:600 11px/1.2 system-ui,-apple-system,Segoe UI,Roboto,sans-serif",
      "color:#fff",
    ].join(";");
    off.addEventListener("click", function () {
      chrome.storage.sync.set({ gtmcodepush: false });
      hideInjectorBanner();
    });

    banner.appendChild(label);
    banner.appendChild(off);

    var close = document.createElement("button");
    close.type = "button";
    close.textContent = "×";
    close.title = "Nascondi il banner (l'iniezione resta attiva)";
    close.setAttribute("aria-label", "Nascondi il banner");
    close.style.cssText = [
      "cursor:pointer",
      "background:transparent",
      "border:0",
      "padding:0 2px",
      "font:600 15px/1 system-ui,sans-serif",
      "color:#004544",
    ].join(";");
    close.addEventListener("click", function () {
      hidden = true;
      hideInjectorBanner();
    });
    banner.appendChild(close);

    parent.appendChild(banner);
  }

  function hideInjectorBanner() {
    var el = document.getElementById(BANNER_ID);
    if (el) el.remove();
  }

  function hostMatches(host, list) {
    if (!host || !Array.isArray(list)) return false;
    return list.some(function (domain) {
      return host === domain || host.endsWith("." + domain);
    });
  }

  async function apply() {
    var { gtmcodepush, gtmDomains } = await chrome.storage.sync.get(["gtmcodepush", "gtmDomains"]);
    if (gtmcodepush === true && hostMatches(location.hostname, gtmDomains)) showInjectorBanner();
    else hideInjectorBanner();
  }

  if (!window.__dlcBannerReady) {
    window.__dlcBannerReady = true;
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== "sync") return;
      if (changes.gtmcodepush || changes.gtmDomains) apply();
    });
  }

  apply();
})();
