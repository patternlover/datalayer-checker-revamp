// Verifica lo standard "ponte pixel → Top" (docs/pixel-to-top-bridge.md).
//
// Serve due pagine: un finto checkout che contiene un iframe `sandbox="allow-scripts"` servito da
// /sandbox/modern/…, e dentro quel frame il pixel con il suo ponte. Il Top ha il ricevitore.
// Controlla che nel dataLayer del frame principale arrivino gli eventi giusti, nell'ordine giusto,
// senza `gtm.*` e con i push in stile `gtag` trattati come tali.
//
// Uso: node test/bridge-standard.mjs     (CHROME=/percorso/chrome per un binario diverso)
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pixelBridge = fs.readFileSync(path.join(repo, "docs/snippets/pixel-to-top-pixel.js"), "utf8");
const topReceiver = fs.readFileSync(path.join(repo, "docs/snippets/pixel-to-top-top.html"), "utf8").replace(/<\/?script>/g, "");
const PORT = Number(process.env.PORT || 8271);
const CDP_PORT = Number(process.env.CDP_PORT || 9471);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dlc-bridge-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CHECKOUT = `<!doctype html><html><head><title>finto checkout</title>
<script>${topReceiver}</script>
</head><body>
<iframe sandbox="allow-scripts" src="/sandbox/modern/checkouts/demo/pixel.html" width="200" height="60"></iframe>
</body></html>`;

const PIXEL = `<!doctype html><html><head><title>finto pixel</title></head><body>
<script>${pixelBridge}</script>
<script>
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ event: "gtm.js", "gtm.start": Date.now(), "gtm.uniqueEventId": 1 });
  window.dataLayer.push({
    event: "checkout_started",
    "gtm.uniqueEventId": 2,
    checkout: { currencyCode: "EUR", totalPrice: { amount: 89 }, lineItems: [{ quantity: 1, title: "MAG-001" }] },
  });
  // push in stile gtag: dataLayer.push(arguments)
  window.dataLayer.push((function () { return arguments; })("event", "add_payment_info"));
  setInterval(function () { window.dataLayer.push({ event: "begin_checkout", value: 89 }); }, 700);
</script>
</body></html>`;

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split("?")[0]);
      if (url === "/" || url === "/checkout.html") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(CHECKOUT);
        return;
      }
      if (url.startsWith("/sandbox/modern/")) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(PIXEL);
        return;
      }
      res.writeHead(404).end("not found");
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

const results = [];
function check(name, ok, detail) {
  results.push({ ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

async function main() {
  if (process.env.DEBUG_BRIDGE) console.log("CHECKOUT len", CHECKOUT.length, "| receiver len", topReceiver.length, "| pixel len", pixelBridge.length);
  const server = await serve();
  if (process.env.DEBUG_BRIDGE) {
    const served = await (await fetch(`http://127.0.0.1:${PORT}/checkout.html`)).text();
    console.log("SERVED len", served.length, JSON.stringify(served.slice(0, 160)));
  }
  const chrome = spawn(
    chromeBinary(),
    [
      "--headless=new",
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "about:blank",
    ],
    { stdio: "ignore" }
  );
  let client;
  try {
    const version = await (async () => {
      for (let i = 0; i < 100; i++) {
        try {
          const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
          if (res.ok) return res.json();
        } catch (error) {}
        await sleep(200);
      }
      throw new Error("Chrome non risponde su " + CDP_PORT);
    })();
    client = connect(version.webSocketDebuggerUrl);
    await client.ready;
    const { targetId } = await client.send("Target.createTarget", { url: `http://127.0.0.1:${PORT}/checkout.html` });
    await sleep(4000);

    const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
    const page = targets.find((t) => t.id === targetId);
    const pageClient = connect(page.webSocketDebuggerUrl);
    await pageClient.ready;
    await pageClient.send("Runtime.enable");
    const out = await pageClient.send("Runtime.evaluate", {
      expression: `JSON.stringify({
        events: (window.dataLayer || []).map((e) => (e && e.event) || Object.keys(e || {})[0]),
        raw: (window.dataLayer || []).map((e) => JSON.stringify(e).slice(0, 120)),
        started: (window.dataLayer || []).find((e) => e && e.event === "checkout_started") || null,
        gtagEntry: (window.dataLayer || []).find((e) => e && e["0"] === "event") || null,
        ready: !!window.__pixelToTopReady,
        frames: document.querySelectorAll("iframe").length,
        frameSrc: (document.querySelector("iframe") || {}).src || null,
        head: document.head.innerHTML.replace(/\s+/g, " ").slice(0, 120),
      })`,
      returnByValue: true,
    });
    const data = JSON.parse(out.result.value);
    const events = data.events.filter(Boolean);
    if (process.env.DEBUG_BRIDGE) console.log("DEBUG:", JSON.stringify(data, null, 1).slice(0, 900));

    check("gli eventi del pixel arrivano nel Top", events.includes("checkout_started"), events.join(", "));
    check("nessun gtm.* dal sandbox", !events.some((e) => String(e).indexOf("gtm.") === 0), events.filter((e) => String(e).indexOf("gtm.") === 0).join(", "));
    check(
      "il payload arriva identico",
      !!data.started && data.started.checkout && data.started.checkout.totalPrice.amount === 89,
      JSON.stringify(data.started && data.started.checkout)
    );
    check("i push in stile gtag arrivano come arguments", !!data.gtagEntry, data.gtagEntry ? JSON.stringify(data.gtagEntry).slice(0, 80) : "nessuno");
    check(
      "ordine: checkout_started prima dei begin_checkout",
      events.indexOf("checkout_started") !== -1 && events.lastIndexOf("begin_checkout") > events.indexOf("checkout_started"),
      events.join(", ")
    );
    pageClient.close();
  } finally {
    if (client) client.close();
    chrome.kill("SIGKILL");
    server.close();
    await sleep(400);
    try {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
    } catch (error) {}
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} pass`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error("errore:", error.message);
  process.exit(1);
});
