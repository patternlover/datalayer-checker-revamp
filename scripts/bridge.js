function showInjectorBanner() {
  if (window.top !== window) return;
  if (document.getElementById("gtm-injector-banner")) return;
  var parent = document.body || document.documentElement;
  if (!parent) return;
  var banner = document.createElement("div");
  banner.id = "gtm-injector-banner";
  banner.setAttribute("role", "status");
  banner.style.cssText = [
    "position:fixed",
    "right:12px",
    "bottom:12px",
    "z-index:2147483647",
    "display:flex",
    "align-items:center",
    "gap:8px",
    "padding:6px 10px",
    "background:#D93025",
    "color:#fff",
    "font:600 12px/1.2 system-ui,-apple-system,Segoe UI,Roboto,sans-serif",
    "border-radius:6px",
    "box-shadow:0 2px 8px rgba(0,0,0,.35)",
    "pointer-events:auto",
  ].join(";");
  var label = document.createElement("span");
  label.textContent = "GTM Injector attivo";
  var off = document.createElement("button");
  off.type = "button";
  off.textContent = "Disattiva";
  off.style.cssText = [
    "cursor:pointer",
    "background:rgba(255,255,255,.2)",
    "border:0",
    "border-radius:4px",
    "padding:2px 6px",
    "font:600 11px/1.2 system-ui,-apple-system,Segoe UI,Roboto,sans-serif",
    "color:#fff",
  ].join(";");
  off.addEventListener("click", async function () {
    await chrome.storage.sync.set({ gtmcodepush: false });
    banner.remove();
  });
  banner.appendChild(label);
  banner.appendChild(off);
  parent.appendChild(banner);
}

async function getstorageValue(params) {
  var position = "head";
  let { gtmcode } = await chrome.storage.sync.get(["gtmcode"]);
  let { gtmcodepush } = await chrome.storage.sync.get(["gtmcodepush"]);
  let { frame } = await chrome.storage.sync.get(["frame"]);
  if (frame && frame === "iframe") {
    position = "body";
  }
  if (gtmcodepush === true) {
    showInjectorBanner();
  }
  if (gtmcodepush && gtmcode !== "") {
    var cleancode = gtmcode
      .replace(/<!-- Google Tag Manager -->\n/g, "")
      .replace(/<script>/g, "")
      .replace(/<\/script>/g, "")
      .replace(/\n<!-- End Google Tag Manager -->/g, "");
    window.postMessage({ action: "setGTMCode", code: cleancode, position }, "*");
  }
}
getstorageValue();
