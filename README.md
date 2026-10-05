# Joinery – truhlářský CAD

Statická 2D aplikace v HTML, CSS a JavaScriptu. Kreslení, výpočty, ukládání i export probíhají v prohlížeči. Není potřeba backend, instalace ani sestavení.

## Spuštění

Otevřete `index.html` přímo v prohlížeči. Skripty se načítají klasickými značkami `<script defer>`, takže aplikace funguje také přes `file://` bez chyby CORS.

Pro místní HTTP náhled:

```sh
python3 -m http.server 8080
```

Otevřete `http://localhost:8080/`. Na GitHub Pages lze publikovat celý adresář, nebo použít přiložený workflow `.github/workflows/pages.yml`. Cesty jsou relativní, takže funguje i umístění v podadresáři repozitáře.

## Rozhraní

- Nástroje jsou v horní liště. Vlastní nápověda zobrazí popis při najetí i při zaměření klávesnicí.
- Vzhled používá černou, bílou a odstíny šedé, s ostrými hranami.
- Nový výkres má jednu vrstvu **Vrstva 1**. Další vrstvy vytvoříte tlačítkem **+**. Název změníte ikonou úprav nebo dvojklikem. Výběr nástroje nemění aktivní vrstvu.
- Starší projekty si zachovají vlastní vrstvy, názvy, dílce a materiálová metadata.
- Vlastnosti vybraného objektu, vrstvy a dílce jsou v pravém panelu. Na úzkých telefonech je panel skrytý; úpravy dílců jsou určeny především pro počítač.

## Kreslení a navigace

| Funkce                       | Zkratka               |
| ---------------------------- | --------------------- |
| Výběr                        | V                     |
| Úsečka / lomená čára         | L / W                 |
| Obdélník / dílec             | R / P                 |
| Kružnice / oblouk třemi body | O / A                 |
| Otvor / drážka               | H / S                 |
| Kóta / text                  | D / T                 |
| Přesunout / kopírovat        | M / C                 |
| Booleovské operace           | B                     |
| Úpravy a truhlářské spoje    | E                     |
| Zpět / znovu                 | Z / Shift+Z           |
| Seskupit / rozdělit skupinu  | Ctrl+G / Ctrl+Shift+G |
| Zobrazit celý výkres         | F                     |
| Uložit projekt               | Ctrl+S / Cmd+S        |

Kolečko přibližuje v místě kurzoru. Prostřední tlačítko nebo mezerník s tažením posouvá pohled. Shift při kreslení vynutí pravoúhlý směr. Shift + kliknutí přidá objekt do výběru; Alt + kliknutí vybere jeden člen skupiny.

Pro přesnou úsečku určete začátek a směr, napište délku a potvrďte Enter. Lomenou čáru dokončí Enter; **K** uzavře obrys. **Esc** zruší nástroj, **Delete** odstraní výběr.

Rozměry nástrojů jsou v mm. Zobrazované jednotky lze přepnout. Rozteč přichycení změňte polem **Rozteč** dole v liště; podporuje desetinná čísla a ukládá se s projektem. Zobrazená mřížka se přizpůsobuje přiblížení nezávisle na této rozteči. Pravým tlačítkem na **MŘÍŽKA** nebo **OSNAP** otevřete volby přichycení: koncový bod, střed úsečky, střed, průsečík, kolmice a rovnoběžka.

## Dílce, materiály a kusovník

Dílec má šířku, výšku, tloušťku, počet kusů, popis materiálu a ohranění. **Druh materiálu / značení řezu** nabízí masiv v příčném nebo podélném řezu, DTD, sololit, lamino a sklo. Značení tvoří vektorové šrafy a materiálový kód. Šrafování se ořízne podle skutečného obrysu včetně otvorů a otáčí se s dílcem. Podrobnosti a zdroje jsou v [STANDARDS.md](STANDARDS.md).

Popis materiálu zůstává samostatně editovatelný pro dřevinu, dekor nebo dodavatele. Při prvním výběru druhu se doplní jeho název; vlastní popis se nepřepisuje. Zvolte **Bez značení**, pokud nejde o řez.

Kusovník uvádí zadané dílce z výkresu i ručně přidané položky. V kusovníku lze přímo přidávat, upravovat a mazat vlastní položky. Spotřeba materiálu se počítá na základě čisté plochy dílců, standardního formátu desek (2800 × 2070 mm) a 10% prořezu.

Ohranění přepíná 0 / 1 / 2 mm. Kódy stran: B dolní, R pravá, T horní, L levá, podle místních souřadnic dílce.

## Booleovské operace a úpravy

**B** otevře sjednocení, odečtení, průnik a vyloučený průnik. Vyberte uzavřené objekty, zkontrolujte náhled a potvrďte **Použít** nebo Enter. U odečítání je první objekt základ; lze jej změnit v seznamu a ponechat odečítané obrysy. Prázdný výsledek nezmění původní objekty. Z vrátí celou operaci.

Podporovány jsou dílce, obdélníky, uzavřené lomené čáry, kružnice, otvory, drážky a složené plochy. Výsledek uchová otvory i oddělené části. Kružnice a zaoblené drážky se aproximují s nastavitelnou tolerancí, výchozí 0,01 mm. Nejde o výpočet 3D kapes ani drah nástroje.

Odečtený dílec si ponechá rozměry polotovaru a výrobní údaje. Jinému výsledku lze přiřadit polotovar ve vlastnostech. Přesun, kopie, otočení, zrcadlení a pole zachovají otvory. Kopie skupin dostanou samostatná ID.

Nabídka **Úpravy** obsahuje také odsazení, oříznutí a prodloužení úseček, obdélníkové pole, poloměrovou kótu a truhlářské spoje. Odsazení mnohoúhelníků je určeno pro jednoduché konvexní obrysy. Spoje vytvářejí obráběcí obrys s hloubkou; rozměry polotovaru se zadávají samostatně.

## Kóty, razítko a PDF

V **Kótování** vyberte výšku textu na papíře: 2,5 / 3,5 / 5 / 7 mm. K dispozici jsou **šikmé úsečky**, **plné šipky** a **otevřené šipky**. Styl lze změnit i u konkrétní lineární kóty. Zachovává se měřený rozměr, kótovací čára i přesah vynášecích čar; stísněné kóty se odsadí, aby se jejich texty nepřekrývaly.

Postup: **Export → Výkres PDF → Upravit razítko → Zobrazit náhled → Stáhnout PDF**.

Razítko obsahuje organizaci, materiál, název a číslo výkresu, autora, kontrolu, datum, revizi, měřítko, jednotky, list a formát. Prázdný název, materiál a datum se doplní automaticky. Měřítko, formát a list určuje export. Vyplněná pole se ukládají s projektem.

Náhled používá stejné vektorové příkazy, písmo a rozvržení jako PDF; nepotřebuje vestavěný PDF prohlížeč. Otevření náhledu nic nestahuje. PDF je A3 nebo A4 na šířku. Automatické měřítko vybírá z řady 1:1, 1:2, 1:5, 1:10… Výkres, který se nevejde při zadaném měřítku, se neexportuje oříznutý. Tiskněte v měřítku **100 %**.

PDF obsahuje přibalené vektorové písmo Liberation Sans včetně české diakritiky. Dlouhé údaje v razítku se zalomí; text, který se nevejde ani do dvou řádků, vyžaduje zkrácení.

## Ukládání a export

Projekt se automaticky ukládá do LocalStorage daného prohlížeče a adresy. **Uložit projekt** vytvoří úplnou zálohu JSON včetně vrstev, nastavení, skupin, dílců a razítka. Otevření projektu lze vrátit pomocí Zpět.

Hlavní exportní nabídka obsahuje **PDF**, **DXF** a **projekt JSON**. **CSV** je přímo u kusovníku. Interní SVG a datový export kusovníku zůstávají dostupné modulům, bez dalších tlačítek v rozhraní.

DXF AC1015 obsahuje modelové obrysy, rozměry a metadata JOINERY pro vlastní zpětný import. Exportuje všechny vrstvy; PDF jen viditelné. Materiálové šrafy slouží výkresu a nepřidávají do DXF řezné čáry. Kóty jsou rozložené na čáry a texty. DXF import podporuje LINE, LWPOLYLINE, POLYLINE/VERTEX, CIRCLE, ARC, TEXT a MTEXT; nepodporuje bloky, spline, binární DXF ani 3D modely. Po úpravě geometrie v jiném CAD mohou původní metadata JOINERY vyžadovat odstranění.

## Struktura a ověření

`CanvasManager.js` spravuje pohled a vykreslování, `Geometry.js` geometrii a přichycení, `Tools.js` nástroje, `Model.js` projekt a historii, `Scene.js` společnou kresbu, `Hatching.js` šrafování, `Materials.js` materiály a `Woodworking.js` výrobní údaje a exporty. `PdfFont.js` a `PdfPreview.js` zajišťují český vektorový tisk a náhled; `Tooltips.js` vlastní nápovědu.

```sh
npm test
```

Testy prohlížeče v `tests/*-browser.mjs` a `tests/browser.mjs` používají Playwright pouze při vývoji. Aplikace samotná jej nepotřebuje. Lze nastavit `PLAYWRIGHT_MODULE` a `BASE_URL`, včetně adresy `file://`.

Přibalená knihovna polygon-clipping a písmo Liberation Sans mají licence v `src/vendor/`. Aplikace nic nenačítá z CDN.
