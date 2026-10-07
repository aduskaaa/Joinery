/** Accessible application tooltips; no native OS title bubbles. */
(function (J) {
  "use strict";
  const descriptions = {
    select:
      "Kliknutím vyberete objekt. Shift přidá další, Alt vybere člen skupiny.",
    line: "Vyberte začátek a konec. Délku lze zadat číslem; Shift vynutí kolmý směr.",
    polyline: "Kreslí spojené úsečky. Enter dokončí, K uzavře obrys.",
    rectangle: "Vyberte protilehlé rohy nebo zadejte přesnou šířku a výšku.",
    panel: "Vytvoří dílec s rozměry, tloušťkou a materiálem pro kusovník.",
    circle: "Vyberte střed a poloměr. Poloměr lze zadat číslem.",
    arc: "Oblouk určíte třemi body: začátek, průchozí bod, konec.",
    slot: "Vyberte středy konců drážky a nastavte její šířku.",
    drill: "Umístí otvor podle zvoleného průměru a hloubky vrtání.",
    dimension:
      "Vyberte dva body a polohu kóty. Styl nastavíte ve vlastnostech výkresu.",
    angle: "Vyberte vrchol úhlu a body na obou ramenech.",
    text: "Umístí text zadaný ve spodní liště.",
    move: "Přesune výběr podle základního a cílového bodu.",
    copy: "Vytvoří nezávislou kopii výběru; skupiny zůstanou pohromadě.",
    mirror:
      "Zrcadlí výběr podle osy určené dvěma body. Původní objekty lze ponechat nebo nahradit.",
    trim: "Klikněte na úsek úsečky, lomené čáry, oblouku nebo kružnice, který chcete odstranit. Hranice dalších objektů určují místo oříznutí.",
    rotate:
      "Otočí výběr kolem zvoleného středu. Úhel lze zadat ve spodní liště.",
    join: "Spojí vybrané hrany nebo uzavřené tvary do jednoho obrysu. Uzavření a toleranci nastavíte ve spodní liště.",
    boolean:
      "Sjednocení, odečtení a průnik uzavřených ploch s náhledem výsledku.",
    edit: "Otočení, zrcadlení, odsazení, pole, seskupení a truhlářské spoje.",
  };
  function install() {
    const bubble = document.createElement("div");
    bubble.id = "tool-tooltip";
    bubble.className = "tool-tooltip";
    bubble.role = "tooltip";
    bubble.hidden = true;
    document.body.append(bubble);
    let target = null,
      timer = null;
    function convert(root) {
      const list = [...root.querySelectorAll("[title]")];
      if (root.nodeType === 1 && root.hasAttribute("title")) list.push(root);
      for (const e of list) {
        e.dataset.tooltip = e.getAttribute("title");
        e.removeAttribute("title");
      }
    }
    convert(document);
    new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === "attributes") convert(r.target);
        else for (const n of r.addedNodes) if (n.nodeType === 1) convert(n);
      }
    }).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["title"],
    });
    function hide() {
      clearTimeout(timer);
      if (target) target.removeAttribute("aria-describedby");
      target = null;
      bubble.hidden = true;
    }
    function delayedShow(e) {
      const element = e.target.closest?.("[data-tooltip]");
      if (!element || element.disabled || element === target) return;
      hide();
      timer = setTimeout(() => show(element), 500);
    }
    function show(element) {
      if (!element || element.disabled) return hide();
      target = element;
      bubble.replaceChildren();
      const heading = document.createElement("strong");
      heading.textContent = element.dataset.tooltip;
      bubble.append(heading);
      const description =
        descriptions[element.dataset.tool] ||
        J.ToolSystem?.ToolSystem.hints[element.dataset.tool];
      if (description) {
        const p = document.createElement("p");
        p.textContent = description;
        bubble.append(p);
      }
      bubble.hidden = false;
      element.setAttribute("aria-describedby", bubble.id);
      const r = element.getBoundingClientRect(),
        w = bubble.offsetWidth,
        h = bubble.offsetHeight;
      bubble.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left))}px`;
      bubble.style.top = `${r.bottom + h + 12 < innerHeight ? r.bottom + 8 : Math.max(8, r.top - h - 8)}px`;
    }
    document.addEventListener("pointerover", delayedShow);
    document.addEventListener("focusin", delayedShow);
    document.addEventListener("pointerout", (e) => {
      const element = e.target.closest?.("[data-tooltip]");
      if (element && e.relatedTarget && element.contains(e.relatedTarget))
        return;
      hide();
    });
    document.addEventListener("focusout", hide);
    document.addEventListener("pointerdown", hide);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") hide();
    });
    window.addEventListener("resize", hide);
    document.addEventListener("scroll", hide, true);
  }
  J.Tooltips = { install };
})((globalThis.Joinery = globalThis.Joinery || {}));
