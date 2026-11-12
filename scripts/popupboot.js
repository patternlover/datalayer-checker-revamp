// Il popup ha una misura fissa: Chrome lo dimensiona sul contenuto (max 800x600), quindi la
// classe va messa prima del primo disegno. Per questo è uno script classico nel <head>, e non
// codice dentro ui/main.js, che è un modulo e gira a parse finito.
// Due segnali, entrambi sincroni: chrome.extension.getViews funziona nelle pagine
// dell'estensione (non nel service worker), il parametro ?popup=1 lo dichiara il manifest
// in default_popup, così la misura c'è anche quando getViews non è disponibile.
(function () {
  var isPopup = false;
  try {
    if (chrome.extension && chrome.extension.getViews) {
      isPopup = chrome.extension.getViews({ type: "popup" }).indexOf(window) !== -1;
    }
  } catch (error) {}
  if (!isPopup && /[?&]popup=1(&|$)/.test(location.search)) isPopup = true;
  if (isPopup) document.documentElement.classList.add("is-popup");
})();
