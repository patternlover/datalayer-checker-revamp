// Banco visivo: apre l'estensione in un Chrome headless con la pagina demo, mette la tab in test e
// salva le schermate a due misure (popup 420×600 e tab 1100×800). Serve a un revisore (umano o LLM)
// per giudicare l'interfaccia senza avviare il browser a mano, e a me per confrontare prima/dopo.
//
// Uso:   node tools/ui-shots.mjs            → .ui-shots/*.png + tabella delle misure
//        node tools/ui-shots.mjs --out dir  → cartella diversa
// Note:  CHROME=/percorso/chrome per un binario diverso; HEADFUL=1 per vedere il browser.
// Zero dipendenze: solo Node 20+ e Chrome. Google Chrome ignora --load-extension, quindi
// l'estensione si carica dal dominio CDP `Extensions` (serve --enable-unsafe-extension-debugging).
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const demoDir = path.join(repo, "docs", "demo");
const args = process.argv.slice(2);
const outArg = args.indexOf("--out");
const OUT = path.resolve(outArg >= 0 && args[outArg + 1] ? args[outArg + 1] : path.join(repo, ".ui-shots"));
const PORT = Number(process.env.PORT || 8311);
const CDP = Number(process.env.CDP_PORT || 9511);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dlc-shots-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Le due misure che contano: il popup vero e una tab larga (pannello laterale e finestra stanno in mezzo).
const SIZES = [
  { name: "popup", width: 420, height: 600 },
  { name: "tab", width: 1100, height: 800 },
];

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split("?")[0]);
      const file = path.join(demoDir, rel === "/" ? "index.html" : rel);
      if (!file.startsWith(demoDir)) return res.writeHead(403).end();
      fs.readFile(file, (err, body) => {
        if (err) return res.writeHead(404).end("not found");
        res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" }).end(body);
      });
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

function chromeBinary() {
  if (process.env.CHROME) return process.env.CHROME;
  const found = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
  ].find((p) => fs.existsSync(p));
  if (!found) throw new Error("Chrome non trovato: passa CHROME=/percorso/chrome");
  return found;
}

function launch() {
  const flags = [
    `--remote-debugging-port=${CDP}`,
    `--remote-allow-origins=*`,
    `--user-data-dir=${profile}`,
    "--enable-unsafe-extension-debugging",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--hide-scrollbars",
    "about:blank",
  ];
  if (!process.env.HEADFUL) flags.unshift("--headless=new");
  return spawn(chromeBinary(), flags, { stdio: "ignore" });
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const ready = new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    }
  };
  return {
    ready,
    send(method, params = {}) {
      const i = ++id;
      ws.send(JSON.stringify({ id: i, method, params }));
      return new Promise((resolve, reject) => pending.set(i, { resolve, reject }));
    },
    close: () => ws.close(),
  };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await serve();
  const chrome = launch();
  const rows = [];
  try {
    let version = null;
    for (let i = 0; i < 100 && !version; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${CDP}/json/version`);
        if (res.ok) version = await res.json();
      } catch (error) {}
      if (!version) await sleep(200);
    }
    if (!version) throw new Error("Chrome non risponde sulla porta " + CDP);
    const browser = connect(version.webSocketDebuggerUrl);
    await browser.ready;

    const loaded = await browser.send("Extensions.loadUnpacked", { path: repo });
    const extId = (loaded.result || loaded).id;
    if (!extId) throw new Error("estensione non caricata: " + JSON.stringify(loaded));

    const openPage = async (url) => {
      const created = await browser.send("Target.createTarget", { url });
      const targetId = created.targetId || (created.result && created.result.targetId);
      await sleep(1500);
      const target = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find((t) => t.id === targetId);
      const page = connect(target.webSocketDebuggerUrl);
      await page.ready;
      await page.send("Runtime.enable");
      await page.send("Page.enable");
      const evaluate = async (expression) => {
        const out = await page.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
        if (out.exceptionDetails) throw new Error(out.exceptionDetails.text + " in: " + expression.slice(0, 60));
        return out.result.value;
      };
      return { page, evaluate };
    };

    // Il sito demo, poi la UI dell'estensione: la tab demo va messa "in test" come farebbe il popup.
    const site = await openPage(`http://127.0.0.1:${PORT}/`);
    await sleep(3000);
    const ui = await openPage(`chrome-extension://${extId}/index.html`);
    await sleep(2000);
    const pinned = await ui.evaluate(`(async () => {
      const port = window.__shotsPort || (window.__shotsPort = chrome.runtime.connect({ name: "dlc-ui" }));
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((t) => (t.url || "").includes("127.0.0.1:${PORT}"));
      if (!tab) return "no-tab";
      port.postMessage({ cmd: "watch", tabId: tab.id });
      port.postMessage({ cmd: "pin", tabId: tab.id });
      await new Promise((r) => setTimeout(r, 2500));
      return tab.id;
    })()`);
    if (pinned === "no-tab") throw new Error("la tab demo non è comparsa in chrome.tabs.query");

    // Un po' di eventi: click su "Aggiungi al carrello" della demo.
    await site.evaluate(`(() => { const b = document.getElementById("add"); if (b) b.click(); return true; })()`);
    await sleep(1600);

    const shot = async (page, name) => {
      const png = await page.send("Page.captureScreenshot", { format: "png" });
      const file = path.join(OUT, name + ".png");
      fs.writeFileSync(file, Buffer.from(png.data, "base64"));
      return file;
    };

    // Le misure che il revisore non può dedurre dall'immagine.
    const metrics = async (evaluate) =>
      JSON.parse(
        await evaluate(`(() => {
          const box = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; };
          const overflowing = [...document.querySelectorAll("body *")].filter((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== "auto" && getComputedStyle(el).overflowX !== "scroll").length;
          const attiva = [...document.querySelectorAll(".view")].find((el) => !el.classList.contains("is-hidden"));
          return JSON.stringify({
            viewport: window.innerWidth + "x" + window.innerHeight,
            viewAttiva: attiva ? attiva.id : "(nessuna)",
            vista: box("#events-view"),
            lista: box("#events-view .events-sidebar"),
            dettaglio: box("#events-view .detail"),
            titoloEvento: box("#detail-name"),
            righeImpostazioni: document.querySelectorAll(".setting").length,
            elementiCheSbordano: overflowing,
          });
        })()`)
      );

    for (const size of SIZES) {
      await ui.page.send("Emulation.setDeviceMetricsOverride", { width: size.width, height: size.height, deviceScaleFactor: 2, mobile: false });
      await sleep(700);

      // 1) Eventi
      await ui.evaluate(`(() => { const t = document.querySelector('.tab-btn[data-view="events"]'); if (t) t.click(); return true; })()`);
      await sleep(600);
      await shot(ui.page, `${size.name}-1-eventi`);
      rows.push({ schermata: `${size.name}-1-eventi`, ...(await metrics(ui.evaluate)) });

      // 2) Dettaglio del primo evento della lista
      await ui.evaluate(`(() => { const li = [...document.querySelectorAll("#events-list > *")].find((el) => !el.classList.contains("nav")); if (li) li.click(); return !!li; })()`);
      await sleep(700);
      await shot(ui.page, `${size.name}-2-eventi-dettaglio`);
      rows.push({ schermata: `${size.name}-2-eventi-dettaglio`, ...(await metrics(ui.evaluate)) });

      // 3) Impostazioni chiuse
      await ui.evaluate(`(async () => { document.getElementById("settings-toggle").click(); await new Promise((r) => setTimeout(r, 500)); return true; })()`);
      await sleep(600);
      await shot(ui.page, `${size.name}-3-impostazioni`);
      rows.push({ schermata: `${size.name}-3-impostazioni`, ...(await metrics(ui.evaluate)) });

      // 4) Impostazioni con le righe aperte
      await ui.evaluate(`(async () => { document.getElementById("injector-row").click(); document.getElementById("mirror-row").click(); await new Promise((r) => setTimeout(r, 500)); return true; })()`);
      await sleep(500);
      await shot(ui.page, `${size.name}-4-impostazioni-aperte`);

      // 5) UAT
      await ui.evaluate(`(async () => { document.querySelector('.tab-btn[data-view="uat"]').click(); await new Promise((r) => setTimeout(r, 600)); return true; })()`);
      await sleep(600);
      await shot(ui.page, `${size.name}-5-uat`);
      rows.push({ schermata: `${size.name}-5-uat`, ...(await metrics(ui.evaluate)) });

      // torna alle impostazioni chiuse per il giro successivo
      await ui.evaluate(`(() => { const s = document.getElementById("settings-toggle"); if (s) s.click(); return true; })()`);
      await sleep(400);
    }

    console.log("Schermate in " + OUT);
    for (const f of fs.readdirSync(OUT).filter((n) => n.endsWith(".png")).sort()) console.log("  " + f);
    console.log("\nMisure (il revisore non le vede nell'immagine):");
    for (const r of rows) {
      console.log(
        `  ${r.schermata.padEnd(26)} ${String(r.viewport).padEnd(9)} ${String(r.viewAttiva).padEnd(12)} lista ${JSON.stringify(r.lista)} dettaglio ${JSON.stringify(r.dettaglio)} titolo ${JSON.stringify(r.titoloEvento)} sbordanature ${r.elementiCheSbordano}`
      );
    }
  } finally {
    chrome.kill("SIGKILL");
    server.close();
    await sleep(400);
    try {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
    } catch (error) {}
  }
}

main().catch((error) => {
  console.error("errore:", error.message);
  process.exit(1);
});
