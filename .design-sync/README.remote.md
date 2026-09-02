# lgserver-dashboard — cosa c'è in questo progetto

Due tipi di file, che servono a cose diverse.

## Mockup editabili

| File | Cos'è |
|---|---|
| `Home Server Dashboard.html` | Il mockup vivo della home: React da CDN, Babel nel browser, si appoggia a `components.jsx`, `icons.jsx`, `themes.jsx`. È il file da modificare quando si ridisegna. |
| `Work Cockpit.html` | La vista Work cockpit, statica ma con dati veri. |

## Fotografie della dashboard vera

Congelate dall'istanza live (`lgserver`, tema chiaro), script rimossi e CSS inlinato: si aprono ovunque, non chiamano nessuna API, e mostrano esattamente ciò che gira oggi.

| File | Cos'è |
|---|---|
| `Home Server Dashboard (live).html` | La home come appare adesso: host reali con le tab, stats vere, servizi con il loro stato (alcuni down), sezioni con i contatori. |
| `Dashboard States.html` | Tutte le superfici che la home apre al click, che una pagina congelata non mostrerebbe: i due drawer sotto le stats (container, storage), i modali dei plugin (Automazioni, Stato host), "Aggiungi servizio", il pannello Tweaks, la palette comandi. Ognuna in un riquadro etichettato, con una riga che dice da dove si apre. |
| `Work Cockpit (live).html` | Il Work cockpit come gira il 5 agosto 2026: 68 card reali, cinque lane, chrome in inglese. È questo, non `Work Cockpit.html`, a dire com'è fatta la vista oggi. |
| `Work Cockpit States.html` | Le sette superfici che il cockpit apre al click: sheet di dettaglio, pannello Collector, legenda, impostazioni, menu del cestino, vista per area, vista a schede con la lane Done. |

> Le fotografie della **home** sono ferme al 3 agosto 2026, quelle del **cockpit** sono del 5 agosto.

## Sorgenti di riferimento (`repo/`)

Copie dal repository vero (`github.com/lglot/lgboard`), messe qui perché il design system si legga dal codice invece che dedurlo. **Non usarli per far girare i mockup**: chiamano le API della dashboard, che qui non esistono.

Allineati al commit `49f6feb` del 5 agosto 2026. Si aggiornano dal repo, mai da qui: la mappa locale è in `.design-sync/push.json`.

| File | Cos'è |
|---|---|
| `repo/style.css` | Il foglio di stile che ship: token, componenti, media query. La fonte di verità. |
| `repo/components.jsx` | La UI: `Dashboard`, tile, stats, drawer, modali, launcher dei plugin. |
| `repo/icons.jsx` | Icone SVG inline e il resolver che sceglie l'icona di un servizio. |
| `repo/themes.jsx` | Definizione dei temi e applicazione delle variabili CSS. |
| `repo/plugin-work-cockpit.jsx` | La UI del plugin Work cockpit, così com'è implementata. |

## Vincoli da rispettare in qualunque redesign

- **Nessun build step.** Un solo file per superficie, React e Babel da CDN, CSS in un template string. Niente dipendenze, niente Tailwind, niente librerie di icone: SVG inline.
- **Nessun colore fuori dai token.** L'accento è commutabile su una dozzina di temi, alcuni dei quali sovrascrivono anche le superfici (Nord, Dracula, Gruvbox, Tokyo Night...). Un design appeso a una tinta specifica si rompe nella maggior parte di essi.
- **Tema chiaro** come riferimento: è quello in uso. Deve reggere anche in scuro.
- **Le etichette italiane restano** come sono nella home. Il chrome del Work cockpit è passato all'inglese: lì si resta in inglese.
