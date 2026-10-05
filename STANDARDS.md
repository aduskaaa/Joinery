# Výkresové konvence

Aplikace implementuje konkrétní výkresové konvence; nepokrývá celé soubory ISO, EN a ČSN. Normativní třídu nebo pevnost materiálu nelze určit pouze z jeho názvu či šrafování.

| Oblast                       | Použité nastavení                                                                                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ISO 129-1 / ČSN EN ISO 129-1 | Lineární a zarovnané kóty, vynášecí čáry s přesahem; šikmé úsečky, plné a otevřené šipky. Výchozí styl platí pro kóty bez vlastního nastavení.                                                          |
| ISO 3098-1                   | Volitelná výška kót 2,5 / 3,5 / 5 / 7 mm na papíře. PDF upravuje velikost písma podle skutečné výšky verzálek přibaleného Liberation Sans. Jde o běžné čitelné písmo, ne certifikované technické písmo. |
| ISO 128-2                    | Černobílý tisk; tenké čáry 0,25 mm, obrysy 0,5 mm, indikace ohranění 0,7 mm.                                                                                                                            |
| ISO 5455                     | Automatická redukční měřítka z řady 1, 2, 5.                                                                                                                                                            |
| ISO 7200                     | Datová pole razítka: název, identifikátor, autor, kontrola, datum, revize a list; doplněné materiálem, měřítkem, jednotkami a formátem. Rozložení buněk je zvolené pro tuto aplikaci.                   |

Zdroje: [ISO 129-1](https://www.iso.org/standard/64007.html), [ISO 3098-1](https://www.iso.org/standard/65679.html), [ISO 128-2](https://www.iso.org/standard/83355.html), [ISO 5455](https://www.iso.org/standard/11500.html), [ISO 7200](https://www.iso.org/standard/35446.html).

## Materiály v řezech

Masiv v příčném řezu používá tenké rovnoběžné čáry pod 45°, podélný řez čáry ve směru délky. Konstrukční desky používají čáry kolmé k ploše desky a písmenné označení. Krycí vrstvy lamina jsou vyznačeny uvnitř obrysu. Materiály se stejným šrafováním rozlišuje kód a popis.

| Výběr                        | Označení                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------- |
| Masiv – příčný / podélný řez | MAS; dřevinu doplňte v popisu. MAS je aplikační zkratka vysvětlená legendou. |
| DTD                          | DTD                                                                          |
| Sololit                      | DVD-T – tvrdá dřevovláknitá deska                                            |
| Lamino                       | DTD-L – laminovaná dřevotřísková deska; případný jiný nosič uveďte v popisu  |
| Sklo                         | SKLO; skupiny tří šikmých čar; druh skla a tloušťku uveďte v popisu          |

Šrafování se používá pro řez. Pro běžný pohled zvolte **Bez značení**. V každém PDF je legenda použitých materiálů. Značení je vektorové a respektuje skutečný obrys včetně otvorů. Rozteč na papíře se přizpůsobuje měřítku; u velmi složitých ploch je počet šraf omezen.

Podklad pro nábytkářské konvence a písmenné značky: [Nábytkářský informační systém – Zobrazování nábytku](https://www.n-i-s.cz/cz/zobrazovani-nabytku/page/592/). Obecné značení řezů a vysvětlení doplňkových značek: [VŠB – pravidla tvorby výkresů](https://otto.vsb.cz/~acad/studijni-materialy/ps1esf/pravidla-tvorby-vykresu.html), [náhled ČSN 01 3406:2015](https://csnonlinefirmy.agentura-cas.cz/html_nahledy/01/98479/98479_nahled.htm).

Starší EN / ČSN produktové třídy uložené v projektech se zachovají v metadatech a CSV. Nový jednoduchý výběr materiálu tyto třídy nepřiřazuje ani neověřuje.

## Výrobní údaje

Seskupení spojí objekty pro výběr a úpravy, nemění jejich geometrii. Pohledy na jeden dílec lze vyřadit z kusovníku při seskupení. Kusovník uvádí explicitní dílce i ručně vložené položky, rozměry polotovaru, počty, materiál a ohranění, a počítá spotřebu materiálu podle formátu velkoplošného materiálu a prořezu.

PDF ověřuje obálku výkresu včetně kót před exportem. Vlastní nastavení tolerance, geometrických tolerancí, uložení a drsnosti není součástí tohoto prototypu. DXF kóty nejsou nativní asociativní DIMENSION entity.
