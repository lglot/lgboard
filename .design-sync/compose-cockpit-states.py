#!/usr/bin/env python3
"""Stack the captured cockpit overlays into one browsable page.

Sheet, panels and menus only exist while something is open, so the frozen page
shows none of them. Each state gets its own framed panel, labelled, on the real
stylesheet plus the plugin's own: everything a redesign has to account for,
visible at once.
"""
import json
import pathlib
import re

HERE = pathlib.Path(__file__).parent
STATES = json.loads((HERE.parent / "states-store.json").read_text(encoding="utf-8")) \
    if (HERE.parent / "states-store.json").exists() \
    else json.loads((pathlib.Path.home() / ".claude/skills/claude-design-sync/scripts/states-store.json").read_text(encoding="utf-8"))
CSS = pathlib.Path("/Users/luigilotito/code/homelab/lgboard/public/style.css").read_text(encoding="utf-8")
PLUGIN = pathlib.Path("/Users/luigilotito/code/homelab/lgboard/plugins/work-cockpit/ui.jsx").read_text(encoding="utf-8")
OUT = HERE / "Work Cockpit States.html"

# The plugin ships its stylesheet inside a template literal in the jsx: the
# frozen states are unstyled without it.
PLUGIN_CSS = re.search(r"const STYLE = `(.*?)`;", PLUGIN, re.S).group(1)

NOTES = {
    "Sheet dettaglio task": "Click su una card. Sorgenti con link, descrizione, progress con il done "
                            "e le PR mergiate, dettaglio, sessioni agente collassate, cronologia, "
                            "prompt di ripresa. Lo spostamento chiede conferma con un bottone.",
    "Pannello Collector": "Icona attivita' in header. Diagramma di dove legge il collector, "
                          "configurazione a runtime, i cinque prompt, storico esecuzioni, Run now.",
    "Legenda e sorgenti": "Icona info. Cosa significano i colori, i chip di urgenza, lo stato di ogni sorgente.",
    "Impostazioni": "Icona sliders. Layout, archivio, card compatte, banda urgenze, reset delle modifiche locali.",
    "Sheet, menu azioni distruttive": "Cestino rosso in alto nello sheet. Archive e Hide, che valgono solo qui.",
    "Vista per area": "Terza vista: ogni area con le sue tre lane, invece di tre colonne miste.",
    "Vista schede, lane Done": "Seconda vista: una lane per volta. Qui la lane Done, che si popola dalle "
                               "fonti e si svuota da sola dopo sette giorni.",
}

FRAME_CSS = """
body { background: var(--bg); margin: 0; padding: 32px clamp(16px, 4vw, 48px) 64px; }
.states-h { max-width: 1180px; margin: 0 auto 28px; }
.states-h h1 { font-family: var(--ff-display); font-weight: 500; font-size: 30px;
  letter-spacing: -0.03em; margin: 0 0 6px; }
.states-h p { color: var(--ink-soft); font-size: 13.5px; margin: 0; max-width: 74ch; line-height: 1.55; }
.state { max-width: 1180px; margin: 0 auto 40px; }
.state-label { display: flex; align-items: baseline; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
.state-label h2 { font-family: var(--ff-mono); text-transform: uppercase; font-size: 11px;
  letter-spacing: 0.1em; color: var(--ink); margin: 0; }
.state-label span { font-size: 12.5px; color: var(--ink-soft); max-width: 80ch; }
.state-frame { position: relative; min-height: 200px; overflow: visible;
  border: 1px solid var(--line); border-radius: var(--radius); background: var(--bg); padding: 18px; }
/* In the app these are fixed to the viewport; inside a frame they stay in their box. */
.state-frame .sheet, .state-frame .pane { position: relative; top: auto; left: auto;
  transform: none; margin: 0 auto; max-height: none; animation: none; }
.state-frame .sheet-menu { position: absolute; }
.state-frame .sheet-b, .state-frame .pane-b { overflow: visible; }
"""


def main():
    blocks = []
    for name, html in STATES.items():
        note = NOTES.get(name, "")
        blocks.append(f'<section class="state"><div class="state-label"><h2>{name}</h2>'
                      f'<span>{note}</span></div>'
                      f'<div class="state-frame wc-page">{html}</div></section>')
    page = f"""<!doctype html>
<!-- Captured from the running Work cockpit: every surface it can open, frozen in
     place with its real data. Static on purpose: no scripts, both stylesheets inlined. -->
<html lang="it" data-theme="ink" data-mode="light" data-density="comfortable">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Work Cockpit States</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
{CSS}
{PLUGIN_CSS}
{FRAME_CSS}
</style>
</head>
<body>
<div class="states-h">
  <h1>Work Cockpit States</h1>
  <p>Ogni superficie che il cockpit apre al click, catturata dalla pagina viva con i dati reali:
     ticket veri, sessioni vere, conteggi veri. La pagina congelata non le mostra, perche' esistono
     solo mentre qualcosa e' aperto.</p>
</div>
{"".join(blocks)}
</body>
</html>
"""
    OUT.write_text(page, encoding="utf-8")
    print(f"{OUT.name}: {len(page) // 1024} KB, {len(STATES)} stati")


if __name__ == "__main__":
    main()
