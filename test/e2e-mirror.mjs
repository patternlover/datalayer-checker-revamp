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
    throw new Error("exception: " + text);
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
    const noteNoInjector = await evaluate(
      ui.client,
      `(async () => {
         await chrome.storage.sync.set({ pixelmirror: true, gtmcodepush: false });
         await new Promise((r) => setTimeout(r, 300));
         document.getElementById("mirror-toggle").click();
         await new Promise((r) => setTimeout(r, 300));
         const note = document.getElementById("mirror-note");
         const hidden = note.classList.contains("is-hidden");
         return hidden ? "" : note.textContent;
       })()`
    );
    check("impostazioni: senza Injector l'avviso lo dice", /Injector/.test(noteNoInjector), String(noteNoInjector).slice(0, 80));

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

    // ---- 1b. Injector: il container iniettato deve entrare in debug (attributo su <html>) ----
    // gtm.js si dichiara in debug solo con uno di quattro segnali (sorgente di gtm.js); sul
    // checkout l'unico che possiamo dargli è `data-tag-assistant-prod-present`. Snippet finto:
    // qui interessa che il codice arrivi in pagina e che l'attributo ci sia.
    const CODE = "window.__injected = 1; /* googletagmanager.com/gtm.js?id=GTM-KWB3XWX4 */";
    const setInjector = (ta, code) => {
      const snippet = code || CODE;
      return evaluate(
        ui.client,
        `(async () => {
           await chrome.storage.sync.set({ injectorTA: ${ta}, gtmcode: ${JSON.stringify(snippet)}, gtmDomains: ["127.0.0.1"] });
           document.getElementById("gtm-domains").value = "127.0.0.1";
           document.getElementById("gtm-code").value = ${JSON.stringify(snippet)};
           const toggle = document.getElementById("injector-toggle");
           if (toggle.checked) { toggle.checked = false; toggle.dispatchEvent(new Event("change")); }
           await new Promise((r) => setTimeout(r, 300));
           toggle.checked = true;
           toggle.dispatchEvent(new Event("change"));
           await new Promise((r) => setTimeout(r, 1000));
           return JSON.stringify({ on: toggle.checked, reason: (await chrome.storage.sync.get(["gtmcodepush"])).gtmcodepush });
         })()`
      );
    };

    // La UI legge la tab in test all'avvio: dopo il pin va ricaricata, altrimenti injectIntoActiveTab
    // lavora con tabId nullo (è quello che succede a chi apre il popup dopo aver pinnato).
    await ui.client.send("Page.reload", { ignoreCache: true });
    await sleep(1500);
    const injectorState = JSON.parse(await setInjector(true));
    const injected = JSON.parse(
      await evaluate(
        checkout.client,
        `JSON.stringify({
           injected: window.__injected === 1,
           ta: document.documentElement.getAttribute("data-tag-assistant-prod-present"),
         })`
      )
    );
    check("injector: attivato dalla UI", injectorState.on === true, injectorState);
    check("injector: lo snippet arriva in pagina", injected.injected === true, JSON.stringify(injected));
    // La diagnostica deve raccontare la pagina: è quello che useremo quando qualcosa non si vede.
    const diagOut = await evaluate(
      ui.client,
      `(async () => {
         document.getElementById("diag-run").click();
         await new Promise((r) => setTimeout(r, 900));
         return document.getElementById("diag-output").textContent;
       })()`
    );
    check("diagnostica: legge la pagina in test", /container\s+GTM-|nessuno in pagina/.test(diagOut), String(diagOut).split("\n")[3] || "");
    check("diagnostica: dice se l'injector ha girato", /injector\s+(ha iniettato|non ha iniettato)/.test(diagOut));
    check("diagnostica: dice se il canale di Tag Assistant c'è", /canale TA\s+(API della companion presente|API assente)/.test(diagOut));

    check(
      "injector: container in debug per Tag Assistant",
      typeof injected.ta === "string" && Math.abs(Date.now() - Number(injected.ta)) < 300000,
      String(injected.ta)
    );

    await checkout.client.send("Page.reload", { ignoreCache: true });
    await sleep(2500);
    await setInjector(false);
    const noTa = JSON.parse(
      await evaluate(
        checkout.client,
        `JSON.stringify({
           injected: window.__injected === 1,
           ta: document.documentElement.getAttribute("data-tag-assistant-prod-present"),
         })`
      )
    );
    check("injector: senza l'opzione nessun segnale di debug", noTa.injected === true && noTa.ta === null, JSON.stringify(noTa));

    // Le due forme che in pagina reale arrivavano vuote: <script async src="…gtm.js?id=…"> e il solo
    // ID del container. Con i tag spogliati il loader spariva e non si iniettava niente.
    await checkout.client.send("Page.reload", { ignoreCache: true });
    await sleep(2500);
    await setInjector(true, '<script async src="https://www.googletagmanager.com/gtm.js?id=GTM-TEST123"></script>');
    const srcDiag = JSON.parse(
      await evaluate(
        checkout.client,
        `JSON.stringify({
           loader: !!document.querySelector('script[src*="gtm.js?id=GTM-TEST123"]'),
           injectedCode: typeof window.__dlcGtmInjectedCode === "string" ? window.__dlcGtmInjectedCode.slice(0, 60) : null,
         })`
      )
    );
    check("injector: snippet con <script src> non perde il loader", srcDiag.loader === true, JSON.stringify(srcDiag));

    await checkout.client.send("Page.reload", { ignoreCache: true });
    await sleep(2500);
    await setInjector(true, "GTM-TEST456");
    const idSnippet = JSON.parse(
      await evaluate(
        checkout.client,
        `JSON.stringify({
           loader: !!document.querySelector('script[src*="gtm.js?id=GTM-TEST456"]'),
           gtmStart: (window.dataLayer || []).some((e) => e && e.event === "gtm.js"),
         })`
      )
    );
    check("injector: basta l'ID del container", idSnippet.loader === true && idSnippet.gtmStart === true, JSON.stringify(idSnippet));

    // Un valore che non è né uno snippet né un ID non deve finire in pagina come script, e la card
    // deve dire il perché (era il caso che l'altra sessione aveva intercettato: ReferenceError muto).
    await checkout.client.send("Page.reload", { ignoreCache: true });
    await sleep(2500);
    await setInjector(true, "questo non e uno snippet");
    const invalidCard = JSON.parse(
      await evaluate(
        ui.client,
        `(async () => {
           if (document.getElementById("settings-view").classList.contains("is-hidden")) {
             document.getElementById("settings-toggle").click();
             await new Promise((r) => setTimeout(r, 400));
           }
           await new Promise((r) => setTimeout(r, 700));
           const note = document.getElementById("injector-invalid");
           return JSON.stringify({ hidden: note.classList.contains("is-hidden"), text: note.textContent });
         })()`
      )
    );
    const notInjected = await evaluate(checkout.client, "typeof window.__dlcGtmInjectedCode");
    check(
      "injector: un valore non-snippet non inietta e la card lo dice",
      notInjected === "undefined" && !invalidCard.hidden && /snippet|ID/i.test(invalidCard.text),
      JSON.stringify({ notInjected, invalidCard })
    );
    await evaluate(ui.client, `chrome.storage.sync.set({ gtmcodepush: false })`);

    // Un click al posto di quattro campi e tre interruttori: il container si legge dalla pagina.
    await checkout.client.send("Page.reload", { ignoreCache: true });
    await sleep(2500);
    await evaluate(
      checkout.client,
      `window.google_tag_manager = Object.assign({}, window.google_tag_manager || {}, { "GTM-AUTOCFG1": {} })`
    );
    const autoconfig = JSON.parse(
      await evaluate(
        ui.client,
        `(async () => {
           await chrome.storage.sync.set({ gtmcodepush: false, injectorTA: false, pixelmirror: false, gtmcode: "", gtmDomains: [] });
           await new Promise((r) => setTimeout(r, 300));
           document.getElementById("injector-autoconfig").click();
           await new Promise((r) => setTimeout(r, 1200));
           const st = await chrome.storage.sync.get(null);
           return JSON.stringify({ code: st.gtmcode, push: st.gtmcodepush, ta: st.injectorTA, mirror: st.pixelmirror, scope: st.pixelmirrorScope, domini: st.gtmDomains });
         })()`
      )
    );
    check("autoconfig: legge il container dalla pagina", autoconfig.code === "GTM-AUTOCFG1", JSON.stringify(autoconfig));
    check(
      "autoconfig: accende injector, Tag Assistant e ponte",
      autoconfig.push === true && autoconfig.ta === true && autoconfig.mirror === true && autoconfig.scope === "solo-checkout"
    );
    check("autoconfig: prende il dominio dalla tab", JSON.stringify(autoconfig.domini) === JSON.stringify(["127.0.0.1"]), JSON.stringify(autoconfig.domini));
    await evaluate(ui.client, `chrome.storage.sync.set({ gtmcodepush: false })`);


    // ---- 2. pagina prodotto: con scope solo-checkout non deve passare niente ----
    const product = await openPage(browserClient, `http://127.0.0.1:${PORT}/mirror-prodotti.html`);
    opened.push(product);
    const productTabId = await evaluate(ui.client, PIN_SCRIPT("mirror-prodotti.html"));
    check("tab prodotto in test", typeof productTabId === "number", String(productTabId));
    await product.client.send("Page.reload", { ignoreCache: true });
    await sleep(5000);
    const productTop = JSON.parse(await evaluate(product.client, "JSON.stringify(window.dataLayer || [])"));
    check("fuori scope non rispecchia", productTop.length === 0, JSON.stringify(productTop.map((e) => e.event)));

    // ---- 3. con scope "sempre" invece rispecchia ----
    await evaluate(ui.client, `chrome.storage.sync.set({ pixelmirrorScope: "sempre" })`);
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
