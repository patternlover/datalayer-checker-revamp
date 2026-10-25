# DataLayer Checker Plus — revamp

Estensione Chrome (Manifest V3) per ispezionare il `dataLayer`, vedere le hit dei vendor e
iniettare codice GTM su un dominio specifico. Vive nel **side panel**: si lavora di fianco
alla pagina, senza aprire la console.

## Installazione

1. Apri `chrome://extensions` (o `edge://extensions`).
2. Attiva **Modalità sviluppatore**.
3. **Carica estensione non pacchettizzata** e scegli la cartella di questa repo.
4. Apri il side panel dall'icona dell'estensione. Serve Chrome 116 o superiore.

## Cosa fa

- **Eventi `dataLayer`** — streaming live, con dettaglio del singolo evento e copia rapida.
- **Hit dei vendor** — GA4, GTM, Google Ads, Meta, TikTok, LinkedIn, Pinterest, Hotjar,
  Clarity: vedi cosa parte davvero, per vendor, invece di fidarti del solo `dataLayer`.
- **Due ambienti** — `Top` e `Pixel`: eventi e hit restano separati, così un pixel dentro
  un iframe non si confonde con la pagina.
- **Sessioni** — le ultime 5 restano in memoria, con i loro eventi (max 500) e hit (max 300):
  ricarichi la pagina e non perdi il contesto.
- **Iniettore GTM** — codice su misura per dominio, con bersaglio `top` o `pixel`.
- **Banner e avviso** — quando l'iniettore è attivo, un banner lo dice su ogni tab: non
  dimentichi l'iniezione accesa.
- **Container probe** — riconosce i container presenti nella pagina (per esempio lo Shopify
  Web Pixels Manager) senza aspettare un evento.

## Screenshot

Gli screenshot vanno in [`docs/screenshots/`](docs/screenshots/). Tre slot, i nomi li fissano
questi riferimenti:

| Cosa mostrare | File |
| ------------- | ---- |
| Side panel con eventi e hit | `docs/screenshots/panel.png` |
| Iniettore GTM con domini | `docs/screenshots/injector.png` |
| Banner di iniezione attiva | `docs/screenshots/banner.png` |

Finché i file non ci sono, la sezione resta un promemoria: nessuna immagine rotta.

## Permessi

| Permesso | Perché |
| -------- | ------ |
| `host_permissions: https://*/*` | l'estensione deve leggere il `dataLayer` e le richieste dei vendor su qualunque sito che stai tracciando |
| `scripting`, `webNavigation` | iniettare il probe e seguire i cambi di pagina nelle SPA |
| `webRequest` | osservare le hit in uscita verso i vendor |
| `storage` | sessioni, impostazioni, codice dell'iniettore |
| `sidePanel` | l'interfaccia vive nel side panel |
| `clipboardWrite` | il pulsante "copia" |

Nessuna richiesta lascia il browser: tutto resta in locale, `chrome.storage.sync` compreso.

## Provenienza

Derivata da **DataLayer Checker Plus**, estensione pubblicata sul Chrome Web Store. Questo
repo è il ramo di sviluppo interno: `lib/`, `ui/` e il container probe sono lavoro nostro,
e il codice si è allontanato dall'originale. Uso interno; non è pubblicata sullo store e non
va ridistribuita fuori dal team.

## Struttura

```text
manifest.json      MV3, side panel, permessi
background.js      service worker: probe, iniezione, storage delle sessioni
index.html         guscio del side panel
gstyle.css         stile del pannello
ui/                interfaccia: eventi, hit, iniettore, settings, store, util
lib/               logica condivisa: collect, correlation, session-store, target, vendors
scripts/           content script, banner, bridge, gtmcode, containerprobe, vendor
images/            icone
docs/              screenshot e note
```
