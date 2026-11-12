// Nome dell'evento di un push del dataLayer. Sta qui perché serve sia alla UI (lista, dettaglio,
// ricerca, UAT) sia al background (raccolta UAT): una sola regola, non due.
//
// Forme che si incontrano:
// - { event: "x" } — GTM moderno, GA4 compreso;
// - dataLayer.push(arguments) — snippet GTM vecchio: il push arriva come { "0": { event: "x" } };
// - { "0": "x" } — push di una stringa;
// - { pageCategory: "…", pageType: "…" } — dataLayer UA che inizia con le variabili di pagina:
//   nessun event, e non è un errore.
export function eventNameOf(data) {
  if (!data || typeof data !== "object") return "";
  if (typeof data.event === "string") return data.event;
  const first = data["0"];
  if (typeof first === "string") return first;
  if (first && typeof first === "object" && typeof first.event === "string") return first.event;
  return "";
}
