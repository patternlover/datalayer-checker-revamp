# DataLayer Checker Revamp

Estensione Chrome (MV3) per leggere il `dataLayer` di una pagina e iniettare un container GTM su
un dominio. Uso interno del team: non è sullo store e non si distribuisce fuori.

## Installazione

Serve Chrome 116+ e accesso alla repo privata (fatti aggiungere come collaboratore).

```bash
git clone https://github.com/patternlover/datalayer-checker-revamp.git
```

1. `chrome://extensions` → **Modalità sviluppatore**.
2. **Carica estensione non pacchettizzata** → la cartella clonata (con `manifest.json`).
3. Clicca l'icona: si apre il popup, come le altre estensioni.

Nessun build. Per aggiornarla: `git pull` e poi **⟳** in `chrome://extensions`.
Cronologia delle versioni e come tornare indietro: `CHANGELOG.md`.

## Partire in 30 secondi

1. Apri il sito in una tab normale, apri il popup, premi **Testa example.com**.
2. Naviga: ogni push del `dataLayer` compare in tempo reale, con un separatore a ogni pagina.
3. Senza un sito cliente: in `docs/demo/` c'è un finto negozio —
   `python3 -m http.server 8080`, poi `http://localhost:8080` e **Testa localhost**.
   Il finto checkout per il ponte è `http://localhost:8080/mirror.html` (iframe sandboxato su
   `/sandbox/modern/checkouts/…`), la pagina fuori scope è `mirror-prodotti.html`.
4. Scheda **Hit**: le chiamate che partono (GA4, Meta, TikTok…) con i parametri decodificati.

Per verificare il ponte senza toccare Chrome: `node test/e2e-mirror.mjs` (carica l'estensione in un
profilo temporaneo, mette in test le due pagine demo e controlla cosa arriva nel `dataLayer` del
Top). Su Google Chrome serve `--enable-unsafe-extension-debugging`: lo script lo passa da solo.

La tab in test **non segue il focus**: puoi passare a Sheets, a GTM o a un'altra tab senza
perdere la cattura. **Passa a …** sposta il test, **✕** (due click) chiude la sessione e azzera
gli eventi raccolti.

## Cosa fa

- **Eventi in tempo reale** — lista degli push, dal più recente, con un separatore a ogni
  navigazione (anche SPA). Click sull'intestazione per chiudere o riaprire quel gruppo.
- **Albero del push** — il push selezionato riga per riga: click sul **nome** copia il path nel
  formato della Data Layer Variable di GTM (`ecommerce.items.0.item_id`), click sul **valore**
  copia il valore. Il testo si seleziona normalmente; **Copia** dà l'evento intero nel formato
  per Sheets.
- **Ricerca per nome, valore o path** — `ecommerce.items.3.item_category2` trova l'evento che ha
  quel parametro sul quarto item, non solo chi contiene quella stringa.
- **Top / Pixel** — il `dataLayer` dei Shopify Custom Pixel sta in un iframe e viene catturato in
  parallelo: il selettore (o `T` / `P`) cambia solo la vista, senza perdere dati.
- **Hit dei vendor** — le chiamate di rete che partono dalla pagina, decodificate con i dizionari
  dei parametri di Omnibug: GA4, Universal Analytics, GTM, Google Ads, Meta, TikTok, LinkedIn,
  Pinterest, Snapchat, Reddit, Microsoft Ads, Criteo, Hotjar, Clarity. I parametri arrivano divisi
  in gruppi (Generale, Eventi, E-commerce…): click sul nome per copiare il parametro grezzo, click
  sul valore per copiare il valore, **cURL** per la richiesta intera col corpo POST. Le hit vicine a
  un push mostrano `#n` e portano all'evento. Corpo POST compreso (TikTok manda JSON, non query string).
- **DataLayer vecchi e UA** — funziona anche con i push di una volta: `dataLayer.push(arguments)`
  e i dataLayer che iniziano con le sole variabili di pagina, senza `event` (righe «Message»,
  leggibili ma distinte dagli eventi di business).
- **UAT** — incolla la colonna *DataLayer TO BE* del foglio, **Aggiungi**: il pannello segna quali
  eventi sono già scattati (Top o Pixel, con l'ora) e **Copia UAT** dà il blocco da incollare.
  Vale per sito, sopravvive a refresh e riavvio, `*` è jolly.
- **GTM Injector** — domini + container in *Impostazioni* (snippet completo con il loader di `gtm.js`,
  `<script src>`, solo ID `GTM-XXXX` oppure JavaScript), solo frame principale e solo `https`.
  Il chip nell'header dice se il container è in pagina; un banner ricorda che è attivo
  (**Disattiva** spegne, **×** chiude il banner). Se il container c'è già, l'iniezione si salta.
- **Prendi il container da questa pagina** — il pulsante che evita la configurazione a mano: legge il container già in pagina (anche dal frame del pixel) e accende Injector, Tag Assistant e ponte.
- **Collega a Tag Assistant** (nella card dell'Injector, acceso di default) — `gtm.js` entra in
  debug solo con uno di quattro segnali: `gtm_debug` in query, referrer di
  `tagassistant.google.com`, cookie `__TAG_ASSISTANT`, oppure l'attributo
  `data-tag-assistant-prod-present` su `<html>`. Sul checkout i primi tre non ci sono, quindi un
  container iniettato lì gira ma non compare in preview: l'opzione mette l'attributo prima di
  iniettare, e Tag Assistant lo vede.
- **Rispecchia pixel sul Top** — *Impostazioni*, spento di default. Gli eventi del checkout
  (`checkout_started`, `add_payment_info`, `checkout_completed`…) nascono nel sandbox del Custom
  Pixel e il `dataLayer` della pagina non li vede: con questa opzione arrivano **identici** nel
  `dataLayer` del frame principale, dove Tag Assistant li mostra in preview. Di default vale solo
  per `/checkouts/` e `/orders/`; *Tutte le pagine* allarga. Per vederli in preview serve un
  container nel Top (campo Injector acceso): senza, la preview non ha a cosa agganciarsi e resta
  vuota. Se quel container gira **anche** nel pixel, i suoi tag scattano una seconda volta:
  l'estensione lo dice, non lo impedisce.
- **Stato della pagina** — *Impostazioni* → **Leggi la pagina**: container presenti, se l'Injector ha iniettato, se il container è in debug, se il canale di Tag Assistant c'è, eventi di checkout e sandbox del pixel. Da qui in poi il primo posto dove guardare.
- **Apertura** — default **popup** agganciato all'icona; da *Impostazioni → Apertura* si passa a
  finestra separata (debug lunghi) o pannello laterale (solo su Chrome).

## Da sapere

- **Permessi** — `https://*/*` serve a leggere il `dataLayer` di qualunque sito stai testando
  (Chrome lo chiede all'installazione); `scripting`, `webNavigation`, `webRequest` per la
  cattura, in sola lettura; `storage`, `clipboardWrite`, `sidePanel` per il resto.
- **Cosa esce dal browser** — eventi e sessioni restano in locale. Solo impostazioni, domini e
  snippet stanno in `chrome.storage.sync`, cioè nel tuo account Google: niente è condiviso.
- **Se l'icona non apre più niente** — con *Apertura → Pannello laterale* su un browser che espone
  l'API ma non mostra il pannello (Arc), l'estensione apre la finestra separata e lo dice in
  *Impostazioni*. Da `chrome://extensions` → Dettagli → **Opzioni estensione** si rientra comunque
  nella UI, per rimettere il popup: prima l'unica via era rimuovere e ricaricare l'estensione.

## Cosa non fa

Non verifica una specifica (per quello c'è DataLayer Doctor: qui la specifica si spunta a mano
nella scheda UAT) · non esporta file o HAR · non decodifica i vendor fuori dalla lista (Adobe,
Tealium, Segment: aggiungerne uno è una riga in `lib/providers/index.js`) · non funziona su `http://`,
tranne `localhost` · una sola tab in test alla volta · il ponte non copre gli app pixel (sandbox
strict: girano in un worker e lì non c'è un `window.dataLayer` da agganciare) e non rende visibile
in preview l'istanza del container che gira dentro il pixel, solo i suoi eventi.

## Provenienza

Derivata da **DataLayer Checker Plus** (Chrome Web Store): `lib/`, `ui/` e il container probe
sono lavoro nostro, la storia parte dal tag `pre-revamp`.

La decodifica delle hit riusa i dizionari dei parametri di
[Omnibug](https://github.com/MisterPhilip/omnibug) (MIT, © 2017 Philip Lawrence): i file in
`lib/providers/` sono copiati da là e trasformati in moduli ES, testo della licenza incluso. Il
resto (cattura, correlazione con il dataLayer, interfaccia) è nostro.
