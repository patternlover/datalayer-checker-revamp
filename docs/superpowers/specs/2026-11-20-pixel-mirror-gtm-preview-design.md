# Ponte pixel → Tag Assistant: gli eventi del checkout nel dataLayer del Top

2026-11-20 — design breve, da approvare prima di scrivere codice.

## Intent

Vedere in **GTM Preview** gli eventi del checkout che il Custom Pixel di Shopify spinge nel
sandbox, con lo stesso nome e lo stesso payload che hanno lì: niente prefissi, niente campi
aggiunti. `begin_checkout`, `add_payment_info`, `checkout_completed` non passano dal Top e non
passeranno mai: il container nel tema non li vede. Il ponte esiste per quei tre eventi.

Oggi l'estensione **legge già** quei dati (`isSandboxUrl` + `injectInto` in `background.js`,
selettore Top/Pixel). Quello che manca è portarli dove Tag Assistant li guarda.

## Assetto, e cosa resta com'è

GTM vive **dentro il pixel del checkout** (snippet nel custom pixel): è l'assetto di produzione e
non si tocca. Gli eventi che il pixel pusha nel sandbox vengono rispecchiati **verbatim** nel
`dataLayer` del frame principale, e il container che gira lì li riceve.

Perché il Top debba avere un'istanza: Tag Assistant si aggancia a un container **presente nella
pagina**, e sul checkout il frame principale non ne ha nessuno. Quell'istanza la mette il campo
Injector che esiste già (`registerContentScripts` sui domini configurati, `allFrames: false`
copre `/checkouts/...`): è la stessa cosa che Stape ha annunciato ad aprile 2026.

**Conseguenza accettata**: con lo snippet di produzione nel Top, i tag scattano una seconda volta
sui rispecchiati, e per un `purchase` sono due hits con lo stesso `transaction_id` — GA4 non
deduplica per `transaction_id`. In DebugView e nei report lo vedrai doppio: aspettarselo, non è
un difetto dell'estensione. Chi vuole vedere gli eventi senza il secondo invio mette nel campo
Injector un container di debug vuoto: opzione documentata, non obbligo.

L'avviso resta comunque, e non blocca: `containerprobe.js` gira già nei frame del sandbox e
riporta gli ID dei container presenti lì (`type: "containers"`, `meta.isShopifySandbox`). Se
l'ID iniettato nel Top compare anche nel sandbox, il toggle lo dice e chiede conferma per quella
tab.

## Scope: solo eventi di checkout

`pixelmirrorScope` = `solo-checkout` (default) | `sempre`, e il default è `solo-checkout`:
sul resto dello store il tema traccia già, il pixel pusha la stessa cosa e rispecchiarla
aggiungerebbe un secondo invio senza aggiungere informazione.

La decisione si prende sull'**URL del frame del sandbox**, non su quello del Top: il sandbox
traccia la pagina vera e la porta nel proprio path
(`/web-pixels@…/sandbox/modern/checkouts/cn/<token>/en-us`, `…/sandbox/modern/products/x`). Si
rispecchia quando quel path contiene `/checkouts/` o `/orders/`, che copre checkout, thank-you e
order status. Il path del Top non serve e in alcuni casi inganna: con il checkout a pagina unica
la rotta non cambia fra i passi, e le pagine prerenderizzate hanno un frameId che non è 0.

## Come funziona (tre pezzi)

1. **`scripts/mirror.js`**, iniettato in world MAIN nel frame del sandbox (stesso percorso di
   `containerprobe.js`: `executeScript({ frameIds: [frameId] })`). Aspetta `window.dataLayer`,
   manda il backlog esistente e poi avvolge `push`, come faceva `scripts/listener.js` della
   versione `datalayer-checker-plus`. Canale: l'evento DOM privato `__dlc_msg:main` già usato da
   `bridge.js`/`content.js`, non `window.postMessage` (che i listener del sito vedono). Scarta
   `gtm.dom`/`gtm.load` del container che gira nel sandbox: sono il ciclo di vita di quell'istanza,
   non eventi del negozio.
2. **Ricevitore nel Top**: in `scripts/gtmcode.js` (o un `scripts/mirror-top.js` accanto), quando
   `window.top === window`, ogni push ricevuto viene pushato **identico** in `window.dataLayer`.
3. **Impostazioni**: toggle `pixelmirror` con l'etichetta "Rispecchia pixel sul Top" e manopola
   `pixelmirrorScope`. Il container per il Top si mette nel campo Injector già esistente, con il
   dominio dello store; si spegne a debug finito (il banner esistente lo ricorda).

Spento il toggle: nessuna iniezione di `mirror.js`, nessun push. I frame `shopify-custom-pixel`
restano esclusi da `isSandboxUrl`.

## Approcci scartati

- **Prefisso sugli eventi** (`px_…`): nessun tag scatta, ma non è "come sono" e il nome lo
  inventa l'estensione.
- **Iniezione del container di produzione nel sandbox** (la strada di Stape): nel caso reale il
  sandbox esegue già un'istanza dello stesso container, quindi `containersOnPage()` salterebbe
  l'iniezione e non cambierebbe niente.
- **`browser_evaluate` con selettore di frame in `chrome-agent-mcp`**: dà i payload a un agente in
  sessione, non a Tag Assistant. Lavoro separato, altro scopo.
- **Regola «se il path è `/checkouts/` non rispecchiare»**: nasconderebbe il ponte proprio dove
  serve. Lo scope giusto è l'inverso, e si legge dal sandbox.

## Non obiettivi

- Non modifica il container né le sue versioni: lo esegue, e ne accetta i tag.
- Non funziona con gli **app pixel** (sandbox strict, girano in un worker): lì non c'è un
  `window.dataLayer` da agganciare. Da verificare, non assunto.
- Non copre lo storefront: scelta, vedi Scope.
- Non riproduce il consenso né l'ordine di caricamento della produzione: la preview dice che
  l'evento arriva e che cosa manda il tag, non che il consenso era quello giusto.

## Verifica

1. **In locale, offline**: pagina demo in `docs/demo/` con un iframe `sandbox="allow-scripts"`
   servito da `docs/demo/sandbox/modern/checkouts/demo/pixel.html` — l'URL contiene
   `/sandbox/modern/`, quindi `isSandboxUrl` lo riconosce come pixel, e contiene `/checkouts/`,
   quindi è in scope. La pagina figlia pusha eventi a intervalli, più un `gtm.dom` che deve
   sparire. Atteso: gli eventi compaiono identici in `window.dataLayer` della pagina madre, la tab
   Top li mostra, la tab Pixel li mostra come prima. Seconda pagina demo con path
   `/sandbox/modern/products/x`: nessun rispecchiamento.
2. **Sul campo (2 minuti, nessun ordine finto)**: Injector con lo snippet sul dominio dello store,
   preview aperta su quel container, carrello → `checkout_started`. Atteso: l'evento con il suo
   payload nella timeline di Tag Assistant e i tag che scattano su quell'evento. Il `purchase` si
   verifica con un ordine reale o non si verifica.

## Costo

~130 righe: `scripts/mirror.js` (40), ricevitore nel Top (25), toggle e scope in `ui/settings.js`
+ `index.html` + `options.html` (35), avviso e banner (25), `CHANGELOG.md` e `README.md` (una
voce).

## Quello che resta a chi costruisce

- se il ricevitore sta dentro `gtmcode.js` o in un file suo;
- come ricavare l'ID del container iniettato (c'è già `extractContainerIdsFromCode`) e come
  confrontarlo con quelli riportati dal frame del sandbox;
- se il seed del backlog debba saltare i primissimi eventi già presenti nel Top.

## Esito (implementato il 2026-11-20, branch `feat/pixel-mirror-gtm-preview`)

Codice: `scripts/mirror.js` (nuovo), `scripts/content.js` (una voce sul canale privato),
`background.js` (impostazioni, scope, push nel Top, aggancio su nav e su cambio impostazioni),
`lib/session-store.js` (`containers.pixel`), `ui/settings.js` + `index.html` (toggle e scope),
demo in `docs/demo/mirror.html` e `docs/demo/mirror-prodotti.html`, `test/e2e-mirror.mjs`.

Tre scelte fatte in corso d'opera, che il doc sopra non fissava:

- si scartano **tutti** gli eventi `gtm.*` del sandbox, non solo `gtm.dom`/`gtm.load`: anche
  `gtm.js` è il ciclo di vita di quel container e rispecchiarlo confonderebbe l'istanza del Top;
- oltre a `gtm.uniqueEventId` si toglie anche `gtm.start`, per la stessa ragione;
- nessuna deduplica: `mirror.js` si installa una volta per documento (`__dlcMirrorReady`) e manda
  il backlog una volta sola, quindi un doppione non può nascere dal ponte stesso.

Verifica: `node test/e2e-mirror.mjs`, 15/15. Misurato su Chrome 158 headless il 2026-11-20:

- `Extensions.loadUnpacked` è l'unico modo di caricare l'estensione in Google Chrome: il binario
  brandizzato ignora `--load-extension` (`--disable-extensions-except is not allowed in Google
  Chrome, ignoring` nel log) e serve `--enable-unsafe-extension-debugging`;
- il ponte porta `checkout_started` e i `begin_checkout` nel `dataLayer` del Top, payload identico,
  senza `gtm.*` e senza chiavi interne;
- con scope `solo-checkout` la pagina prodotto non riceve niente, con `sempre` riceve
  `product_viewed`, con il ponte spento niente;
- la tab Pixel continua a raccogliere (6 eventi, `pixelSeen: true`): il ponte è in più, non al posto.

Non verificato qui, e da provare sul campo: il checkout vero di Shopify (servono un container
iniettato nel Top e una preview aperta su quel container) e gli app pixel in worker, dove non c'è
un `window.dataLayer` da agganciare.

## Perché la preview restava vuota (misurato 2026-11-20)

Il ponte funzionava (eventi nel `dataLayer`, tab Top piena) e Tag Assistant non mostrava niente.
Causa, letta nel sorgente di `gtm.js` (`https://www.googletagmanager.com/gtm.js?id=…`, scaricato
il 2026-11-20): un'istanza entra in debug **solo** con uno di quattro segnali, e li enumera come
`GTM_DEBUG_PARAM` (`gtm_debug` in query), `REFERRER` (host `tagassistant.google.com`), `COOKIE`
(cookie `__TAG_ASSISTANT`, **due** underscore) e `EXTENSION_PARAM` (attributo
`data-tag-assistant-prod-present` su `<html>`, valore = timestamp entro −15/+5 minuti, oppure
evento `TAProdDebugSignal` sulla window).

Sul checkout il primo segnale non c'è (la navigazione dal carrello non porta dietro il parametro),
il secondo e il terzo nemmeno: il container iniettato gira, esegue i tag, e non si presenta a
nessuna preview. Non è un problema del ponte, è un'istanza che non sa di essere in debug.

Verificato anche che **non** è colpa della CSP: il checkout di uno store Shopify (`allbirds.com`,
2026-11-20) manda `content-security-policy: block-all-mixed-content; upgrade-insecure-requests;
frame-ancestors …` senza `script-src` né `default-src`, quindi uno script inline iniettato non
viene bloccato. In locale ho verificato il contrario per una CSP stretta: uno script inline creato
dall'estensione è bloccato **in silenzio** (nessuna eccezione, solo una voce in console), che è il
modo in cui «non si vede più niente» senza indizi.

Rimedio implementato: `scripts/gtmcode.js` mette `data-tag-assistant-prod-present` prima di
iniettare, dietro l'opzione **Collega a Tag Assistant** (accesa di default). L'altra strada, senza
codice: aprire la preview direttamente **sull'URL del checkout** invece di partire dallo
storefront, così `gtm_debug` è nel documento fin dal primo istante.

Secondo difetto trovato nello stesso giro: `mirrorToTop` era atteso dentro la coda `serial` della
tab, la stessa degli snapshot del `dataLayer`. Un `executeScript` lento bastava a mettersi davanti
alla lettura e a far sembrare il pannello fermo; ora il ponte parte e non si aspetta.

## Verifica su uno store di produzione (2026-11-21)

Misurato sul checkout vero di uno store Shopify, con l'estensione 1.11.0 caricata in Chrome 158 e
l'Injector acceso sul container del sito (snippet standard, dominio dello store):

- nel frame principale del checkout girano il container del sito e la sua destinazione GA4: uno
  dei due viene solo dal tema, quindi l'iniezione ha funzionato dove non c'era nessun container;
- l'attributo `data-tag-assistant-prod-present` è presente: l'istanza si dichiara in debug;
- nel `dataLayer` del Top c'è `begin_checkout` con il suo `ecommerce`, e il container gli ha
  messo `gtm.uniqueEventId`: l'ha processato, quindi i suoi tag sono partiti (il doppio invio è
  reale, non teorico);
- il frame del sandbox riporta **lo stesso** container del Top: `containers.pixel` e
  `containers.injected` si sovrappongono, `conflict: true`, e la card *Rispecchia pixel sul Top*
  lo segnala;
- la cattura del pixel resta attiva: 26 eventi dal frame sandbox nella stessa sessione.

Cosa non è stato possibile verificare da un agente, e resta un passo umano: Tag Assistant si
aggancia solo alla tab che apre **lui**. Da qui il pannello mostra `Not connected` / `0 Google
tags found` anche con l'istanza in debug, perché la tab del checkout è stata aperta a mano. La
ricetta che funziona è quella dell'interfaccia: Preview da GTM, e poi carrello → checkout
**nella stessa tab** che ha aperto Tag Assistant. Se il checkout si apre in una tab nuova, o fa
un salto su un altro dominio, Tag Assistant si sgancia e scrive `Debug window closed`.
