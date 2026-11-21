// Verifica end-to-end del ponte "Rispecchia pixel sul Top".
//
// Alza un server statico su docs/demo, avvia Chrome con l'estensione caricata (dominio CDP
// Extensions: Google Chrome ignora --load-extension), mette in test la pagina del finto checkout
// dalla UI dell'estensione e legge il dataLayer del frame principale.
//
// Uso:   node test/e2e-mirror.mjs
// Note:  CHROME=/percorso/chrome per un binario diverso; HEADFUL=1 per vedere il browser.
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const demoDir = path.join(repo, "docs", "demo");
const PORT = Number(process.env.PORT || 8231);
const CDP_PORT = Number(process.env.CDP_PORT || 9431);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dlc-e2e-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split("?")[0]);
      const file = path.join(demoDir, rel === "/" ? "mirror.html" : rel);
      if (!file.startsWith(demoDir)) {
        res.writeHead(403).end();
        return;
      }
      fs.readFile(file, (err, body) => {
        if (err) {
          res.writeHead(404).end("not found");
          return;
        }
        res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
        res.end(body);
      });
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

function chromeBinary() {
  if (process.env.CHROME) return process.env.CHROME;
  const candidates = [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error("Chrome non trovato: passa CHROME=/percorso/chrome");
  return found;
}

function launchChrome() {
  const args = [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    "--enable-unsafe-extension-debugging",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "about:blank",
  ];
  if (!process.env.HEADFUL) args.unshift("--headless=new");
  return spawn(chromeBinary(), args, { stdio: "ignore" });
}

const jsonList = async () => (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();

async function waitFor(label, check, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await check().catch(() => null);
    if (value) return value;
    await sleep(200);
  }
  throw new Error("timeout: " + label);
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const ready = new Promise((res) => (ws.onopen = res));
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  };
  return {
    ready,
    send(method, params = {}) {
      const msgId = ++id;
      ws.send(JSON.stringify({ id: msgId, method, params }));
      return new Promise((resolve, reject) => pending.set(msgId, { resolve, reject }));
    },
    close: () => ws.close(),
  };
}

async function evaluate(client, expression) {
  const out = await client.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (out.exceptionDetails) {
    const text = out.exceptionDetails.exception ? out.exceptionDetails.exception.description : out.exceptionDetails.text;
    throw new Error("exception: " + text + "\n  nello snippet: " + expression.replace(/\s+/g, " ").slice(0, 140));
  }
  return out.result.value;
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

async function openPage(browserClient, url) {
  const { targetId } = await browserClient.send("Target.createTarget", { url });
  const client = await waitFor("client della pagina", async () => {
    const target = (await jsonList()).find((t) => t.id === targetId);
    if (!target || !target.webSocketDebuggerUrl) return null;
    const c = connect(target.webSocketDebuggerUrl);
    await c.ready;
    await c.send("Runtime.enable").catch(() => {});
    await c.send("Page.enable").catch(() => {});
    return c;
  });
  return { client, targetId };
}

// "Testa" dalla UI vera: porta dlc-ui e comando pin, come fa il pulsante dell'estensione.
const PIN_SCRIPT = (needle) => `new Promise((resolve) => {
  if (!window.__e2ePort) {
    window.__e2ePort = chrome.runtime.connect({ name: "dlc-ui" });
    window.__e2eLast = null;
    window.__e2ePort.onMessage.addListener((m) => { if (m && m.type === "session") window.__e2eLast = m.session; });
  }
  chrome.tabs.query({}).then((tabs) => {
    const tab = tabs.find((t) => (t.url || "").indexOf(${JSON.stringify(needle)}) !== -1);
    if (!tab) { resolve("no-tab"); return; }
    window.__e2ePort.postMessage({ cmd: "pin", tabId: tab.id });
    setTimeout(() => resolve(tab.id), 2500);
  });
})`;

// Pin con attesa: la tab creata via CDP può non essere ancora in chrome.tabs.query.
async function pinPage(ui, needle) {
  for (let i = 0; i < 8; i++) {
    const result = await evaluate(ui.client, PIN_SCRIPT(needle));
    if (typeof result === "number") return result;
    await sleep(500);
  }
  return "no-tab";
}

async function main() {
  const server = await serve();
  const chrome = launchChrome();
  let browserClient;
  let ui;
  const opened = [];
  try {
    browserClient = await waitFor("browser CDP", async () => {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      if (!res.ok) return null;
      const version = await res.json();
      const c = connect(version.webSocketDebuggerUrl);
      await c.ready;
      return c;
    });

    const loaded = await browserClient.send("Extensions.loadUnpacked", { path: repo }).catch((error) => ({ error }));
    const extId = loaded && loaded.id;
    check("estensione caricata", !!extId, String(extId || (loaded.error && loaded.error.message)));
    if (!extId) throw new Error("Extensions.loadUnpacked non disponibile");

    ui = await openPage(browserClient, `chrome-extension://${extId}/index.html`);
    const uiReady = await waitFor("pagina dell'estensione", () =>
      evaluate(ui.client, `typeof chrome === "object" && !!chrome.storage && !!chrome.tabs`).then((ok) => ok || null)
    );
    check("pagina dell'estensione pronta", !!uiReady);

    // La UI deve esporre il toggle e scriverlo in storage: è quello che l'umano usa.
    // La pagina si aggancia quando ui/main.js ha finito: si riprova finché la vista risponde.
    const settingsUi = await waitFor("impostazioni pronte", async () => {
      const dump = JSON.parse(
        await evaluate(
          ui.client,
          `(async () => {
             const view = document.getElementById("settings-view");
             const toggle = document.getElementById("mirror-toggle");
             const scope = document.getElementById("mirror-scope");
             if (!view || !toggle || !scope) return JSON.stringify({ ready: false });
             if (view.classList.contains("is-hidden")) document.getElementById("settings-toggle").click();
             await new Promise((r) => setTimeout(r, 300));
             if (view.classList.contains("is-hidden")) return JSON.stringify({ ready: false });
             await chrome.storage.sync.set({ pixelmirror: false });
             await new Promise((r) => setTimeout(r, 200));
             toggle.click();
             await new Promise((r) => setTimeout(r, 400));
             const after = await chrome.storage.sync.get(["pixelmirror"]);
             toggle.click();
             await new Promise((r) => setTimeout(r, 300));
             return JSON.stringify({
               ready: true,
               viewVisible: !view.classList.contains("is-hidden"),
               hasToggle: !!toggle,
               scope: scope.value,
               after: after.pixelmirror,
             });
           })()`
        )
      );
      return dump.ready ? dump : null;
    });
    check("impostazioni: sezione del ponte presente", settingsUi.viewVisible && settingsUi.hasToggle, JSON.stringify(settingsUi));
    check("impostazioni: il toggle scrive in storage", settingsUi.after === true, String(settingsUi.after));
    check("impostazioni: scope di default solo-checkout", settingsUi.scope === "solo-checkout", settingsUi.scope);
    // Apertura: tre modalità, nessun "torna al popup".
    const modes = JSON.parse(
      await evaluate(
        ui.client,
        `(async () => {
           const radios = [...document.querySelectorAll('input[name="uimode"]')].map((r) => r.value);
           const value = document.getElementById("uimode-value").textContent.trim();
           const reset = !!document.getElementById("uimode-reset");
           const tab = document.querySelector('input[name="uimode"][value="tab"]');
           if (tab) { tab.checked = true; tab.dispatchEvent(new Event("change")); }
           await new Promise((r) => setTimeout(r, 400));
           const stored = await chrome.storage.local.get(["dlcUiMode"]);
           return JSON.stringify({ radios, value, reset, stored: stored.dlcUiMode });
         })()`
      )
    );
    check("impostazioni: popup, pannello laterale, nuova tab", modes.radios.includes("popup") && modes.radios.includes("sidepanel") && modes.radios.includes("tab"), JSON.stringify(modes.radios));
    check("impostazioni: niente più «torna al popup»", modes.reset === false);
    check("impostazioni: la modalità scelta si salva", modes.stored === "tab", String(modes.stored));
    await evaluate(ui.client, `chrome.storage.local.set({ dlcUiMode: "popup" })`);

    await evaluate(ui.client, `chrome.storage.sync.set({ pixelmirror: true, pixelmirrorScope: "solo-checkout" })`);

    // ---- 1. checkout: gli eventi del sandbox devono arrivare nel Top ----
    const checkout = await openPage(browserClient, `http://127.0.0.1:${PORT}/mirror.html`);
    opened.push(checkout);
    const checkoutTabId = await evaluate(ui.client, PIN_SCRIPT("mirror.html"));
    check("tab del checkout in test", typeof checkoutTabId === "number", String(checkoutTabId));
    await checkout.client.send("Page.reload", { ignoreCache: true });
    await sleep(5000);

    const top = JSON.parse(await evaluate(checkout.client, "JSON.stringify(window.dataLayer || [])"));
    const names = top.map((e) => e.event);
    check(
      "eventi del pixel nel dataLayer del Top",
      names.includes("checkout_started") && names.includes("begin_checkout"),
      names.join(", ")
    );
    check(
      "nessun evento di ciclo vita gtm.*",
      !names.some((n) => String(n).startsWith("gtm.")),
      names.filter((n) => String(n).startsWith("gtm.")).join(", ")
    );
    const started = top.find((e) => e.event === "checkout_started");
    check("payload identico", !!started && started.checkout && started.checkout.totalPrice.amount === 89, JSON.stringify(started && started.checkout));
    check("chiavi interne di GTM tolte", !!started && !("gtm.uniqueEventId" in started), JSON.stringify(Object.keys(started || {})));

    await evaluate(ui.client, `chrome.storage.sync.set({ gtmcodepush: false, injectorTA: true })`);

    const session = JSON.parse(await evaluate(ui.client, "JSON.stringify(window.__e2eLast || null)"));
    const pixelEvents = session && Array.isArray(session.events) ? session.events.filter((e) => e.frame === "pixel").length : 0;
    check("la tab Pixel continua a raccogliere", pixelEvents > 0 && session.pixelSeen === true, `eventi pixel: ${pixelEvents}, pixelSeen: ${session.pixelSeen}`);

    // ---- 1b. Injector: il container si legge dalla pagina, non si scrive ----
    // Stato pulito come un'installazione nuova.
    await evaluate(ui.client, `chrome.storage.sync.clear()`);
    await ui.client.send("Page.reload", { ignoreCache: true });
    await sleep(1600);

    const fresh = JSON.parse(
      await evaluate(
        ui.client,
        `(async () => {
           if (document.getElementById("settings-view").classList.contains("is-hidden")) {
             document.getElementById("settings-toggle").click();
             await new Promise((r) => setTimeout(r, 300));
           }
           return JSON.stringify({
             injector: document.getElementById("injector-toggle").checked,
             ta: document.getElementById("injector-ta").checked,
             mirror: document.getElementById("mirror-toggle").checked,
           });
         })()`
      )
    );
    check("injector: spento su installazione nuova", fresh.injector === false);
    check("injector: Collega a Tag Assistant è attivo di base", fresh.ta === true);

    const autoPick = JSON.parse(
      await evaluate(
        ui.client,
        `(async () => {
           const toggle = document.getElementById("injector-toggle");
           toggle.checked = true;
           toggle.dispatchEvent(new Event("change"));
           await new Promise((r) => setTimeout(r, 1400));
           const st = await chrome.storage.sync.get(null);
           return JSON.stringify({ on: toggle.checked, code: st.gtmcode, push: st.gtmcodepush, domini: st.gtmDomains });
         })()`
      )
    );
    check("injector: prende il container dalla pagina", autoPick.code === "GTM-PIXEL1" && autoPick.push === true, JSON.stringify(autoPick));
    check("injector: dominio dalla tab, non digitato", JSON.stringify(autoPick.domini) === JSON.stringify(["127.0.0.1"]), JSON.stringify(autoPick.domini));

    const injected = JSON.parse(
      await evaluate(
        checkout.client,
        `JSON.stringify({
           injected: !!window.__dlcGtmInjectedCode,
           ta: document.documentElement.getAttribute("data-tag-assistant-prod-present"),
         })`
      )
    );
    check("injector: il container arriva in pagina", injected.injected === true, JSON.stringify(injected));
    check(
      "injector: il container è in debug per Tag Assistant",
      typeof injected.ta === "string" && Math.abs(Date.now() - Number(injected.ta)) < 300000,
      String(injected.ta)
    );

    // Più container in pagina: si sceglie, e finché non si sceglie resta spento.
    const due = await openPage(browserClient, `http://127.0.0.1:${PORT}/mirror-due.html`);
    opened.push(due);
    await sleep(1200);
    const duePinned = await pinPage(ui, "mirror-due.html");
    check("seconda tab in test", typeof duePinned === "number", String(duePinned));
    await evaluate(ui.client, `chrome.storage.sync.clear()`);
    await ui.client.send("Page.reload", { ignoreCache: true });
    await sleep(1600);
    const choose = JSON.parse(
      await evaluate(
        ui.client,
        `(async () => {
           if (document.getElementById("settings-view").classList.contains("is-hidden")) {
             document.getElementById("settings-toggle").click();
             await new Promise((r) => setTimeout(r, 300));
           }
           const toggle = document.getElementById("injector-toggle");
           toggle.checked = true;
           toggle.dispatchEvent(new Event("change"));
           await new Promise((r) => setTimeout(r, 1500));
           const sel = document.getElementById("injector-container");
           return JSON.stringify({
             on: toggle.checked,
             opzioni: [...sel.options].map((o) => o.value),
             bodyOpen: !document.getElementById("injector-body").hidden,
           });
         })()`
      )
    );
    check("injector: con più container chiede quale", choose.opzioni.length >= 2 && choose.bodyOpen === true, JSON.stringify(choose));
    check("injector: senza scelta resta spento", choose.on === false, String(choose.on));

    const chosen = JSON.parse(
      await evaluate(
        ui.client,
        `(async () => {
           const sel = document.getElementById("injector-container");
           sel.value = "GTM-PIXEL2";
           sel.dispatchEvent(new Event("change"));
           await new Promise((r) => setTimeout(r, 1300));
           const st = await chrome.storage.sync.get(null);
           return JSON.stringify({ code: st.gtmcode, push: st.gtmcodepush, toggle: document.getElementById("injector-toggle").checked });
         })()`
      )
    );
    check("injector: la scelta si applica", chosen.code === "GTM-PIXEL2" && chosen.push === true && chosen.toggle === true, JSON.stringify(chosen));

    // Niente in pagina: il campo manuale compare e accetta un ID. La pagina prodotto non dichiara
    // nessun container nel suo pixel, quindi è il banco giusto.
    const vuoto = await openPage(browserClient, `http://127.0.0.1:${PORT}/mirror-prodotti.html`);
    opened.push(vuoto);
    await sleep(1200);
    await pinPage(ui, "mirror-prodotti.html");
    await evaluate(ui.client, `chrome.storage.sync.clear()`);
    await ui.client.send("Page.reload", { ignoreCache: true });
    await sleep(1600);
    const manual = JSON.parse(
      await evaluate(
        ui.client,
        `(async () => {
           if (document.getElementById("settings-view").classList.contains("is-hidden")) {
             document.getElementById("settings-toggle").click();
             await new Promise((r) => setTimeout(r, 300));
           }
           document.getElementById("injector-row").click();
           await new Promise((r) => setTimeout(r, 400));
           const select = document.getElementById("injector-container");
           const field = document.getElementById("injector-manual");
           const stateBefore = { selectHidden: select.classList.contains("is-hidden"), fieldShown: !field.classList.contains("is-hidden") };
           field.value = "GTM-MANUAL1";
           field.dispatchEvent(new Event("change"));
           await new Promise((r) => setTimeout(r, 1300));
           const st = await chrome.storage.sync.get(null);
           return JSON.stringify({ ...stateBefore, code: st.gtmcode, push: st.gtmcodepush, domini: st.gtmDomains });
         })()`
      )
    );
    check("injector: senza container in pagina compare il campo manuale", manual.selectHidden === true && manual.fieldShown === true, JSON.stringify(manual));
    check(
      "injector: l'ID scritto a mano viene iniettato",
      manual.code === "GTM-MANUAL1" && manual.push === true && JSON.stringify(manual.domini) === JSON.stringify(["127.0.0.1"]),
      JSON.stringify(manual)
    );
    await evaluate(ui.client, `chrome.storage.sync.set({ gtmcodepush: false })`);

    // ---- 2. pagina prodotto: con scope solo-checkout non deve passare niente ----
    const product = vuoto;
    const productTabId = await pinPage(ui, "mirror-prodotti.html");
    check("tab prodotto in test", typeof productTabId === "number", String(productTabId));
    await product.client.send("Page.reload", { ignoreCache: true });
    await sleep(5000);
    const productTop = JSON.parse(await evaluate(product.client, "JSON.stringify(window.dataLayer || [])"));
    check("fuori scope non rispecchia", productTop.length === 0, JSON.stringify(productTop.map((e) => e.event)));

    // ---- 3. con scope "sempre" invece rispecchia ----
    await evaluate(ui.client, `chrome.storage.sync.set({ pixelmirror: true, pixelmirrorScope: "sempre" })`);
    await sleep(1500);
    await product.client.send("Page.reload", { ignoreCache: true });
    await sleep(4500);
    const alwaysTop = JSON.parse(await evaluate(product.client, "JSON.stringify(window.dataLayer || [])"));
    check(
      "scope sempre rispecchia anche fuori dal checkout",
      alwaysTop.some((e) => e.event === "product_viewed"),
      alwaysTop.map((e) => e.event).join(", ")
    );

    // ---- 4. ponte spento: nessun push ----
    await evaluate(ui.client, `chrome.storage.sync.set({ pixelmirror: false, pixelmirrorScope: "solo-checkout" })`);
    await sleep(1500);
    await product.client.send("Page.reload", { ignoreCache: true });
    await sleep(4500);
    const offTop = JSON.parse(await evaluate(product.client, "JSON.stringify(window.dataLayer || [])"));
    check("ponte spento non rispecchia", offTop.length === 0, `prima ${alwaysTop.length}, dopo ${offTop.length}`);
  } finally {
    try {
      if (browserClient) browserClient.close();
      for (const page of opened) page.client.close();
      if (ui) ui.client.close();
    } catch (error) {}
    chrome.kill("SIGKILL");
    server.close();
    await sleep(600);
    try {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
    } catch (error) {}
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} pass`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error("errore:", error.message);
  process.exit(1);
});
