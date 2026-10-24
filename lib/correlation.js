export const CORRELATION_WINDOW_MS = 1500;

function distance(a, b) {
  return Math.abs(a - b);
}

export function link(entry, hit) {
  hit.eventIndex = entry.i;
  if (!Array.isArray(entry.hits)) entry.hits = [];
  if (!entry.hits.includes(hit.id)) entry.hits.push(hit.id);
}

export function correlateNewEvents(session, entries) {
  const linked = new Set();
  entries.forEach((entry) => {
    let best = null;
    for (const hit of session.hits) {
      if (hit.eventIndex) continue;
      if (hit.frameId !== entry.frameId) continue;
      if (linked.has(hit.id)) continue;
      const delta = distance(hit.ts, entry.ts);
      if (delta > CORRELATION_WINDOW_MS) continue;
      if (!best || delta < best.delta) best = { hit, delta };
    }
    if (best) {
      link(entry, best.hit);
      linked.add(best.hit.id);
    }
  });
}

export function correlateNewHit(session, hit) {
  if (hit.eventIndex) return;
  let best = null;
  for (const entry of session.events) {
    if (entry.frameId !== hit.frameId) continue;
    const delta = distance(entry.ts, hit.ts);
    if (delta > CORRELATION_WINDOW_MS) continue;
    if (!best || delta < best.delta) best = { entry, delta };
  }
  if (best) link(best.entry, hit);
}
