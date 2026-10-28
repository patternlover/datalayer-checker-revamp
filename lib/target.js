// "Tab in test": l'unica tab su cui l'estensione cattura dataLayer e hit.
// Viene scelta esplicitamente dall'utente e NON segue il focus: lavorare su un'altra tab
// (es. Google Sheets in split view) non sposta la cattura e non perde lo storico.
// Salvata in storage.local: dopo un riavvio del browser il tabId non vale più, ma l'host sì,
// quindi la prima tab che riapre lo stesso sito viene riagganciata in automatico.
const KEY = "dlcTarget";

// https obbligatorio, con un'eccezione: localhost in http. Serve a provare l'estensione e a
// testare un sito in locale senza certificati; tutto il resto in http non si aggancia.
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1", "[::1]"];

export function hostOf(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:") return parsed.hostname;
    if (parsed.protocol === "http:" && LOCAL_HOSTS.includes(parsed.hostname)) return parsed.hostname;
    return null;
  } catch (e) {
    return null;
  }
}

export async function getTarget() {
  const stored = await chrome.storage.local.get(KEY);
  const target = stored[KEY];
  return target && typeof target === "object" ? target : null;
}

export async function setTarget(target) {
  if (!target) await chrome.storage.local.remove(KEY);
  else await chrome.storage.local.set({ [KEY]: target });
  return target;
}

export const TARGET_KEY = KEY;
