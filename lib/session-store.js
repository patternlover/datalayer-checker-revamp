const SESSION_PREFIX = "s:";
const MAX_SESSIONS = 5;
const MAX_EVENTS = 500;
const MAX_HITS = 300;

const PERSIST_DELAY_MS = 200;

let cache = null;
let loading = null;
const pendingWrites = new Map();

// Il service worker MV3 viene spento dopo ~30s di inattività: al risveglio più eventi
// (porte dei collector, popup, webRequest) arrivano insieme. Tutti devono attendere la
// stessa lettura dello storage, altrimenti vedrebbero una mappa vuota e "perderebbero" la sessione.
function ensure() {
  if (cache) return Promise.resolve(cache);
  if (!loading) {
    loading = chrome.storage.session
      .get(null)
      .catch(() => ({}))
      .then((all) => {
        const map = new Map();
        Object.keys(all || {}).forEach((k) => {
          if (k.startsWith(SESSION_PREFIX)) map.set(k.slice(SESSION_PREFIX.length), all[k]);
        });
        cache = map;
        loading = null;
        return map;
      });
  }
  return loading;
}

function key(tabId) {
  return SESSION_PREFIX + tabId;
}

async function writeNow(tabId) {
  const session = cache ? cache.get(String(tabId)) : null;
  if (!session) {
    await chrome.storage.session.remove(key(tabId)).catch(() => {});
    return;
  }
  try {
    await chrome.storage.session.set({ [key(tabId)]: session });
  } catch (error) {
    console.warn("dlc: session persist failed", error);
  }
}

// Scrittura raggruppata: la cache in memoria è la fonte di verità, lo storage serve solo a
// sopravvivere al riavvio del service worker. Evita decine di scritture complete al secondo.
function persist(tabId) {
  const k = String(tabId);
  if (pendingWrites.has(k)) return Promise.resolve();
  pendingWrites.set(
    k,
    setTimeout(() => {
      pendingWrites.delete(k);
      writeNow(k);
    }, PERSIST_DELAY_MS)
  );
  return Promise.resolve();
}

function cancelWrite(tabId) {
  const k = String(tabId);
  const timer = pendingWrites.get(k);
  if (timer) clearTimeout(timer);
  pendingWrites.delete(k);
}

function touch(session) {
  session.updatedAt = Date.now();
}

export async function list() {
  const map = await ensure();
  return Array.from(map.values());
}

export async function get(tabId) {
  const map = await ensure();
  return map.get(String(tabId)) || null;
}

async function evictIfNeeded(tabId) {
  const map = await ensure();
  if (map.size < MAX_SESSIONS || map.has(String(tabId))) return;
  const sessions = Array.from(map.values());
  const candidates = sessions.filter((s) => !s.active).sort((a, b) => a.updatedAt - b.updatedAt);
  const victim = candidates[0] || sessions.sort((a, b) => a.updatedAt - b.updatedAt)[0];
  if (!victim) return;
  map.delete(String(victim.tabId));
  cancelWrite(victim.tabId);
  await chrome.storage.session.remove(key(victim.tabId)).catch(() => {});
}

export async function create(tabId, url) {
  const map = await ensure();
  await evictIfNeeded(tabId);
  const now = Date.now();
  const session = {
    tabId: tabId,
    active: true,
    createdAt: now,
    updatedAt: now,
    navId: 1,
    eventSeq: 0,
    hitSeq: 0,
    events: [],
    hits: [],
    nav: [{ ts: now, navId: 1, type: "navigate", url: url || "", pending: true }],
    topDocId: null,
    containers: { page: [], injected: [], conflict: false },
    gtmInjected: false,
    dropped: { events: 0, hits: 0 },
  };
  map.set(String(tabId), session);
  await persist(tabId);
  return session;
}

export async function setActive(tabId, active) {
  const session = await get(tabId);
  if (!session) return null;
  session.active = !!active;
  touch(session);
  await persist(tabId);
  return session;
}

export async function remove(tabId) {
  const map = await ensure();
  map.delete(String(tabId));
  cancelWrite(tabId);
  await chrome.storage.session.remove(key(tabId)).catch(() => {});
}

export async function clearData(tabId) {
  const session = await get(tabId);
  if (!session) return null;
  // "Pulisci" deve restare tale anche quando il collector rimanda lo snapshot completo:
  // si ricorda fino a che posizione ogni documento era già stato visto.
  const floors = session.docFloors || {};
  session.events.forEach((event) => {
    if (!event.docId || typeof event.pos !== "number") return;
    floors[event.docId] = Math.max(floors[event.docId] == null ? -1 : floors[event.docId], event.pos);
  });
  session.docFloors = floors;
  session.events = [];
  session.hits = [];
  session.nav = [];
  session.navId = 1;
  session.eventSeq = 0;
  session.hitSeq = 0;
  session.gtmInjected = false;
  session.dropped = { events: 0, hits: 0 };
  touch(session);
  await persist(tabId);
  return session;
}

export async function addNavMarker(tabId, type, url) {
  const session = await get(tabId);
  if (!session) return null;
  session.navId += 1;
  session.nav.push({ ts: Date.now(), navId: session.navId, type: type, url: url || "", pending: type === "navigate" });
  touch(session);
  await persist(tabId);
  return session;
}

function trim(list, max, dropped, droppedKey) {
  let trimmed = 0;
  while (list.length > max) {
    list.shift();
    trimmed += 1;
  }
  if (trimmed && dropped) dropped[droppedKey] = (dropped[droppedKey] || 0) + trimmed;
  return trimmed;
}

async function pushEntries(session, entries) {
  const prepared = entries.map((entry) => ({
    i: ++session.eventSeq,
    ts: entry.ts,
    navId: entry.navId,
    frameId: entry.frameId,
    frame: entry.frame || (entry.frameId === 0 ? "top" : "pixel"),
    docId: entry.docId || null,
    pos: typeof entry.pos === "number" ? entry.pos : null,
    url: entry.url || "",
    data: entry.data,
    hits: [],
  }));
  session.events.push(...prepared);
  const trimmed = trim(session.events, MAX_EVENTS, session.dropped, "events");
  touch(session);
  return { entries: prepared, trimmed };
}

export async function appendEvents(tabId, entries) {
  const session = await get(tabId);
  if (!session) return { entries: [], trimmed: 0 };
  const result = await pushEntries(session, entries);
  await persist(tabId);
  return result;
}

export async function replaceNavFrameEvents(tabId, navId, frameId, entries) {
  const session = await get(tabId);
  if (!session) return { entries: [], trimmed: 0 };
  const before = session.events.length;
  session.events = session.events.filter((event) => !(event.navId === navId && event.frameId === frameId));
  const removed = before - session.events.length;
  const result = await pushEntries(session, entries);
  await persist(tabId);
  return { ...result, removed };
}

// Unisce gli elementi del dataLayer di un documento usando la loro posizione nell'array
// (pos = indice in window.dataLayer). Snapshot e append ripetuti, riconnessioni e re-iniezioni
// non creano duplicati e riempiono eventuali buchi; indici e correlazioni restano stabili.
export async function mergeDocEntries(tabId, docId, entries, isSnapshot, forceReset) {
  const session = await get(tabId);
  if (!session) return { entries: [], trimmed: 0, removed: 0 };
  let removed = 0;
  if (isSnapshot) {
    // dataLayer più corto di quanto già visto = array sostituito/svuotato: si riparte da zero.
    // forceReset lo dice esplicitamente (dataLayer.length = 0 + push sincrono: il collettore
    // ha visto l'array accorciarsi, quindi le posizioni non sono più quelle di prima).
    const stale = session.events.some((event) => event.docId === docId && typeof event.pos === "number" && event.pos >= entries.length);
    const floor = session.docFloors ? session.docFloors[docId] : undefined;
    if (forceReset === true || stale || (floor != null && floor >= entries.length)) {
      const before = session.events.length;
      session.events = session.events.filter((event) => event.docId !== docId);
      removed = before - session.events.length;
      if (session.docFloors) delete session.docFloors[docId];
    }
  }
  const floor = session.docFloors ? session.docFloors[docId] : undefined;
  const known = new Set();
  if (floor != null) for (let p = 0; p <= floor; p++) known.add(p);
  session.events.forEach((event) => {
    if (event.docId === docId && typeof event.pos === "number") known.add(event.pos);
  });
  const fresh = entries.filter((entry) => !known.has(entry.pos));
  const result = fresh.length ? await pushEntries(session, fresh) : { entries: [], trimmed: 0 };
  if (!fresh.length) await persist(tabId);
  return { ...result, removed };
}

// Registra il documento corrente del frame principale. Se è nuovo, lo associa al marker di
// navigazione in attesa (creato da onCommitted) oppure ne crea uno. Ritorna true se nav è cambiata.
export async function noteTopDocument(tabId, docId, url) {
  const session = await get(tabId);
  if (!session || !docId || session.topDocId === docId) return false;
  const hadDoc = !!session.topDocId;
  session.topDocId = docId;
  const last = session.nav[session.nav.length - 1];
  if (last && last.pending) {
    last.pending = false;
    last.docId = docId;
    if (url) last.url = url;
    await persist(tabId);
    return true;
  }
  // Sessione legacy o primo documento già coperto da un marker: nessun nuovo separatore.
  if (!hadDoc && session.events.length === 0) {
    await persist(tabId);
    return false;
  }
  session.navId += 1;
  session.nav.push({ ts: Date.now(), navId: session.navId, type: "navigate", url: url || "", docId: docId, pending: false });
  touch(session);
  await persist(tabId);
  return true;
}

export async function rekey(fromTabId, toTabId) {
  const map = await ensure();
  const session = map.get(String(fromTabId));
  if (!session || String(fromTabId) === String(toTabId)) return false;
  map.delete(String(fromTabId));
  cancelWrite(fromTabId);
  await chrome.storage.session.remove(key(fromTabId)).catch(() => {});
  session.tabId = toTabId;
  map.set(String(toTabId), session);
  await persist(toTabId);
  return true;
}

export async function appendHit(tabId, hit) {
  const session = await get(tabId);
  if (!session) return { hit: null, trimmed: 0 };
  hit.id = ++session.hitSeq;
  session.hits.push(hit);
  const trimmed = trim(session.hits, MAX_HITS, session.dropped, "hits");
  touch(session);
  await persist(tabId);
  return { hit, trimmed };
}

export async function updateHitStatus(tabId, requestId, status) {
  const session = await get(tabId);
  if (!session) return null;
  for (let i = session.hits.length - 1; i >= 0; i--) {
    if (session.hits[i].requestId === requestId) {
      session.hits[i].status = status;
      touch(session);
      await persist(tabId);
      return session.hits[i];
    }
  }
  return null;
}

export async function setGtmInjected(tabId, value) {
  const session = await get(tabId);
  if (!session) return false;
  const next = !!value;
  if (session.gtmInjected === next) return false;
  session.gtmInjected = next;
  await persist(tabId);
  return true;
}

// Flag di sessione "appiccicosi" (es. pixelSeen, platform). Ritorna la sessione se qualcosa è cambiato.
export async function setFlags(tabId, patch) {
  const session = await get(tabId);
  if (!session || !patch) return null;
  let changed = false;
  Object.keys(patch).forEach((k) => {
    const next = patch[k];
    const prev = session[k];
    if (next && typeof next === "object") {
      const merged = Object.assign({}, prev || {}, next);
      if (JSON.stringify(merged) !== JSON.stringify(prev || {})) {
        session[k] = merged;
        changed = true;
      }
    } else if (prev !== next) {
      session[k] = next;
      changed = true;
    }
  });
  if (!changed) return null;
  await persist(tabId);
  return session;
}

export async function save(tabId) {
  await persist(tabId);
}

function recomputeConflict(session) {
  session.containers.conflict = session.containers.page.some((id) => session.containers.injected.includes(id));
}

export async function mergePageContainers(tabId, ids) {
  const session = await get(tabId);
  if (!session || !Array.isArray(ids)) return null;
  let changed = false;
  ids.forEach((id) => {
    if (typeof id === "string" && id && !session.containers.page.includes(id)) {
      session.containers.page.push(id);
      changed = true;
    }
  });
  if (!changed) return session;
  recomputeConflict(session);
  touch(session);
  await persist(tabId);
  return session;
}

export async function setInjectedContainers(tabId, ids) {
  const session = await get(tabId);
  if (!session) return null;
  session.containers.injected = Array.isArray(ids) ? ids.slice() : [];
  recomputeConflict(session);
  await persist(tabId);
  return session;
}
