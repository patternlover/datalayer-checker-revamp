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
- **DataLayer vecchi e UA** — funziona anche con i push di una volta: `dataLayer.push(arguments)`
  e i dataLayer che iniziano con le sole variabili di pagina, senza `event` (righe «Senza event»,
  leggibili ma distinte dagli eventi di business).
- **UAT** — incolla la colonna *DataLayer TO BE* del foglio, **Aggiungi**: il pannello segna quali
  eventi sono già scattati (Top o Pixel, con l'ora) e **Copia UAT** dà il blocco da incollare.
  Vale per sito, sopravvive a refresh e riavvio, `*` è jolly.
- **GTM Injector** — domini + snippet in *Impostazioni*, solo frame principale e solo `https`.
  Il chip nell'header dice se il container è in pagina; un banner ricorda che è attivo
  (**Disattiva** spegne, **×** chiude il banner). Se il container c'è già, l'iniezione si salta.
- **Apertura** — default **popup** agganciato all'icona; da *Impostazioni → Apertura* si passa a
  finestra separata (debug lunghi) o pannello laterale (solo su Chrome).

## Da sapere

- **Permessi** — `https://*/*` serve a leggere il `dataLayer` di qualunque sito stai testando
  (Chrome lo chiede all'installazione); `scripting`, `webNavigation`, `webRequest` per la
  cattura, in sola lettura; `storage`, `clipboardWrite`, `sidePanel` per il resto.
- **Cosa esce dal browser** — eventi e sessioni restano in locale. Solo impostazioni, domini e
  snippet stanno in `chrome.storage.sync`, cioè nel tuo account Google: niente è condiviso.
- **La scheda Hits** — la raccolta delle hit dei vendor (GA4, Meta, TikTok, …) è già attiva, la
  vista arriva a breve.

## Cosa non fa

Non verifica una specifica (per quello c'è DataLayer Doctor: qui la specifica si spunta a mano
nella scheda UAT) · non esporta file o HAR · non funziona su `http://`, tranne `localhost` · una
sola tab in test alla volta.

## Provenienza

Derivata da **DataLayer Checker Plus** (Chrome Web Store): `lib/`, `ui/` e il container probe
sono lavoro nostro, la storia parte dal tag `pre-revamp`.
