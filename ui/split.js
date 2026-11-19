// Separatore lista / dettaglio, condiviso dalle schede Eventi e Hit: le due parti si dividono lo
// spazio, impilate nel pannello stretto (si trascina in altezza) e affiancate in una finestra
// larga (si trascina in larghezza). La misura scelta si ricorda per asse, così passando da una
// finestra all'altra ognuna ritrova la sua.
export function initSplit(opts) {
  const view = opts.view;
  const sidebar = opts.sidebar;
  const handle = opts.handle;
  const key = opts.key;
  if (!view || !sidebar || !handle) return;

  const sizes = { stacked: null, aside: null };

  function axis() {
    return getComputedStyle(view).flexDirection === "column" ? "stacked" : "aside";
  }

  function clamp(size, axes) {
    const rect = view.getBoundingClientRect();
    if (axes === "stacked") {
      // Al dettaglio restano almeno 180px: sotto, il contenuto è inutilizzabile.
      return Math.round(Math.max(120, Math.min(size, rect.height - 180)));
    }
    return Math.round(Math.max(170, Math.min(size, rect.width - 240)));
  }

  function apply() {
    // Con la vista nascosta (altra scheda o Impostazioni) le misure valgono 0: applicare adesso
    // vorrebbe dire scrivere il minimo. Si riapplica quando la vista torna visibile.
    const rect = view.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const current = axis();
    sidebar.style.flexBasis = "";
    sidebar.style.width = "";
    const size = sizes[current];
    if (!size) return;
    sidebar.style.flexBasis = clamp(size, current) + "px";
    if (current === "aside") sidebar.style.width = clamp(size, current) + "px";
  }

  function save() {
    chrome.storage.local.set({ [key]: sizes }).catch(() => {});
  }

  function set(size, axes) {
    sizes[axes] = clamp(size, axes);
    apply();
  }

  chrome.storage.local
    .get(key)
    .then((stored) => {
      const saved = stored[key];
      if (saved && typeof saved === "object") {
        if (Number.isFinite(saved.stacked)) sizes.stacked = saved.stacked;
        if (Number.isFinite(saved.aside)) sizes.aside = saved.aside;
        apply();
      }
    })
    .catch(() => {});

  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const current = axis();
    const rect = view.getBoundingClientRect();
    handle.setPointerCapture(event.pointerId);
    handle.classList.add("is-dragging");
    document.body.classList.add("is-splitting");
    document.body.style.cursor = current === "stacked" ? "row-resize" : "col-resize";

    const move = (ev) => {
      const raw = current === "stacked" ? ev.clientY - rect.top : ev.clientX - rect.left;
      set(raw, current);
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      handle.classList.remove("is-dragging");
      document.body.classList.remove("is-splitting");
      document.body.style.cursor = "";
      save();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  });

  // Tastiera: il separatore è raggiungibile con Tab e si muove a passi di 16px.
  handle.addEventListener("keydown", (event) => {
    const current = axis();
    const box = sidebar.getBoundingClientRect();
    const at = sizes[current] || (current === "stacked" ? box.height : box.width);
    const step = event.shiftKey ? 48 : 16;
    let next = null;
    if (current === "stacked" && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      next = at + (event.key === "ArrowDown" ? step : -step);
    } else if (current === "aside" && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      next = at + (event.key === "ArrowRight" ? step : -step);
    }
    if (next == null) return;
    event.preventDefault();
    set(next, current);
    save();
  });

  // La finestra cambia misura (o cambia asse): le misure salvate restano nei limiti.
  // ResizeObserver copre anche il ritorno sulla vista, quando aveva misura 0.
  window.addEventListener("resize", apply);
  if (typeof ResizeObserver === "function") new ResizeObserver(() => apply()).observe(view);
}
