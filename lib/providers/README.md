# Provider (porting da Omnibug)

Un file per vendor più `base.js`: sono i dizionari dei parametri di
[Omnibug](https://github.com/MisterPhilip/omnibug) (`src/providers/`), copiati così come sono e
trasformati solo in moduli ES (`import BaseProvider` + `export default`). Le uniche aggiunte sono
l'intestazione di provenienza e, in `index.js`, i filtri `webRequest`, la chiave dell'evento e il
link alla documentazione di ogni vendor.

| Qui | Omnibug |
| --- | --- |
| `base.js` | `BaseProvider.js` |
| `google-analytics-4.js` | `GoogleAnalytics4.js` |
| `google-analytics.js` | `GoogleAnalytics.js` |
| `google-tag-manager.js` | `GoogleTagManager.js` |
| `google-ads.js` | `GoogleAds.js` |
| `facebook-pixel.js` | `FacebookPixel.js` |
| `tiktok.js` | `TikTok.js` |
| `linkedin.js` | `LinkedIn.js` |
| `pinterest.js` | `Pinterest.js` |
| `snapchat.js` | `Snapchat.js` |
| `reddit-pixel.js` | `RedditPixel.js` |
| `bing-ads.js` | `BingAds.js` |
| `criteo-one-tag.js` | `CriteoOneTag.js` |
| `hotjar.js` | `Hotjar.js` |
| `microsoft-clarity.js` | `MicrosoftClarity.js` |

Non ci sono tutti: Omnibug ne ha 71. Mancano quelli che non riguardano il lavoro sul dataLayer
(Adobe, Tealium, Segment, i tag manager server-side). Aggiungerne uno è una riga in `index.js`,
niente da cambiare altrove.

Aggiornare un dizionario: si ricopia il file da Omnibug e si rifà la trasformazione (import,
`export default`, nome del file in kebab-case). Le modifiche a mano qui dentro sono da evitare:
al prossimo ricopia si perdono.

## Licenza

Omnibug è distribuito con licenza MIT. Il testo integrale segue.

```
MIT License

Copyright (c) 2017 Philip Lawrence

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
