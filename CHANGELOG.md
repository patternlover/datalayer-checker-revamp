# Cronologia

Ogni versione corrisponde alla `version` in `manifest.json`, a un tag git (`v1.9.1`, …) e a una release su GitHub. Per riprendere una versione vecchia: `git checkout v1.7.0`, oppure dalla release **Download ZIP** e la cartella si carica con "Carica estensione non pacchettizzata".

Le voci qui sotto stanno su una riga per frase: è il testo che finisce nelle release di GitHub, che va a capo da solo in base alla larghezza. Non spezzare le righe a mano.

## 1.11.0 — 2026-11-20

- **Stato della pagina** (*Impostazioni*): legge la tab in test e mostra container in pagina, se l'Injector ha iniettato, se il container è in debug, se c'è il canale di Tag Assistant (`__TAG_ASSISTANT_API`), se il `dataLayer` ha eventi di checkout e se il sandbox del pixel è presente. È il primo posto da guardare quando "non si vede niente".
- **Rispecchia pixel sul Top** (*Impostazioni*, spento di default): gli eventi che il Custom Pixel spinge nel sandbox arrivano identici nel `dataLayer` del frame principale, dove GTM Preview li mostra. È l'unico modo per vedere `checkout_started`, `add_payment_info` e `checkout_completed`: il container del tema non li riceve e Tag Assistant non si aggancia al sandbox.
- Lo scope di default è **solo checkout e ordini** (`/checkouts/`, `/orders/`), letto dal path del frame sandbox e non dal Top: con il checkout a pagina unica la rotta del Top non cambia fra i passi. *Tutte le pagine* è l'altra scelta.
- Gli eventi `gtm.*` del container che gira nel sandbox si scartano, e `gtm.uniqueEventId`/`gtm.start` si tolgono prima del push: con l'id interno del sandbox il container del Top scarterebbe l'evento come già visto.
- Se il container iniettato nel Top gira anche nel pixel, *Impostazioni* lo dice: rispecchiare lo fa partire due volte, e un `purchase` risulterebbe doppio. L'avviso non blocca.
- `session.containers.pixel` separa i container visti nel frame pixel da quelli della pagina.
- **Collega a Tag Assistant** (card Injector, acceso di default): prima di iniettare mette `data-tag-assistant-prod-present` su `<html>`. `gtm.js` si dichiara in debug solo con `gtm_debug` in query, referrer di tagassistant.google.com, cookie `__TAG_ASSISTANT` o quell'attributo: sul checkout i primi tre non ci sono, quindi il container iniettato girava senza comparire in preview.
- Il ponte non passa più dalla coda `serial` della tab: un `executeScript` lento non mette più in fila gli snapshot del dataLayer (era il modo per far sembrare il pannello fermo).
- Se il ponte è acceso e l'Injector è spento, la card lo dice: senza un container nel Top la preview non ha a cosa agganciarsi e resta vuota ("Debug window closed").
- **Il campo Injector accetta tre forme**: il blocco completo (funzione loader o `<script src="…gtm.js?id=…">`), il solo ID `GTM-XXXX` (il loader lo costruisce l'estensione) e il JavaScript da eseguire. Prima i tag `<script>` venivano spogliati, quindi uno snippet con `src` perdeva l'URL e in pagina non arrivava niente; un valore che non è nessuna delle tre forme non si inietta e la card dice perché.
- Pagine demo nuove in `docs/demo/` (`mirror.html`, `mirror-prodotti.html`) e `node test/e2e-mirror.mjs`: carica l'estensione in un profilo temporaneo, mette in test le due pagine e controlla cosa arriva nel `dataLayer` del Top. Google Chrome ignora `--load-extension`: lo script usa il dominio CDP `Extensions` con `--enable-unsafe-extension-debugging`.

## 1.10.0 — 2026-11-19

- **Scheda Hit**: le chiamate di rete della pagina, decodificate. Non più nascoste dietro la correlazione: si vedono tutte, con `#n` su quelle vicine a un push del dataLayer.
- I dizionari dei parametri sono quelli di **Omnibug** (MIT): GA4, Universal Analytics, GTM, Google Ads, Meta, TikTok, LinkedIn, Pinterest, Snapchat, Reddit, Microsoft Ads, Criteo, Hotjar, Clarity. I parametri hanno un nome leggibile e stanno in gruppi (Generale, Eventi, E-commerce…).
- **Corpo POST** letto e decodificato (TikTok manda JSON, non query string); **cURL** copia la richiesta intera, corpo compreso.
- Click sul nome di un parametro: copia la chiave grezza; sul valore: copia il valore. Filtri per vendor, ricerca su vendor, nome, valore e corpo POST. Il selettore Top/Pixel vale anche qui.
- Pannello laterale: il click lo gestisce l'estensione, non il browser. Se il pannello non si apre davvero (Arc non implementa `chrome.sidePanel`) si apre la finestra separata e lo si dice in **Impostazioni**, invece di lasciare l'icona muta fino alla rimozione dell'estensione.
- Nuova pagina **Opzioni estensione**: da `chrome://extensions` si rientra nella UI anche quando l'apertura scelta non funziona, senza rimuovere e ricaricare.

## 1.9.1 — 2026-11-12

- Il push senza `event` si chiama di nuovo **Message** (era «Senza event»): nome neutro e già noto a chi arriva dalle versioni precedenti. Lo stile della riga resta distinto da `gtm.*`.

## 1.9.0 — 2026-11-12

- **dataLayer non standard**: il nome dell'evento si legge anche da `dataLayer.push(arguments)` (`{ "0": { event } }`, prima mostrava `[object Object]`) e da `{ "0": "x" }`; la raccolta UAT aggancia anche questi eventi. Regola unica in `lib/event-name.js`.
- I push **senza `event`** (dataLayer UA che inizia con le variabili di pagina) hanno un terzo stile di riga: leggibili in mono, distinti dal grigio di sistema di `gtm.*`.
- **La ✕ chiede conferma** (secondo click entro 3 secondi, pulsante rosso) e solo allora chiude la sessione e azzera gli eventi.
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

- Il nome dell'evento è sempre la prima riga dell'albero del push, qualunque ordine abbia il payload (anche nel JSON espanso della scheda UAT).

## 1.8.0 — 2026-11-12

- Nel dettaglio il click sul **nome** copia il path per la Data Layer Variable, il click sul **valore** copia il valore; via l'etichetta «copia», l'affordance è il sottolineato all'hover.
- Il testo del push torna **selezionabile** (righe `div`/`span`, non `button`).
- La **ricerca guarda anche i path**: `ecommerce.items.3.item_category2` trova l'evento che ha quel parametro sul quarto item.
- Click sull'intestazione di navigazione: **gruppo chiuso o riaperto**.
- Niente stacco fra ricerca e prima intestazione; pillola Top/Pixel solo nella scheda Eventi.
- La ✕ chiude la sessione e azzera gli eventi raccolti.
- Testi di Apertura riscritti (Chrome nominato solo per il pannello laterale).

## 1.7.0 — 2026-11-12

- **Popup come modalità di apertura predefinita** (finestra separata e pannello laterale restano scegliibili da Impostazioni), con `scripts/popupboot.js` che dà la misura al riquadro.
- Il dettaglio dell'evento è un **albero di righe**: il click su un parametro copia il suo path nel formato della Data Layer Variable di GTM (`ecommerce.items.0.item_id`).
- La riga `event` è in grassetto anche nel dettaglio.

## 1.6.0 e precedenti

Prima del revamp dell'interfaccia: storia nel tag `pre-revamp` e nei commit fino a `424d780`.
