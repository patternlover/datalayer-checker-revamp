# Ponte pixel → Top: lo standard

2026-11-21 — verificato con il banco di prova descritto in fondo.

## A cosa serve

Gli eventi del checkout nascono nel `dataLayer` del sandbox del Custom Pixel e il `dataLayer` della
pagina non li vede **mai**. Questo contratto li porta nel frame principale, così:

- GTM nel Top li vede come push normali (`begin_checkout`, `add_payment_info`, `purchase`…);
- le **variabili calcolate** (Data Layer Variable, variabili JS, ecommerce) si popolano per davvero
  e in preview si leggono nell'evento, non solo a posteriori;
- chi riceve non deve conoscere Shopify: ascolta un canale e ripusha.

Il pixel continua a fare il suo lavoro (manda ai vendor). Questo è un secondo canale in uscita, non
un sostituto.

Il codice qui sotto è anche in `docs/snippets/` (`pixel-to-top-pixel.js`, `pixel-to-top-top.html`): il file è quello che il test esegue.

## Il contratto

Un solo nome di canale, `shopify-pixel-to-top`, e tre messaggi. Tutto passa da `postMessage` con
`"*"` come origine, perché il sandbox ha origine opaca.

| messaggio | direzione | senso |
|---|---|---|
| `{channel, type:"hello"}` | pixel → top | «sono qui, ho eventi in coda» |
| `{channel, type:"ready"}` | top → pixel | «il mio ascoltatore è installato, mandali» |
| `{channel, type:"push", payload, isGtag}` | pixel → top | un push da rimettere nel `dataLayer` |

Regole:

- **si manda l'oggetto com'è**: la forma la decide il pixel, non il ponte;
- gli eventi `gtm.*` del container che gira nel sandbox **non si mandano**: sono il ciclo di vita di
  quell'istanza, non eventi del negozio;
- `push(arguments)` (stile `gtag`) viaggia come array con `isGtag: true`, e il Top lo rimette in
  `gtag()`: così le tag GA4 senza `event` funzionano come in pagina;
- il backlog si manda una volta sola al `ready`: il pixel pusha prima che la pagina abbia finito di
  caricarsi, e senza questo si perdono i primi eventi;
- **niente dati personali in più**: il ponte non aggiunge, non toglie e non filtra il contenuto.

## Lato pixel (Shopify → Impostazioni → Eventi cliente → pixel personalizzato)

```js
// Ponte standard: porta nel frame principale i push del dataLayer del sandbox.
(function () {
  var CHANNEL = "shopify-pixel-to-top";
  var queue = [];
  var acked = false;

  function post(payload, isGtag) {
    try {
      window.top.postMessage({ channel: CHANNEL, type: "push", payload: payload, isGtag: !!isGtag }, "*");
    } catch (e) {}
  }

  function isGtagPush(a) {
    return !!a && typeof a === "object" &&
      (Object.prototype.toString.call(a) === "[object Arguments]" ||
        Object.prototype.hasOwnProperty.call(a, "callee"));
  }

  function skip(ev) {
    if (!ev || typeof ev !== "object") return true;
    return typeof ev.event === "string" && ev.event.indexOf("gtm.") === 0;
  }

  // Una sola strada per backlog e push nuovi: se un push è in stile gtag va classificato anche
  // quando è già dentro il dataLayer, altrimenti nel Top arriva come oggetto e non come comando.
  function handle(a) {
    if (isGtagPush(a)) {
      var arr = Array.prototype.slice.call(a);
      if (acked) post(arr, true); else queue.push({ payload: arr, isGtag: true });
      return;
    }
    if (skip(a)) return;
    if (acked) post(a, false); else queue.push({ payload: a, isGtag: false });
  }

  function flush() {
    while (queue.length) {
      var m = queue.shift();
      post(m.payload, m.isGtag);
    }
  }

  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || d.channel !== CHANNEL) return;
    if (e.source !== window.top) return;      // solo il frame principale
    if (d.type !== "ready") return;
    acked = true;
    flush();
  });

  // Si aggancia appena il dataLayer esiste, mandando subito il backlog che trova.
  var timer = setInterval(function () {
    if (!Array.isArray(window.dataLayer)) return;
    clearInterval(timer);
    window.dataLayer.forEach(handle);
    var push = window.dataLayer.push;
    window.dataLayer.push = function () {
      for (var i = 0; i < arguments.length; i++) handle(arguments[i]);
      return push.apply(window.dataLayer, arguments);
    };
  }, 100);

  // Il ricevitore può nascere dopo di noi: si ritenta, e appena qualcuno risponde la coda si svuota.
  function hello() {
    try { window.top.postMessage({ channel: CHANNEL, type: "hello" }, "*"); } catch (e) {}
  }
  hello();
  setTimeout(function () { if (!acked) hello(); }, 1000);
  setTimeout(function () { if (!acked) hello(); }, 3000);
})();
```

Nello stesso pixel restano le sottoscrizioni che hai già (`analytics.subscribe("checkout_started", …)`
ecc.): quelle pushano nel `dataLayer` del sandbox, e il ponte le porta su.

## Lato Top

Due ricevitori possibili, identici nel comportamento. **Non servono entrambi**: se c'è GTM nel
frame principale, quello è il posto giusto.

### Con GTM (tag HTML personalizzato, trigger *Initialization — All Pages*)

```html
<script>
(function () {
  var CHANNEL = "shopify-pixel-to-top";
  window.dataLayer = window.dataLayer || [];
  if (!window.__pixelToTopReady) {
    window.__pixelToTopReady = true;
    window.addEventListener("message", function (e) {
      var d = e.data;
      if (!d || d.channel !== CHANNEL) return;
      // Il pixel annuncia la sua presenza: si risponde, altrimenti la sua coda resta chiusa. Serve
      // perché i due lati possono nascere in qualunque ordine (il sandbox prima del container, il
      // container prima del sandbox).
      if (d.type === "hello") {
        try { e.source.postMessage({ channel: CHANNEL, type: "ready" }, "*"); } catch (err) {}
        return;
      }
      if (d.type !== "push") return;
      if (d.isGtag) {
        window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
        window.gtag.apply(null, d.payload);
      } else {
        window.dataLayer.push(d.payload);
      }
    });
  }
  // Sveglia i sandbox già presenti: senza questo i loro eventi restano in coda fino al prossimo giro.
  var frames = document.querySelectorAll('iframe[src*="/sandbox/"]');
  for (var i = 0; i < frames.length; i++) {
    try { frames[i].contentWindow.postMessage({ channel: CHANNEL, type: "ready" }, "*"); } catch (e) {}
  }
})();
</script>
```

Il trigger deve essere *Initialization*: se il ricevitore si installa a DOM Ready, i primi eventi
del pixel (che arrivano prima) restano in coda e vanno persi quando la pagina cambia.

### Senza GTM (estensione DataLayer Checker)

Il ponte dell'estensione fa la stessa cosa per conto suo, dal background, senza codice in pagina:
non c'è da incollare niente. I due canali sono indipendenti e non si pestano i piedi (l'estensione
non ascolta `shopify-pixel-to-top`).

## Vedere le variabili calcolate in checkout

1. GTM → **Preview** con il container che gira nel frame principale del checkout. Serve un'istanza
   lì: nel tuo browser la mette l'injector dell'estensione, con *Collega a Tag Assistant* acceso.
2. Nel pannello, per ogni evento, la scheda **Variables** mostra i valori risolti *a quel push*:
   Data Layer Variable (`ecommerce.items.0.item_id`, `checkout.totalPrice.amount`…), variabili JS e
   i parametri che i tag hanno effettivamente usato.
3. Nel pannello dell'estensione, click sul nome di un campo copia il path nel formato della Data
   Layer Variable — così il path che incolli in GTM è quello vero, non uno indovinato.

Tre trappole che falsano la lettura:

- **il push di `ecommerce` si fonde con il precedente**: prima di un nuovo `ecommerce` va pushato
  `{ecommerce: null}`, altrimenti `items` sembra popolato quando è rimasto quello di prima;
- **una variabile legge l'ultimo push**: se il pixel pusha `checkout` solo sugli eventi di checkout,
  la variabile è vuota su `page_view` — è corretto, non è un errore di configurazione;
- **il consenso del Top non è quello del pixel**: il container iniettato parte dal default del
  container, quindi una variabile di consenso può dire `granted` dove il pixel aveva `denied`. La
  preview dice che l'evento arriva e che valori porta, non che il consenso era quello giusto.

## Limiti, detti

- **il ponte non rende visibile l'istanza che gira nel sandbox**: Tag Assistant legge una tab, non
  un iframe a origine opaca. Il container che si elenca è quello del frame principale.
- **il frame principale del checkout non ha GTM per i visitatori veri**: lì il pixel è l'unico punto
  di ingresso. Il ponte serve a guardare, non a spedire.
- **nessun ascolto fra tab**: il `postMessage` arriva solo al frame principale della stessa pagina.
- **origine**: `"*"` è obbligatorio (origine opaca), e per questo i due lati controllano
  `event.source`. Non si aggiungono altri dati al messaggio.

## Banco di prova (verificato il 2026-11-21)

`node test/bridge-standard.mjs` : serve due file statici, li apre in Chrome headless con la pagina
`pc.html` che contiene un `iframe sandbox="allow-scripts"` servito da `/sandbox/modern/…`, il pixel
che pusha `checkout_started` + un `gtm.js` (da scartare) + un `push(arguments)`, e verifica che nel
Top arrivino solo gli eventi giusti, nell'ordine giusto, con `isGtag` trattato come tale.
