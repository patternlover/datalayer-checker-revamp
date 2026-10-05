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
  var topFrame = true;

  const result = await chrome.storage.sync.get(["frame"]);
  if (Object.keys(result).includes("frame")) {
    topFrame = result.frame === "top_frame" ? true : false;
  }
  chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request && Flatted.parse(request).dlData) {
      document.querySelector(".growth_success_message_container").style = "display:none";
      var data = Flatted.parse(request).dlData;
      data.unshift({ event: "gtm.init_consent" }, { event: "gtm.init" });
      var eventName = data
        .map((obj, index, arr) => {
          if (Object.keys(obj).includes("event") || Object.keys(obj).includes("0")) {
            if (arr[index].event === "gtm.init_consent") {
              return "Consent Initialization";
            }
            if (arr[index].event === "gtm.init") {
              return "Initialization";
            }
            if (arr[index].event === "gtm.js") {
              return "Container Loaded";
            }
            if (arr[index].event === "gtm.dom") {
              return "DOM Ready";
            }
            if (arr[index].event === "gtm.load") {
              return "Window Loaded";
            }
            if (arr[index].event === "gtm.scrollDepth") {
              return "Scroll Depth";
            }
            if (arr[index].event === "gtm.timer") {
              return "Timer";
            }
            if (arr[index].event === "gtm.elementVisibility") {
              return "Element Visibility";
            }
            if (arr[index].event === "gtm.click") {
              return "Click";
            }
            if (arr[index].event === "gtm.linkClick") {
              return "Link Click";
            }
            if (arr[index].event === "gtm.formSubmit") {
              return "Form Submit";
            }
            if (arr[index].event === "gtm.formStart") {
              return "Form Start";
            }
            if (arr[index].event === "gtm.video") {
              return "YouTube Video";
            }
            if (arr[index].event === "gtm.historyChange") {
              return "History";
            }
            if (arr[index].event === "gtm.triggerGroup") {
              return "Trigger Group";
            }
            if (arr[index].event === "gtm.pageError") {
              return "JavaScript Error";
            }
            return arr[index]["0"] ? arr[index]["0"] : arr[index].event;
          } else {
            return "Message";
          }
        })
        .reverse();
      eventName.forEach((element, index, arr) => {
        var newDiv = document.createElement("div");
        newDiv.className = "growth_eventname_container";
        var newParagraphone = document.createElement("p");
        var newParagraphtwo = document.createElement("p");
        newParagraphone.className = "growth_eventnumber";
        newParagraphtwo.className = "growth_eventname";
        newParagraphone.textContent = `${arr.length - index}`;
        newParagraphtwo.textContent = `${element}`;
        newDiv.appendChild(newParagraphone);
        newDiv.appendChild(newParagraphtwo);
        document.querySelector(".growth_side_nav_container").appendChild(newDiv);
      });
      var sideNav = document.querySelector(".growth_side_nav_container");
      var previousElem;
      sideNav.addEventListener("click", (e) => {
        if (e.target.classList.contains("growth_eventname_container") || e.target.classList.contains("growth_eventname") || e.target.classList.contains("growth_eventnumber")) {
          if (document.querySelector(".growth_right_eventdata_container > pre")) {
            document.querySelector(".growth_right_eventdata_container > pre").remove();
          }
          if (previousElem) {
            if (previousElem.classList.contains("growth_eventname_container")) {
              previousElem.classList.remove("active");
            }
            if (previousElem.classList.contains("growth_eventname") || previousElem.classList.contains("growth_eventnumber")) {
              previousElem.parentElement.classList.remove("active");
            }
          }
          if (e.target.classList.contains("growth_eventname_container")) {
            e.target.classList.add("active");
            var targetIndex = parseFloat(e.target.firstElementChild.innerText);
            var targetValue = data[targetIndex - 1];
            var eventDataContainerElement = document.querySelector(".growth_right_eventdata_container");
            eventDataContainerElement.appendChild(
              renderjson
                .set_icons("▶", "▼")
                .set_show_to_level(1)
                .set_collapse_msg(function (len) {
                  return "....";
                })(targetValue)
            );
          }
          if (e.target.classList.contains("growth_eventname") || e.target.classList.contains("growth_eventnumber")) {
            e.target.parentElement.classList.add("active");
            var targetIndex = parseFloat(e.target.parentElement.firstElementChild.innerText);
            var targetValue = data[targetIndex - 1];
            var eventDataContainerElement = document.querySelector(".growth_right_eventdata_container");
            eventDataContainerElement.appendChild(
              renderjson
                .set_icons("▶", "▼")
                .set_show_to_level(1)
                .set_collapse_msg(function (len) {
                  return "....";
                })(targetValue)
            );
          }
          previousElem = e.target;
        }
      });
    }
  });

  if (!topFrame) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      chrome.webNavigation.getAllFrames({ tabId: tabs[0].id }, (data) => {
        for (let i = 0; i < data.length; i++) {
          const element = data[i];
          if (element.url.includes("/sandbox/modern/") === true && element.url.includes("shopify-custom-pixel") === false && element.frameType === "sub_frame") {
            try {
              chrome.scripting.executeScript({
                target: { tabId: tabs[0].id, frameIds: [element.frameId] },
                files: ["scripts/content.js"],
              });
            } catch (error) {
              console.log(error);
            }
          }
        }
      });
    });
  } else {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      chrome.webNavigation.getAllFrames({ tabId: tabs[0].id }, (data) => {
        for (let i = 0; i < data.length; i++) {
          const element = data[i];
          if (element.frameId === 0 && element.frameType === "outermost_frame") {
            try {
              chrome.scripting.executeScript({
                target: { tabId: tabs[0].id, frameIds: [element.frameId] },
                files: ["scripts/content.js"],
              });
            } catch (error) {
              console.log(error);
            }
          }
        }
      });
    });
  }
  document.querySelector(".growth_settings_logo_container").addEventListener("click", async (e) => {
    var frameValue = await chrome.storage.sync.get(["frame"]);
    var gtmcodepushValue = await chrome.storage.sync.get(["gtmcodepush"]);
    var gtmValue = await chrome.storage.sync.get(["gtmcode"]);
    document.querySelector(".gtmclass").value = gtmValue.gtmcode;
    if (Object.keys(frameValue).includes("frame") && frameValue.frame === "iframe") {
      document.querySelector("#topframe").checked = true;
    }

    if (Object.keys(gtmcodepushValue).includes("gtmcodepush") && gtmcodepushValue.gtmcodepush === true) {
      document.querySelector("#growthid").checked = true;

      document.querySelector(".gtmclass").classList.remove("message_box");
    } else {
      document.querySelector("#growthid").checked = false;
    }

    document.querySelector(".growth_data_container").classList.add("growth_settings_display");
    document.querySelector(".growth_settings").classList.remove("growth_settings_display");

    document.querySelector("#growthid").addEventListener("click", (e) => {
      document.querySelector(".gtmclass").classList.contains("message_box") ? document.querySelector(".gtmclass").classList.remove("message_box") : document.querySelector(".gtmclass").classList.add("message_box");
    });

    document.querySelector(".btn_container").addEventListener("click", async (e) => {
      var selected = document.querySelector("#topframe").checked;
      var gtmInjector = document.querySelector("#growthid").checked;
      var code = document.querySelector(".gtmclass").value;
      gtmInjector ? await chrome.storage.sync.set({ gtmcodepush: true }) : await chrome.storage.sync.set({ gtmcodepush: false });
      await chrome.storage.sync.set({ gtmcode: code });
      if (selected) {
        await chrome.storage.sync.set({ frame: "iframe" });
        document.querySelectorAll(".message_container")[0].classList.add("message_active");
        document.querySelector(".cross_sign").addEventListener("click", () => {
          document.querySelectorAll(".message_container")[0].classList.remove("message_active");
        });
      } else {
        await chrome.storage.sync.set({ frame: "top_frame" });
        document.querySelectorAll(".message_container")[0].classList.add("message_active");
        document.querySelector(".cross_sign").addEventListener("click", () => {
          document.querySelectorAll(".message_container")[0].classList.remove("message_active");
        });
      }
    });
  });
})();
