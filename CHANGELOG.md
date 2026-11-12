# Cronologia

Ogni versione corrisponde alla `version` in `manifest.json`, a un tag git (`v1.9.0`, …) e a un
commit su `main`. Per riprendere una versione vecchia: `git checkout v1.7.0`, oppure dal tag su
GitHub **Download ZIP** e la cartella si carica con "Carica estensione non pacchettizzata".

## 1.9.1 — 2026-11-12

- Il push senza `event` si chiama di nuovo **Message** (era «Senza event»): nome neutro e già
  noto a chi arriva dalle versioni precedenti. Lo stile della riga resta distinto da `gtm.*`.

## 1.9.0 — 2026-11-12

- **dataLayer non standard**: il nome dell'evento si legge anche da `dataLayer.push(arguments)`
  (`{ "0": { event } }`, prima mostrava `[object Object]`) e da `{ "0": "x" }`; la raccolta UAT
  aggancia anche questi eventi. Regola unica in `lib/event-name.js`.
- I push **senza `event`** (dataLayer UA che inizia con le variabili di pagina) hanno un terzo
  stile di riga: leggibili in mono, distinti dal grigio di sistema di `gtm.*`.
- **La ✕ chiede conferma** (secondo click entro 3 secondi, pulsante rosso) e solo allora chiude
  la sessione e azzera gli eventi.
- Ricerca: testo e path del push calcolati una volta per evento (`WeakMap`), non a ogni tasto.
- Placeholder della ricerca: «Cerca nome, valore o path».
- `aria-selected` sulle schede, `aria-expanded` sui gruppi di navigazione.
- Popup a 600px (il massimo consentito): una riga di lista in più.
- Manifest: descrizione senza le hit, che non si vedono ancora.
- README riscritto per il team, senza screenshot.

## 1.8.3 — 2026-11-12

- Niente conteggio eventi nemmeno sull'intestazione di navigazione chiusa.

## 1.8.2 — 2026-11-12

- Niente conteggio eventi nel titolo della scheda (`Eventi`, senza `30/37`).

## 1.8.1 — 2026-11-12

- Il nome dell'evento è sempre la prima riga dell'albero del push, qualunque ordine abbia il
  payload (anche nel JSON espanso della scheda UAT).

## 1.8.0 — 2026-11-12

- Nel dettaglio il click sul **nome** copia il path per la Data Layer Variable, il click sul
  **valore** copia il valore; via l'etichetta «copia», l'affordance è il sottolineato all'hover.
- Il testo del push torna **selezionabile** (righe `div`/`span`, non `button`).
- La **ricerca guarda anche i path**: `ecommerce.items.3.item_category2` trova l'evento che ha
  quel parametro sul quarto item.
- Click sull'intestazione di navigazione: **gruppo chiuso o riaperto**.
- Niente stacco fra ricerca e prima intestazione; pillola Top/Pixel solo nella scheda Eventi.
- La ✕ chiude la sessione e azzera gli eventi raccolti.
- Testi di Apertura riscritti (Chrome nominato solo per il pannello laterale).

## 1.7.0 — 2026-11-12

- **Popup come modalità di apertura predefinita** (finestra separata e pannello laterale restano
  scegliibili da Impostazioni), con `scripts/popupboot.js` che dà la misura al riquadro.
- Il dettaglio dell'evento è un **albero di righe**: il click su un parametro copia il suo path
  nel formato della Data Layer Variable di GTM (`ecommerce.items.0.item_id`).
- La riga `event` è in grassetto anche nel dettaglio.

## 1.6.0 e precedenti

Prima del revamp dell'interfaccia: storia nel tag `pre-revamp` e nei commit fino a `424d780`.
