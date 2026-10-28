# Pagina demo

Un finto negozio con un `dataLayer` vero e hit finte verso GA4 e Meta. Serve a provare
l'estensione (e a rifare gli screenshot in `docs/screenshots/`) senza toccare un sito di un
cliente.

## Come si usa

Dalla cartella `docs/demo`, avvia un server statico e apri la pagina:

```bash
python3 -m http.server 8080
```

Poi, nel browser:

1. `http://localhost:8080` — la pagina demo (`localhost` è l'unico indirizzo `http://` che
   l'estensione accetta come tab in test).
2. Apri il pannello e premi **Testa localhost**.
3. `Aggiungi al carrello` → devono comparire `add_to_cart` e `dl_view_cart`.
4. `dataLayer.length = 0` → i tre eventi nuovi devono comparire tutti, non solo l'ultimo.
5. `Cambio pagina SPA` → nella lista deve comparire il separatore `Navigazione SPA`.

Su Windows senza Python: `npx serve . -l 8080`.

## Cosa contiene

- `index.html` — la pagina: eventi `gtm.js`, `page_view`, `view_item` al caricamento;
  `add_to_cart` e `dl_view_cart` al click; due pulsanti per i casi che rompono i dataLayer veri
  (svuotamento dell'array e navigazione SPA).
- Le hit sono `new Image().src` verso `google-analytics.com/g/collect` e `facebook.com/tr`: non
  servono token né account, devono solo *partire* perché l'estensione le osservi. Oggi
  l'estensione le raccoglie ma non le mostra: servono alla vista Hit, che è il prossimo lavoro.
