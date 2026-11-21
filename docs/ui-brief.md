# Brief UI/UX — DataLayer Checker Revamp 1.11.0

Documento per un designer/LLM che deve rifinire **solo l'aspetto**. Scritto il 2026-11-21 sul branch
`release/1.11.0` (commit `8bbecba`).

## Cos'è

Estensione Chrome MV3 interna (team Labelium). Legge il `dataLayer` di una pagina, può iniettare un
container GTM nel frame principale e rispecchiare lì gli eventi che il Custom Pixel di Shopify
spinge nel sandbox. **Niente build, niente framework**: HTML, CSS e moduli ES nativi. Interfaccia in
italiano, uso interno, non va sul Web Store.

## Perimetro di questo lavoro

Solo **UI/UX**: tipografia, spaziature, gerarchia, stati, accessibilità, coerenza.
**Nessuna modifica funzionale**: niente nuovi permessi, niente logica, niente nuove API, nessuna
chiamata `chrome.*` aggiunta. Se un miglioramento estetico richiede un cambio di logica, va
segnalato e non fatto.

## Vincoli duri

1. **Non rinominare** gli id e le classi che il JavaScript cerca. Qui sotto ci sono i più
   importanti; per gli altri vale la regola: se il selettore compare in `ui/*.js`, non si tocca.
2. Il popup è **420×600** (`html.is-popup` in `gstyle.css`): il layout deve reggere a quella misura,
   nel pannello laterale (più stretto) e in una tab larga (1400px).
3. **Niente dipendenze esterne**: nessun font remoto, nessun CDN, nessuna icona da file. Solo
   `system-ui` e `ui-monospace` come definiti nei token.
4. La palette e i raggi sono token in `:root` (`--teal`, `--signal`, `--line`, `--round`…). Si possono
   aggiungere token, non stravolgere la palette.
5. Rispettare `prefers-reduced-motion` per ogni transizione.
6. Accessibilità: focus visibile su ogni controllo interattivo, `aria-expanded` sui disclosure,
   contrasto almeno AA sul testo piccolo (11-13px).

## Id/classi che il JS o i test usano (non rinominare)

```
#target-bar #target-host #target-unpin #target-pin #target-pin-strip #injector-chip
#settings-toggle #settings-view #app-version #env-select
#events-view #events-search #search-clear #events-list #events-split #copy-push
#detail-body #detail-name #detail-time #detail-index #detail-json #empty-state #containers-strip
#uat-view #collect-input #collect-add #collect-parsed #collect-summary #collect-bar
#collect-list #collect-clear #collect-copy
#uimode-row #uimode-body #uimode-value #uimode-note #uimode-sidepanel
#injector-row #injector-body #injector-toggle #injector-ta #injector-container #injector-manual
#mirror-row #mirror-body #mirror-toggle #mirror-scope
#toast
```

Classi il cui comportamento è legato al JS/CSS: `.setting`, `.setting-row`, `.setting-body`,
`.setting-line`, `.disclosure`, `.chevron`, `.mini-select`, `.mini-input`, `.status-dot` (+
`chip-on`/`chip-warn`/`chip-off`), `.switch`/`.slider`, `.radio`, `.seg`/`.seg-btn`, `.is-hidden`,
`.view`, `.tab-btn`.

## Com'è oggi (e funziona)

- **Header**: puntino di stato (verde = container iniettato, ambra = fuori dominio o in attesa, testo
  solo nel tooltip), nome del sito in test, ingranaggio per le impostazioni.
- **Schede**: `Eventi` e `UAT`. La scheda `Hit` è stata rimossa in 1.11.0.
- **Impostazioni**: un elenco a righe separate da un filo, niente card. Tre righe:
  `Apertura` (Popup · Pannello laterale · Nuova tab), `GTM Injector` (interruttore + triangolino →
  container e *Collega a Tag Assistant*), `Rispecchia pixel sul Top` (interruttore + triangolino →
  scope degli eventi).
- **Eventi**: lista a sinistra con separatori di navigazione, dettaglio a destra, split trascinabile;
  il push si legge riga per riga e i path si copiano nel formato della Data Layer Variable di GTM.

## Difetti misurati il 2026-11-21 (con numeri, non impressioni)

1. **Riparato qui**: `#events-view` ereditava `flex: 0 0 250px; width: 250px` dalla regola della
   sidebar (un selettore appeso dopo la rimozione del CSS delle Hit): nel popup da 420px la vista
   eventi occupava 250px e lasciava un vuoto grigio. Ora è 420/420.
2. **Aperto**: nella vista eventi a 420px la lista (42% dell'altezza) resta quasi vuota quando c'è
   una sola navigazione, e il dettaglio si prende il 58%: le proporzioni vanno riviste sul caso
   "pochi eventi".
3. **Aperto**: `.detail-head` mette nome, orario con millisecondi (`18:48:40.577`) e pulsante *Copia*
   sulla stessa riga. Con nomi lunghi il nome si tronca (`dl_view_cart` → `dl_vie…`) perché l'orario
   non si restringe. Priorità al nome; orario su una seconda riga o più corto.
4. **Aperto**: lo stato vuoto della lista e del dettaglio non è progettato: una navigazione sola
   produce una lista che sembra rotta.

Le schermate aggiornate sono in `docs/screenshots/1.11.0/` (`01-eventi`, `02-eventi-dettaglio`,
`03-impostazioni`, `04-impostazioni-aperte`, `05-uat`), 420×600, scala 2.

## Cosa migliorerei (osservazioni, non obblighi)

1. Spaziatura irregolare nelle righe di Impostazioni quando una riga è aperta: il distacco fra
   intestazione e corpo cambia fra le tre righe.
2. Due grammatiche nella stessa lista: `Apertura` mostra `valore + triangolino`, le altre
   `interruttore + triangolino`. Unificarle.
3. I radio di `Apertura` sono alti ~30px l'uno: si può compattare senza perdere leggibilità.
4. Scala tipografica a cinque misure (11, 12, 13, 13.5, 15): ridurla a tre e usarla ovunque.
5. Il footer con la versione è una barra separata: valutare se integrarlo nell'elenco o nell'header.
6. Stato vuoto di lista e dettaglio: poche parole, in italiano, senza spiegoni.
7. Micro-stati: hover/focus uniformi su righe, triangolini e controlli; oggi solo il triangolino ha
   un hover.

## Cosa NON toccare

- La logica in `ui/*.js`, salvo attributi di stile o classi aggiuntive.
- La struttura dei controlli che il JS manipola: puoi cambiare l'involucro, non gli id.
- `manifest.json`, `scripts/*`, `lib/*`, `test/*`.

## Come produce le schermate (un comando)

```bash
node tools/ui-shots.mjs
```

Apre l'estensione in un Chrome headless con la pagina demo, mette la tab in test, e salva **dieci**
schermate in `.ui-shots/`: cinque alla misura del popup (**420×600**) e cinque in una tab larga
(**1100×800**) — `1-eventi`, `2-eventi-dettaglio`, `3-impostazioni`, `4-impostazioni-aperte`, `5-uat`.
Stampa anche una tabella con le misure che nell'immagine non si vedono (larghezza di lista e
dettaglio, larghezza del titolo, quanti elementi sbordano). Zero dipendenze: serve Node e Chrome.

Se il tuo ambiente può eseguire comandi, eseguilo e leggi i PNG: è il modo per vedere l'interfaccia
vera, non una descrizione. Se non può, le schermate le produce chi ha il repo e te le passa.

## Cosa consegnare

- Patch **per file** in diff unificati (`index.html`, `gstyle.css`, e solo righe di markup dentro
  `ui/*.js` se indispensabile).
- Per le scelte non ovvie, un rigo di motivo ("perché così").
- L'elenco di ciò che richiede un controllo a occhio.

## Definizione di "fatto"

- `node test/e2e-mirror.mjs` → 30/30 e `node test/bridge-standard.mjs` → 5/5 (li eseguo io dopo aver
  applicato le patch).
- Nessun id rinominato, nessuna dipendenza aggiunta, nessun `!important` nuovo.
- Screenshot a 420×600 che mostrano: Impostazioni chiusa, Impostazioni aperta, lista eventi con
  dettaglio.
