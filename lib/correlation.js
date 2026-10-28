export const CORRELATION_WINDOW_MS = 1500;

function distance(a, b) {
  return Math.abs(a - b);
}

// Quanto un evento è un buon candidato per una hit: prima il nome (una hit GA4 `add_to_cart`
// appartiene all'evento `add_to_cart`), poi la distanza nel tempo. La finestra temporale resta
// l'unico limite: fuori da lì non si correla niente.
function rank(hit, entry) {
  const hitName = typeof hit.eventName === "string" ? hit.eventName.toLowerCase() : "";
  const eventName = entry && entry.data && typeof entry.data.event === "string" ? entry.data.event.toLowerCase() : "";
  return { nameMatch: hitName && eventName && hitName === eventName ? 1 : 0, delta: distance(hit.ts, entry.ts) };
}

function better(a, b) {
  if (!b) return true;
  if (a.nameMatch !== b.nameMatch) return a.nameMatch > b.nameMatch;
  return a.delta < b.delta;
}

function unlink(session, hit) {
  if (!hit.eventIndex) return;
  const previous = session.events.find((entry) => entry.i === hit.eventIndex);
  if (previous && Array.isArray(previous.hits)) previous.hits = previous.hits.filter((id) => id !== hit.id);
  hit.eventIndex = null;
}

export function link(entry, hit) {
  hit.eventIndex = entry.i;
  if (!Array.isArray(entry.hits)) entry.hits = [];
  if (!entry.hits.includes(hit.id)) entry.hits.push(hit.id);
}

// La richiesta di rete parte prima che il push del dataLayer arrivi al background: la prima
// correlazione cade quindi quasi sempre sull'evento precedente. Per questo la correlazione si
// rifà a ogni nuovo evento (e a ogni nuova hit) e una hit già attribuita si sposta solo verso
// un candidato migliore. Senza questo, in una UAT un evento mostra le hit di un altro.
function currentRank(session, hit) {
  if (!hit.eventIndex) return null;
  const entry = session.events.find((item) => item.i === hit.eventIndex);
  return entry ? rank(hit, entry) : null;
}

export function correlateNewEvents(session, entries) {
  const linked = new Set();
  entries.forEach((entry) => {
    let best = null;
    for (const hit of session.hits) {
      if (hit.frameId !== entry.frameId) continue;
      if (linked.has(hit.id)) continue;
      const candidate = rank(hit, entry);
      if (candidate.delta > CORRELATION_WINDOW_MS) continue;
      if (!better(candidate, currentRank(session, hit))) continue;
      if (!best || better(candidate, best.candidate)) best = { hit, candidate };
    }
    if (best) {
      unlink(session, best.hit);
      link(entry, best.hit);
      linked.add(best.hit.id);
    }
  });
}

export function correlateNewHit(session, hit) {
  let best = null;
  for (const entry of session.events) {
    if (entry.frameId !== hit.frameId) continue;
    const candidate = rank(hit, entry);
    if (candidate.delta > CORRELATION_WINDOW_MS) continue;
    if (!best || better(candidate, best.candidate)) best = { entry, candidate };
  }
  if (!best) return;
  if (!better(best.candidate, currentRank(session, hit))) return;
  unlink(session, hit);
  link(best.entry, hit);
}
