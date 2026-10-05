/** Shared, keyboard-accessible selects without native browser popup menus. */
(function (J) {
  "use strict";
  const states = new WeakMap();
  let active = null,
    sequence = 0,
    installed = false,
    queued = false;
  const chevron =
    '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m3 5.5 5 5 5-5"/></svg>';
  function close(focus = false) {
    if (!active) return;
    const state = active;
    active = null;
    state.menu.hidden = true;
    state.menu.remove();
    state.button.setAttribute("aria-expanded", "false");
    state.button.removeAttribute("aria-activedescendant");
    if (focus && state.button.isConnected) state.button.focus();
  }
  function synchronize(state) {
    const { select, button, text } = state;
    const label = select.selectedOptions[0]?.textContent || "Vyberte…";
    if (text.textContent !== label) text.textContent = label;
    if (button.disabled !== select.disabled) button.disabled = select.disabled;
    if (
      active === state &&
      (!select.isConnected ||
        select.disabled ||
        !button.getClientRects().length)
    )
      close();
  }
  function highlight(state, index) {
    state.index = index;
    for (const item of state.menu.children)
      item.classList.toggle("highlighted", +item.dataset.index === index);
    const item = state.menu.querySelector(`[data-index="${index}"]`);
    if (item) {
      state.button.setAttribute("aria-activedescendant", item.id);
      item.scrollIntoView({ block: "nearest" });
    }
  }
  function position(state) {
    const r = state.button.getBoundingClientRect(),
      menu = state.menu;
    menu.style.minWidth = `${Math.min(r.width, innerWidth - 8)}px`;
    menu.style.maxWidth = `${innerWidth - 8}px`;
    menu.style.maxHeight = `${Math.max(60, Math.min(320, Math.max(innerHeight - r.bottom - 8, r.top - 8)))}px`;
    const m = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(r.left, innerWidth - m.width - 4))}px`;
    menu.style.top = `${Math.max(4, r.bottom + m.height + 6 <= innerHeight ? r.bottom + 3 : r.top - m.height - 3)}px`;
  }
  function choose(state, index) {
    const option = state.select.options[index];
    if (!option || option.disabled || option.parentElement.disabled) return;
    const changed = state.select.selectedIndex !== index;
    state.select.selectedIndex = index;
    synchronize(state);
    close(true);
    if (changed) {
      state.select.dispatchEvent(new Event("input", { bubbles: true }));
      state.select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
  function populate(state) {
    state.menu.replaceChildren();
    for (const [index, option] of [...state.select.options].entries()) {
      if (option.hidden) continue;
      const item = document.createElement("button");
      item.type = "button";
      item.role = "option";
      item.id = `${state.menu.id}-${index}`;
      item.tabIndex = -1;
      item.dataset.index = index;
      item.textContent = option.textContent;
      item.disabled = option.disabled || !!option.parentElement.disabled;
      item.setAttribute("aria-selected", String(option.selected));
      item.onpointerdown = (e) => e.preventDefault();
      item.onpointermove = () => {
        if (!item.disabled) highlight(state, index);
      };
      item.onclick = () => choose(state, index);
      state.menu.append(item);
    }
  }
  function open(state) {
    close();
    if (state.select.disabled) return;
    active = state;
    state.search = "";
    state.searchTime = 0;
    populate(state);
    const host = state.select.closest("dialog") || document.body;
    host.append(state.menu);
    state.menu.hidden = false;
    state.button.setAttribute("aria-expanded", "true");
    position(state);
    const first = [...state.menu.children].find((item) => !item.disabled);
    highlight(
      state,
      state.select.selectedIndex >= 0
        ? state.select.selectedIndex
        : +(first?.dataset.index || 0),
    );
  }
  function enhance(select) {
    if (select.hidden || select.multiple || select.size > 1) return;
    let state = states.get(select);
    if (state) {
      synchronize(state);
      return;
    }
    const wrapper = document.createElement("span"),
      button = document.createElement("button"),
      text = document.createElement("span"),
      menu = document.createElement("div");
    wrapper.className = "custom-select";
    button.type = "button";
    button.className = "custom-select-trigger";
    button.role = "combobox";
    button.setAttribute("aria-haspopup", "listbox");
    button.setAttribute("aria-expanded", "false");
    const label =
      select.getAttribute("aria-label") ||
      [...(select.labels || [])]
        .map((l) =>
          [...l.childNodes]
            .filter((n) => n !== select)
            .map((n) => n.textContent)
            .join(" ")
            .trim(),
        )
        .join(" ") ||
      "Výběr";
    button.setAttribute("aria-label", label);
    menu.className = "custom-select-menu";
    menu.id = `custom-select-${++sequence}`;
    menu.role = "listbox";
    menu.setAttribute("aria-label", label);
    menu.hidden = true;
    button.setAttribute("aria-controls", menu.id);
    text.className = "custom-select-value";
    button.append(text);
    button.insertAdjacentHTML("beforeend", chevron);
    select.before(wrapper);
    wrapper.append(select, button);
    select.classList.add("custom-select-native");
    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");
    state = {
      select,
      wrapper,
      button,
      text,
      menu,
      index: select.selectedIndex,
      search: "",
      searchTime: 0,
    };
    states.set(select, state);
    synchronize(state);
    button.onclick = () => (active === state ? close() : open(state));
    button.onkeydown = (e) => {
      e.stopPropagation();
      const options = [...select.options]
        .map((o, i) => ({ o, i }))
        .filter(
          ({ o }) => !o.disabled && !o.hidden && !o.parentElement.disabled,
        );
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
        e.preventDefault();
        if (active !== state) {
          open(state);
          if (!["Home", "End"].includes(e.key)) return;
        }
        const at = options.findIndex(({ i }) => i === state.index),
          next =
            e.key === "Home"
              ? 0
              : e.key === "End"
                ? options.length - 1
                : (at + (e.key === "ArrowDown" ? 1 : -1) + options.length) %
                  options.length;
        if (options[next]) highlight(state, options[next].i);
      } else if (["Enter", " "].includes(e.key)) {
        e.preventDefault();
        active === state ? choose(state, state.index) : open(state);
      } else if (e.key === "Escape") {
        e.preventDefault();
        close(true);
      } else if (e.key === "Tab") close();
      else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        if (active !== state) open(state);
        const now = Date.now();
        state.search =
          now - state.searchTime > 700 ? e.key : state.search + e.key;
        state.searchTime = now;
        const match = options.find(({ o }) =>
          o.textContent
            .trim()
            .toLocaleLowerCase("cs")
            .startsWith(state.search.toLocaleLowerCase("cs")),
        );
        if (match) highlight(state, match.i);
      }
    };
  }
  function refresh() {
    if (active && !active.select.isConnected) {
      active.menu.remove();
      close();
    }
    document.querySelectorAll("select").forEach(enhance);
  }
  function install() {
    if (installed) return;
    installed = true;
    refresh();
    new MutationObserver((records) => {
      if (active && records.some((r) => active.select.contains(r.target)))
        close();
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        refresh();
      });
    }).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["disabled", "selected", "hidden", "value", "label"],
    });
    document.addEventListener(
      "change",
      (e) => {
        const state = states.get(e.target);
        if (state) synchronize(state);
      },
      true,
    );
    document.addEventListener("reset", () => queueMicrotask(refresh));
    document.addEventListener(
      "pointerdown",
      (e) => {
        if (
          active &&
          !active.wrapper.contains(e.target) &&
          !active.menu.contains(e.target)
        )
          close();
      },
      true,
    );
    document.addEventListener(
      "scroll",
      (e) => {
        if (active && !active.menu.contains(e.target)) close();
      },
      true,
    );
    document.addEventListener(
      "close",
      (e) => {
        if (active?.select.closest("dialog") === e.target) close();
      },
      true,
    );
    window.addEventListener("resize", () => close());
  }
  J.Dropdowns = { install, refresh, close };
})((globalThis.Joinery = globalThis.Joinery || {}));
