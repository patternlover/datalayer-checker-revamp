self.Flatted = (function (n) {
  "use strict";
  function t(n) {
    return (
      (t =
        "function" == typeof Symbol && "symbol" == typeof Symbol.iterator
          ? function (n) {
              return typeof n;
            }
          : function (n) {
              return n && "function" == typeof Symbol && n.constructor === Symbol && n !== Symbol.prototype ? "symbol" : typeof n;
            }),
      t(n)
    );
  }
  var r = JSON.parse,
    e = JSON.stringify,
    o = Object.keys,
    u = String,
    f = "string",
    i = {},
    c = "object",
    a = function (n, t) {
      return t;
    },
    l = function (n) {
      return n instanceof u ? u(n) : n;
    },
    s = function (n, r) {
      return t(r) === f ? new u(r) : r;
    },
    y = function n(r, e, f, a) {
      for (var l = [], s = o(f), y = s.length, p = 0; p < y; p++) {
        var v = s[p],
          S = f[v];
        if (S instanceof u) {
          var b = r[S];
          t(b) !== c || e.has(b) ? (f[v] = a.call(f, v, b)) : (e.add(b), (f[v] = i), l.push({ k: v, a: [r, e, b, a] }));
        } else f[v] !== i && (f[v] = a.call(f, v, S));
      }
      for (var m = l.length, g = 0; g < m; g++) {
        var h = l[g],
          O = h.k,
          d = h.a;
        f[O] = a.call(f, O, n.apply(null, d));
      }
      return f;
    },
    p = function (n, t, r) {
      var e = u(t.push(r) - 1);
      return n.set(r, e), e;
    },
    v = function (n, e) {
      var o = r(n, s).map(l),
        u = o[0],
        f = e || a,
        i = t(u) === c && u ? y(o, new Set(), u, f) : u;
      return f.call({ "": i }, "", i);
    },
    S = function (n, r, o) {
      for (
        var u =
            r && t(r) === c
              ? function (n, t) {
                  return "" === n || -1 < r.indexOf(n) ? t : void 0;
                }
              : r || a,
          i = new Map(),
          l = [],
          s = [],
          y = +p(i, l, u.call({ "": n }, "", n)),
          v = !y;
        y < l.length;

      )
        (v = !0), (s[y] = e(l[y++], S, o));
      return "[" + s.join(",") + "]";
      function S(n, r) {
        if (v) return (v = !v), r;
        var e = u.call(this, n, r);
        switch (t(e)) {
          case c:
            if (null === e) return e;
          case f:
            return i.get(e) || p(i, l, e);
        }
        return e;
      }
    };
  return (
    (n.fromJSON = function (n) {
      return v(e(n));
    }),
    (n.parse = v),
    (n.stringify = S),
    (n.toJSON = function (n) {
      return r(S(n));
    }),
    n
  );
})({});

(async function display() {
  "use strict";

  const $ = (selector) => document.querySelector(selector);

  const els = {
    eventsList: $("#events-list"),
    eventsCount: $("#events-count"),
    detailIndex: $("#detail-index"),
    detailName: $("#detail-name"),
    detailJson: $("#detail-json"),
    detailBody: $("#detail-body"),
    emptyState: $("#empty-state"),
    copyBtn: $("#copy-push"),
    envSelect: $("#env-select"),
    injectorChip: $("#injector-chip"),
    settingsToggle: $("#settings-toggle"),
    settingsClose: $("#settings-close"),
    eventsView: $("#events-view"),
    settingsView: $("#settings-view"),
    injectorToggle: $("#injector-toggle"),
    injectTarget: $("#inject-target"),
    mirrorPixel: $("#mirror-pixel"),
    gtmCode: $("#gtm-code"),
    injectorCard: $("#injector-card"),
    saveBtn: $("#save-settings"),
    toast: $("#toast"),
  };

  let currentData = [];
  let selectedIndex = -1;
  let selectedEvent = null;
  let followNewest = true;
  let topFrame = true;
  let streamPorts = [];

  const EVENT_LABELS = {
    "gtm.init_consent": "Consent Initialization",
    "gtm.init": "Initialization",
    "gtm.js": "Container Loaded",
    "gtm.dom": "DOM Ready",
    "gtm.load": "Window Loaded",
    "gtm.scrollDepth": "Scroll Depth",
    "gtm.timer": "Timer",
    "gtm.elementVisibility": "Element Visibility",
    "gtm.click": "Click",
    "gtm.linkClick": "Link Click",
    "gtm.formSubmit": "Form Submit",
    "gtm.formStart": "Form Start",
    "gtm.video": "YouTube Video",
    "gtm.historyChange": "History",
    "gtm.triggerGroup": "Trigger Group",
    "gtm.pageError": "JavaScript Error",
  };

  function eventLabel(obj) {
    if (!obj || typeof obj !== "object") return "Message";
    if (typeof obj.event === "string") return EVENT_LABELS[obj.event] || obj.event;
    if (typeof obj["0"] !== "undefined") return String(obj["0"]);
    return "Message";
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) {}
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch (e) {
      return false;
    }
  }

  let toastTimer;
  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove("is-visible"), 1800);
  }

  function renderSource(meta) {
    if (!meta || (!meta.url && !meta.host)) {
      els.envSelect.title = "";
      return;
    }
    let label;
    if (meta.isShopifySandbox) label = "Shopify Custom Pixel";
    else if (meta.isTop) label = "Top frame";
    else label = "iframe";
    els.envSelect.title = label + (meta.host ? " · " + meta.host : "") + (meta.url ? "\n" + meta.url : "");
  }

  function selectEvent(position) {
    if (position < 1 || position > currentData.length) return;
    selectedIndex = position;
    selectedEvent = currentData[position - 1];
    els.detailIndex.textContent = position;
    els.detailName.textContent = eventLabel(selectedEvent);
    els.detailJson.textContent = JSON.stringify(selectedEvent, null, 2);
    els.copyBtn.disabled = false;
    els.emptyState.classList.add("is-hidden");
    els.detailJson.classList.remove("is-hidden");
    els.detailBody.scrollTop = 0;
    els.eventsList.querySelectorAll(".event-row").forEach((row) => {
      const isActive = Number(row.dataset.index) === position;
      row.classList.toggle("active", isActive);
      if (isActive) row.scrollIntoView({ block: "nearest" });
    });
  }

  function renderEvents() {
    els.eventsList.innerHTML = "";
    els.eventsCount.textContent = currentData.length;
    for (let position = currentData.length; position >= 1; position--) {
      const obj = currentData[position - 1];
      const row = document.createElement("button");
      row.type = "button";
      row.className = "event-row";
      row.dataset.index = position;
      const num = document.createElement("span");
      num.className = "event-num";
      num.textContent = position;
      const name = document.createElement("span");
      name.className = "event-name";
      name.textContent = eventLabel(obj);
      row.appendChild(num);
      row.appendChild(name);
      els.eventsList.appendChild(row);
    }
  }

  function resetDetail() {
    selectedIndex = -1;
    selectedEvent = null;
    els.detailIndex.textContent = "–";
    els.detailName.textContent = "Nessun evento";
    els.detailJson.textContent = "";
    els.detailJson.classList.add("is-hidden");
    els.copyBtn.disabled = true;
    els.emptyState.classList.remove("is-hidden");
  }

  function clearEvents() {
    currentData = [];
    followNewest = true;
    renderEvents();
    resetDetail();
  }

  function applyIncoming(parsed) {
    const incoming = Array.isArray(parsed.dlData) ? parsed.dlData : [];
    const mode = parsed.mode || "snapshot";
    if (mode === "append") {
      if (currentData.length !== parsed.startIndex) return;
      if (!incoming.length) return;
      currentData = currentData.concat(incoming);
    } else {
      currentData = incoming;
      followNewest = true;
    }
    if (currentData.length > 500) {
      currentData = currentData.slice(currentData.length - 500);
    }
    renderSource(parsed.meta || null);
    renderEvents();
    if (!currentData.length) {
      resetDetail();
      return;
    }
    if (followNewest || selectedIndex < 1 || selectedIndex > currentData.length) {
      selectEvent(currentData.length);
    } else {
      selectEvent(selectedIndex);
    }
  }

  function handleStreamMessage(request) {
    if (!request) return;
    let parsed;
    try {
      parsed = Flatted.parse(request);
    } catch (e) {
      return;
    }
    if (!parsed || !parsed.dlData) return;
    applyIncoming(parsed);
  }

  chrome.runtime.onConnect.addListener(function (port) {
    if (port.name !== "dlc-stream") return;
    streamPorts.push(port);
    port.onDisconnect.addListener(function () {
      streamPorts = streamPorts.filter((p) => p !== port);
    });
    port.onMessage.addListener(handleStreamMessage);
  });

  function stopStreams() {
    streamPorts.forEach((port) => {
      try {
        port.disconnect();
      } catch (e) {}
    });
    streamPorts = [];
  }

  els.eventsList.addEventListener("click", (e) => {
    const row = e.target.closest(".event-row");
    if (!row) return;
    followNewest = false;
    selectEvent(Number(row.dataset.index));
  });

  els.copyBtn.addEventListener("click", async () => {
    if (selectedEvent == null) return;
    const text = "dataLayer.push(" + JSON.stringify(selectedEvent, null, 2) + ");";
    const ok = await copyText(text);
    showToast(ok ? "Push copiato!" : "Copia non riuscita");
  });

  function openSettings() {
    els.eventsView.classList.add("is-hidden");
    els.settingsView.classList.remove("is-hidden");
  }
  function closeSettings() {
    els.settingsView.classList.add("is-hidden");
    els.eventsView.classList.remove("is-hidden");
  }
  els.settingsToggle.addEventListener("click", openSettings);
  els.settingsClose.addEventListener("click", closeSettings);

  function refreshInjectorUI() {
    const on = els.injectorToggle.checked;
    els.injectorCard.classList.toggle("is-on", on);
    els.gtmCode.disabled = !on;
    els.injectorChip.textContent = on ? "GTM Injector ON" : "GTM Injector OFF";
    els.injectorChip.classList.toggle("chip-on", on);
    els.injectorChip.classList.toggle("chip-off", !on);
  }

  function setEnvUI(frame) {
    els.envSelect.querySelectorAll(".seg-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.env === frame);
    });
  }

  function activeTabId(callback) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      callback(tabs && tabs[0] ? tabs[0].id : null);
    });
  }

  function injectCollector(tabId) {
    if (tabId == null) return;
    chrome.webNavigation.getAllFrames({ tabId: tabId }, (frames) => {
      if (!frames) return;
      for (const frame of frames) {
        let shouldInject = false;
        if (!topFrame) {
          shouldInject = frame.url.includes("/sandbox/modern/") && !frame.url.includes("shopify-custom-pixel") && frame.frameType === "sub_frame";
        } else {
          shouldInject = frame.frameId === 0 && frame.frameType === "outermost_frame";
        }
        if (shouldInject) {
          chrome.scripting
            .executeScript({
              target: { tabId: tabId, frameIds: [frame.frameId] },
              files: ["scripts/content.js"],
            })
            .catch((error) => console.log(error));
        }
      }
    });
  }

  function currentInjectTarget() {
    const active = els.injectTarget.querySelector(".seg-btn.active");
    return active ? active.dataset.target : "top";
  }

  function setTargetUI(target) {
    els.injectTarget.querySelectorAll(".seg-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.target === target);
    });
  }

  function setMirrorUI(mode) {
    els.mirrorPixel.querySelectorAll(".seg-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mirror === mode);
    });
  }

  function injectScriptsIntoFrame(tabId, frameId) {
    chrome.scripting.executeScript({ target: { tabId: tabId, frameIds: [frameId] }, files: ["scripts/gtmcode.js"], world: "MAIN" }).catch(() => {});
    chrome.scripting.executeScript({ target: { tabId: tabId, frameIds: [frameId] }, files: ["scripts/bridge.js"] }).catch(() => {});
  }

  function injectGtmIntoActiveTab() {
    const target = currentInjectTarget();
    activeTabId((tabId) => {
      if (tabId == null) return;
      chrome.webNavigation.getAllFrames({ tabId: tabId }, (frames) => {
        if (!frames) {
          if (target === "top") injectScriptsIntoFrame(tabId, 0);
          return;
        }
        for (const frame of frames) {
          const isTop = frame.frameId === 0;
          const isSandbox = frame.url.includes("/sandbox/modern/") && !frame.url.includes("shopify-custom-pixel") && frame.frameType === "sub_frame";
          const here = target === "pixel" ? isSandbox : isTop;
          if (here) injectScriptsIntoFrame(tabId, frame.frameId);
        }
      });
    });
  }

  function switchEnv(frame) {
    topFrame = frame === "top_frame";
    setEnvUI(frame);
    clearEvents();
    stopStreams();
    chrome.storage.sync.set({ frame: frame });
    activeTabId((tabId) => injectCollector(tabId));
  }

  els.envSelect.querySelectorAll(".seg-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.classList.contains("active")) return;
      switchEnv(btn.dataset.env);
    });
  });

  els.injectTarget.querySelectorAll(".seg-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (btn.classList.contains("active")) return;
      setTargetUI(btn.dataset.target);
      await chrome.storage.sync.set({ injectTarget: btn.dataset.target });
      if (els.injectorToggle.checked) injectGtmIntoActiveTab();
    });
  });

  els.mirrorPixel.querySelectorAll(".seg-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (btn.classList.contains("active")) return;
      setMirrorUI(btn.dataset.mirror);
      await chrome.storage.sync.set({ mirrorPixel: btn.dataset.mirror });
    });
  });

  els.injectorToggle.addEventListener("change", async () => {
    const on = els.injectorToggle.checked;
    refreshInjectorUI();
    await chrome.storage.sync.set({ gtmcodepush: on });
    if (on) injectGtmIntoActiveTab();
  });

  els.saveBtn.addEventListener("click", async () => {
    await chrome.storage.sync.set({ gtmcode: els.gtmCode.value });
    showToast("Codice salvato");
    if (els.injectorToggle.checked) injectGtmIntoActiveTab();
  });

  const stored = await chrome.storage.sync.get(["frame", "gtmcodepush", "gtmcode", "injectTarget", "mirrorPixel"]);
  const initialFrame = stored.frame === "iframe" ? "iframe" : "top_frame";
  topFrame = initialFrame === "top_frame";
  setEnvUI(initialFrame);
  setTargetUI(stored.injectTarget === "pixel" ? "pixel" : "top");
  setMirrorUI(stored.mirrorPixel === "on" || stored.mirrorPixel === "off" ? stored.mirrorPixel : "auto");
  els.injectorToggle.checked = stored.gtmcodepush === true;
  els.gtmCode.value = typeof stored.gtmcode === "string" ? stored.gtmcode : "";
  refreshInjectorUI();
  resetDetail();

  activeTabId((tabId) => injectCollector(tabId));

  chrome.tabs.onUpdated.addListener(function (tabId, changeInfo) {
    if (changeInfo.status !== "complete") return;
    activeTabId((activeId) => {
      if (activeId === tabId) injectCollector(tabId);
    });
  });
})();
