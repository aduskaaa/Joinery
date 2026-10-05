/** Translate internal validation diagnostics without changing the file schema. */
(function (J) {
  "use strict";
  const messages = {
    "This is not a Joinery v1 project.":
      "Soubor není projektem Joinery verze 1.",
    "Project exceeds the prototype limit (20,000 objects / 100 layers).":
      "Projekt překračuje limit 20 000 objektů nebo 100 vrstev.",
    "Invalid layer.": "Neplatná vrstva.",
    "A project needs at least one layer.":
      "Projekt musí mít alespoň jednu vrstvu.",
    "Invalid object or layer reference.":
      "Objekt odkazuje na neplatnou vrstvu nebo má neplatné ID.",
    "Unknown material class. Use a catalogue class or custom/unclassified material.":
      "Neznámá uložená třída materiálu.",
    "Invalid drawing group.": "Neplatná skupina objektů.",
    "Invalid group name.": "Neplatný název skupiny.",
    "Invalid physical-part flag.": "Neplatné zařazení dílce do kusovníku.",
    "Invalid region polygon.": "Neplatná plocha.",
    "Invalid region contour.": "Neplatný obrys plochy.",
    "Degenerate region contour.": "Obrys plochy nemá platnou geometrii.",
    "Boolean region exceeds 50,000 vertices.":
      "Plocha překračuje limit 50 000 vrcholů.",
    "A region part requires its stock rectangle.":
      "Dílec musí mít určený obdélník polotovaru.",
    "Invalid stock rectangle.": "Neplatný obdélník polotovaru.",
    "Invalid region part specification.": "Neplatné údaje obrobeného dílce.",
    "Stock vertices must form a rectangle.":
      "Vrcholové body polotovaru musí tvořit obdélník.",
    "Invalid circle geometry.": "Neplatná kružnice.",
    "Invalid arc angles.": "Neplatné úhly oblouku.",
    "Invalid vertex geometry.": "Neplatné souřadnice vrcholů.",
    "Rectangles need exactly four vertices.":
      "Obdélník musí mít čtyři vrcholy.",
    "Invalid panel specification.": "Neplatné rozměry nebo údaje dílce.",
    "Panel vertices must form a rectangle.":
      "Vrcholové body dílce musí tvořit obdélník.",
    "Invalid slot width.": "Neplatná šířka drážky.",
    "Invalid text annotation.": "Neplatný textový popis.",
    "Invalid object name.": "Neplatný název objektu.",
    "Invalid cut depth.": "Neplatná hloubka obrábění.",
    "Invalid dimension mode.": "Neplatný typ kóty.",
    "A closed contour needs at least three distinct vertices.":
      "Uzavřený obrys potřebuje alespoň tři různé vrcholy.",
    "Boolean contours are too complex; simplify them before combining.":
      "Obrysy jsou příliš složité. Před operací je zjednodušte.",
    "Contour retraces an edge. Repair it before applying a Boolean operation.":
      "Obrys vede dvakrát po stejné hraně. Nejprve jej opravte.",
    "Contour crosses or touches itself. Repair it before applying a Boolean operation.":
      "Obrys protíná sám sebe nebo se dotýká. Nejprve jej opravte.",
    "Contour has zero area. Boolean tools need closed shapes with area.":
      "Obrys má nulovou plochu. Použijte uzavřený obrys s plochou.",
    "Region polygons must be an array of polygons and rings.":
      "Neplatná struktura ploch a otvorů.",
    "Each polygon needs an outer contour.":
      "Každá plocha potřebuje vnější obrys.",
    "A hole contour must remain inside its outer contour.":
      "Otvor musí zůstat uvnitř vnějšího obrysu.",
    "Hole contours may touch but cannot overlap or nest.":
      "Obrysy otvorů se nesmí překrývat ani vnořovat.",
    "Circle radius and slot width must be finite and positive.":
      "Poloměr kružnice i šířka drážky musí být kladné.",
    "Curve is too large for this tolerance; increase the Boolean curve tolerance.":
      "Křivka je pro danou toleranci příliš velká. Zvyšte toleranci oblouků.",
    "A slot needs two centerline endpoints.":
      "Drážka potřebuje dva koncové body střednice.",
    "The local polygon clipping library has not loaded. Reload the page.":
      "Knihovna booleovských operací se nenačetla. Obnovte stránku.",
    "Boolean result is too complex; simplify the operands or increase the curve tolerance.":
      "Výsledek je příliš složitý. Zjednodušte obrysy nebo zvyšte toleranci oblouků.",
    "Miter exceeds panel dimensions.": "Pokos přesahuje rozměry dílce.",
    "Use positive dimensions and a depth no greater than panel thickness.":
      "Zadejte kladné rozměry a hloubku nejvýše rovnou tloušťce dílce.",
    "This joint does not fit inside the panel.": "Spoj se nevejde do dílce.",
    "Tenon exceeds the panel width.": "Čep přesahuje šířku dílce.",
    "No supported 2D geometry found in this DXF.":
      "DXF neobsahuje podporovanou 2D geometrii.",
    "Invalid PDF scale.": "Neplatné měřítko PDF.",
    "Drawing exceeds the chosen sheet at this scale. Use Fit or a smaller scale.":
      "Výkres se v tomto měřítku nevejde na formát. Zvolte automatické nebo menší měřítko.",
  };
  function message(value) {
    const s = String(value);
    if (messages[s]) return messages[s];
    if (s.startsWith("Boolean geometry could not be resolved:"))
      return "Booleovskou geometrii nelze vyhodnotit. Zkontrolujte obrysy.";
    if (
      s.startsWith("Unexpected token") ||
      s.startsWith("Expected ") ||
      s.startsWith("Unterminated")
    )
      return "Soubor obsahuje neplatný zápis JSON.";
    return s;
  }
  J.Errors = { message };
})((globalThis.Joinery = globalThis.Joinery || {}));
