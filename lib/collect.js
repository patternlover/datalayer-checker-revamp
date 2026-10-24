// Raccolta DataLayer per UAT: l'utente indica gli eventi che gli servono (nomi esatti o con *),
// e ogni volta che scattano — in Top o Pixel — il loro push viene salvato in storage.local.
// La raccolta è per sito (host della tab in test) e sopravvive a refresh, chiusura tab e riavvio.
export const COLLECT_PREFIX = "dlcCollect:";
const MAX_PER_EVENT = 25;

export function collectKey(host) {
  return COLLECT_PREFIX + host;
}

export function parseNames(raw) {
  const list = [];
  String(raw || "")
    .split(/[\s,;]+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .forEach((token) => {
      if (!list.includes(token)) list.push(token);
    });
  return list;
}

function toRegex(pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp("^" + escaped + "$", "i");
}

export function matcher(names) {
  const regexes = (names || []).map(toRegex);
  return (eventName) => typeof eventName === "string" && regexes.some((re) => re.test(eventName));
}

export function itemKey(tabId, entry) {
  if (entry.docId && typeof entry.pos === "number") return entry.docId + "|" + entry.pos;
  return "t" + tabId + "|" + entry.i + "|" + entry.ts;
}

export async function load(host) {
  if (!host) return null;
  const stored = await chrome.storage.local.get(collectKey(host));
  const value = stored[collectKey(host)];
  if (value && typeof value === "object") {
    value.names = Array.isArray(value.names) ? value.names : [];
    value.items = Array.isArray(value.items) ? value.items : [];
    return value;
  }
  return { host: host, names: [], items: [], updatedAt: 0 };
}

async function save(collection) {
  collection.updatedAt = Date.now();
  await chrome.storage.local.set({ [collectKey(collection.host)]: collection });
}

// Aggiunge gli eventi che corrispondono. Ritorna il numero di nuovi elementi salvati.
export function addEntries(collection, tabId, entries) {
  if (!collection || !collection.names.length || !entries || !entries.length) return 0;
  const isWanted = matcher(collection.names);
  const known = new Set(collection.items.map((item) => item.key));
  let added = 0;
  entries.forEach((entry) => {
    const name = entry && entry.data && entry.data.event;
    if (!isWanted(name)) return;
    const key = itemKey(tabId, entry);
    if (known.has(key)) return;
    known.add(key);
    collection.items.push({
      key: key,
      name: name,
      frame: entry.frame || (entry.frameId === 0 ? "top" : "pixel"),
      ts: entry.ts,
      url: entry.url || "",
      data: entry.data,
    });
    added += 1;
  });
  if (added) {
    // Limite per evento: si tengono le occorrenze più recenti.
    const byName = new Map();
    collection.items.forEach((item) => {
      const list = byName.get(item.name) || [];
      list.push(item);
      byName.set(item.name, list);
    });
    const keep = new Set();
    byName.forEach((list) => list.slice(-MAX_PER_EVENT).forEach((item) => keep.add(item.key)));
    collection.items = collection.items.filter((item) => keep.has(item.key));
  }
  return added;
}

export async function collect(host, tabId, entries) {
  const collection = await load(host);
  if (!collection || !collection.names.length) return 0;
  const added = addEntries(collection, tabId, entries);
  if (added) await save(collection);
  return added;
}

export async function setNames(host, names, tabId, sessionEvents) {
  const collection = await load(host);
  if (!collection) return null;
  collection.names = names;
  addEntries(collection, tabId, sessionEvents || []);
  await save(collection);
  return collection;
}

export async function clearItems(host) {
  const collection = await load(host);
  if (!collection) return null;
  collection.items = [];
  await save(collection);
  return collection;
}
