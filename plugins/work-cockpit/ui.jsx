// Work cockpit plugin - UI.
//
// One view of everything Luigi is working on: Jira and Zammad for A-Cube,
// Linear for Homelab and Personal, plus the Claude Code / Codex sessions open
// right now. Four lanes (Prossimi, Ora, In attesa, Archivio), every card links
// back to its original source.
//
// The collector on the Mac unifies the sources, so one task = one card even
// when it exists in Jira and Zammad at once; the card lists every source it
// was built from, so a wrong merge stays visible instead of hiding work.
//
// The snapshot is read-only: moving, editing, archiving or deleting a card
// writes a local override in localStorage and never travels back to Jira,
// Linear or Zammad. Overridden cards say so, and the overrides can be dropped
// in one click from the settings pane.
//
// Full-screen view, not a modal: deep-linkable as <dashboard>/#work-cockpit.
//
// Contract (see lgboard public/components.jsx):
//   window.__lgboardPlugins["work-cockpit"] = { id, useSignal, Surface }

(function () {
  const { useState, useEffect, useCallback, useMemo, useRef } = React;

  const HASH = "#work-cockpit";
  // The chrome is in English, the cards keep whatever language their source
  // wrote: a Zammad title stays Italian because that is what the ticket says.
  const AREAS = [
    ["a-cube", "A-Cube", "client work · jira + zammad"],
    ["personal", "Personal", "linear + agent sessions"],
    ["homelab", "Homelab", "agent sessions + notes"],
  ];
  // Lane order is the reading order: what is queued, what you are on, what is
  // stuck elsewhere. 'arch' exists only as a local override.
  const LANES = [
    ["next", "Queued", "not started yet"],
    ["now", "On now", "in progress"],
    ["waiting", "Waiting", "on someone else"],
  ];
  const ARCH = ["arch", "Archive", "parked by hand"];
  const ALL_LANES = LANES.concat([ARCH]);
  const LANE_NAME = Object.fromEntries(ALL_LANES.map(([k, label]) => [k, label]));
  const AREA_NAME = Object.fromEntries(AREAS.map(([k, label]) => [k, label]));
  const EMPTY_LANE = {
    next: "Nothing queued here.",
    now: "Nothing in progress here.",
    waiting: "Nobody owes you anything here.",
    arch: "Archive is empty.",
  };
  const OV_KEY = "work-cockpit.overrides.v1";
  const PREF_KEY = "work-cockpit.prefs.v1";
  const DUE_HORIZON_D = 60;  // further out than this, a deadline is not yet actionable
  const DUE_FORGET_D = 60;   // overdue this long means the date is stale, not urgent
  const SOURCE_LABEL = {
    jira: "jira", linear: "linear", zammad: "zammad", agents: "agent sessions",
    pr: "pull requests", llm: "grouping", detail: "summaries", due: "deadlines", push: "publish",
    mail: "mail", slack: "slack", prOpen: "open PRs", triage: "triage", inbox: "inbox on the board",
  };

  const readJson = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (e) { return fallback; }
  };
  const writeJson = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ }
  };

  const STYLE = `
  .wc-page { position: fixed; inset: 0; z-index: 60; overflow: auto; background: var(--bg);
    --sev-due: var(--idle); --sev-reply: var(--wait, oklch(58% 0.17 300)); --sev-stalled: var(--down); }
  .wc-page .page { max-width: 1500px; margin: 0 auto; padding: 30px clamp(16px, 3.5vw, 40px) 48px; }
  .wc-page .hidden { display: none !important; }

  .wc-page .head { display: flex; align-items: center; gap: 16px; padding-bottom: 20px; }
  .wc-page .head-icn { width: 46px; height: 46px; flex: none; border-radius: 13px; display: flex;
    align-items: center; justify-content: center; background: var(--accent-soft); color: var(--accent);
    border: 1px solid color-mix(in oklab, var(--accent) 20%, transparent); }
  .wc-page .head-t { flex: 1; min-width: 0; }
  .wc-page .head-t h1 { margin: 0; font-family: var(--ff-display); font-weight: 500; font-size: 28px;
    letter-spacing: -0.025em; }
  .wc-page .head-t .sub { font-family: var(--ff-mono); font-size: 12px; color: var(--ink-soft); margin-top: 4px; }
  .wc-page .head-a { display: flex; gap: 8px; flex: none; }
  .wc-page .iconbtn { width: 38px; height: 38px; border-radius: 50%; background: var(--bg-elev);
    border: 1px solid var(--line); color: var(--ink-mid); display: inline-flex; align-items: center;
    justify-content: center; cursor: pointer; transition: color 120ms, border-color 120ms; }
  .wc-page .iconbtn:hover { color: var(--accent); border-color: color-mix(in oklab, var(--accent) 40%, var(--line)); }

  .wc-page .banner { margin: 18px 0 0; padding: 11px 14px; border-radius: 11px; font-size: 13px;
    border: 1px solid color-mix(in oklab, var(--idle) 55%, var(--line));
    background: color-mix(in oklab, var(--idle) 9%, transparent); color: var(--ink); }
  .wc-page .banner.err { border-color: color-mix(in oklab, var(--down) 55%, var(--line));
    background: color-mix(in oklab, var(--down) 8%, transparent); color: var(--down); }

  /* resume strip: one line to pick up where you stopped */
  .wc-page .top { margin: 22px 0 0; }
  .wc-page .hero { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: center; gap: 4px 20px; width: 100%; padding: 15px 18px 15px 20px; text-align: left;
    font-family: var(--ff-ui); color: var(--ink); background: var(--bg-elev); border: 1px solid var(--line);
    border-left: 3px solid var(--accent); border-radius: 14px; box-shadow: var(--shadow-1); cursor: pointer;
    -webkit-tap-highlight-color: transparent; transition: border-color 160ms, box-shadow 160ms; }
  .wc-page .hero:hover { box-shadow: var(--shadow-2);
    border-color: color-mix(in oklab, var(--accent) 35%, var(--line)); border-left-color: var(--accent); }
  .wc-page .hero:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .wc-page .hero-k { grid-column: 1; display: inline-flex; align-items: center; gap: 7px;
    font-family: var(--ff-mono); font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.14em;
    color: var(--accent); }
  .wc-page .hero-k i { width: 6px; height: 6px; border-radius: 50%; background: var(--accent);
    animation: wc-beat 2.2s ease-in-out infinite; }
  .wc-page .hero-t { grid-column: 1; grid-row: 2; font-family: var(--ff-display);
    font-size: clamp(18px, 1.9vw, 23px); font-weight: 500; letter-spacing: -0.025em; line-height: 1.2;
    margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .wc-page .hero-b { grid-column: 1; grid-row: 3; display: flex; align-items: center; gap: 6px 10px;
    flex-wrap: wrap; margin-top: 5px; font-family: var(--ff-mono); font-size: 10.5px; color: var(--ink-soft); }
  .wc-page .hero-area { text-transform: uppercase; letter-spacing: 0.08em; }
  .wc-page .hero-m { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .wc-page .hero-sep { color: color-mix(in oklab, var(--ink-soft) 65%, var(--line)); }
  .wc-page .hero-stale { color: var(--ink-soft); border: 1px solid var(--line); border-radius: 999px;
    padding: 1px 7px 2px; }
  .wc-page .hero-when { grid-column: 2; grid-row: 1 / 4; display: flex; flex-direction: column;
    align-items: flex-end; justify-content: center; }
  .wc-page .hero-when b { font-family: var(--ff-display); font-size: 24px; font-weight: 500;
    letter-spacing: -0.03em; line-height: 1; color: var(--ink); font-variant-numeric: tabular-nums; }
  .wc-page .hero-when em { font-style: normal; font-family: var(--ff-mono); font-size: 9px;
    text-transform: uppercase; letter-spacing: 0.11em; color: var(--ink-soft); margin-top: 5px; }
  .wc-page .hero-go { grid-column: 3; grid-row: 1 / 4; width: 32px; height: 32px; border-radius: 50%;
    display: inline-flex; align-items: center; justify-content: center; color: var(--accent);
    background: var(--accent-soft); transition: transform 140ms; }
  .wc-page .hero:hover .hero-go { transform: translateX(2px); }
  @keyframes wc-beat { 0%, 100% { opacity: 1; } 50% { opacity: 0.28; } }

  /* prima di tutto: one card per thing somebody is waiting on */
  .wc-page .urg { margin: 20px 0 0; }
  .wc-page .urg-h { display: flex; align-items: center; gap: 12px; padding-bottom: 10px;
    font-family: var(--ff-mono); font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.13em;
    color: var(--ink-soft); }
  .wc-page .urg-h::after { content: ""; flex: 1; height: 1px; background: var(--line); }
  .wc-page .urg-h .n { font-family: var(--ff-display); font-size: 12px; letter-spacing: 0; color: var(--ink-mid); }
  .wc-page .urg-l { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
  .wc-page .urow { display: flex; flex-direction: column; align-items: stretch; gap: 8px;
    padding: 13px 15px 14px; background: var(--bg-elev); border: 1px solid var(--line); border-radius: 13px;
    box-shadow: var(--shadow-1); text-align: left; font: inherit; color: inherit; cursor: pointer;
    --sev: var(--sev-reply); transition: border-color 140ms, box-shadow 140ms, transform 140ms; }
  .wc-page .urow:hover { border-color: color-mix(in oklab, var(--sev) 40%, var(--line));
    box-shadow: var(--shadow-2); transform: translateY(-1px); }
  .wc-page .urow:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .wc-page .urow[data-sev="due"] { --sev: var(--sev-due); }
  .wc-page .urow[data-sev="stalled"] { --sev: var(--sev-stalled); }
  .wc-page .urow-top { display: flex; align-items: center; gap: 8px; }
  .wc-page .urow-chip { display: inline-flex; align-items: center; gap: 6px; font-family: var(--ff-mono);
    font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--sev); }
  .wc-page .urow-chip i { width: 6px; height: 6px; border-radius: 50%; background: var(--sev); flex: none; }
  .wc-page .urow-w { margin-left: auto; font-family: var(--ff-display); font-size: 19px; font-weight: 500;
    line-height: 1; letter-spacing: -0.03em; color: var(--sev); font-variant-numeric: tabular-nums; }
  .wc-page .urow-t { font-size: 13.5px; line-height: 1.35; letter-spacing: -0.01em; text-wrap: pretty;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .wc-page .urow-m { font-family: var(--ff-mono); font-size: 10px; line-height: 1.4; color: var(--ink-soft);
    margin-top: auto; }
  .wc-page .urg-none { padding: 14px 15px; background: var(--bg-elev); border: 1px solid var(--line);
    border-radius: 13px; font-family: var(--ff-mono); font-size: 11.5px; color: var(--ink-soft); }

  /* toolbar: search + area filter + view switch */
  .wc-page .toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 18px 0 0; }
  .wc-page .search { display: flex; align-items: center; gap: 9px; flex: 1 1 260px; min-width: 170px;
    max-width: 400px; height: 40px; padding: 0 9px 0 12px; background: var(--bg-elev);
    border: 1px solid var(--line); border-radius: 11px; transition: border-color 120ms, box-shadow 120ms; }
  .wc-page .search:focus-within { border-color: color-mix(in oklab, var(--accent) 45%, var(--line));
    box-shadow: 0 0 0 3px var(--accent-softer); }
  .wc-page .search > svg { color: var(--ink-soft); flex: none; }
  .wc-page .search input { flex: 1; min-width: 0; border: none; background: none; outline: none;
    font-family: var(--ff-ui); font-size: 13.5px; letter-spacing: -0.005em; color: var(--ink); }
  .wc-page .search input::placeholder { color: var(--ink-soft); }
  .wc-page .search input::-webkit-search-cancel-button { -webkit-appearance: none; display: none; }
  .wc-page .q-k { font-family: var(--ff-mono); font-size: 10px; color: var(--ink-soft);
    border: 1px solid var(--line); border-radius: 5px; padding: 0 5px; flex: none; }
  .wc-page .search:focus-within .q-k { display: none; }
  .wc-page .q-x { border: none; background: none; color: var(--ink-soft); cursor: pointer; padding: 3px;
    display: inline-flex; flex: none; }
  .wc-page .q-x:hover { color: var(--ink); }
  .wc-page .filter { display: flex; gap: 4px; padding: 4px; background: var(--line-2); border-radius: 11px;
    flex: none; }
  .wc-page .filter button { background: transparent; border: none; cursor: pointer;
    font-family: var(--ff-ui); font-size: 13.5px; color: var(--ink-mid); padding: 8px 15px;
    border-radius: 8px; display: inline-flex; align-items: baseline; gap: 8px; }
  .wc-page .filter button em { font-style: normal; font-family: var(--ff-mono); font-size: 11px;
    color: var(--ink-soft); }
  .wc-page .filter button.on { background: var(--bg-elev); color: var(--ink); box-shadow: var(--shadow-1); }
  .wc-page .filter button.on em { color: var(--accent); }
  .wc-page .viewseg { display: flex; gap: 2px; padding: 3px; background: var(--line-2); border-radius: 10px;
    margin-left: auto; }
  .wc-page .viewseg button { display: inline-flex; align-items: center; gap: 6px; border: none;
    background: none; cursor: pointer; padding: 7px 11px; border-radius: 7px; font-family: var(--ff-mono);
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--ink-soft); }
  .wc-page .viewseg button.on { background: var(--bg-elev); color: var(--ink); box-shadow: var(--shadow-1); }
  .wc-page .lanetabs { display: flex; gap: 4px; padding: 4px; background: var(--line-2); border-radius: 11px;
    margin: 12px 0 0; width: fit-content; }
  .wc-page .lanetabs button { background: none; border: none; cursor: pointer; font-family: var(--ff-ui);
    font-size: 13.5px; color: var(--ink-mid); padding: 8px 15px; border-radius: 8px;
    display: inline-flex; align-items: baseline; gap: 8px; }
  .wc-page .lanetabs button em { font-style: normal; font-family: var(--ff-mono); font-size: 11px;
    color: var(--ink-soft); }
  .wc-page .lanetabs button.on { background: var(--bg-elev); color: var(--ink); box-shadow: var(--shadow-1); }
  .wc-page .lanetabs button.on em { color: var(--accent); }

  /* board: one lane per state, cards stay big enough to read */
  .wc-page .board { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px;
    margin-top: 22px; align-items: start; }
  .wc-page[data-view="tabs"] .board, .wc-page[data-view="areas"] .board { grid-template-columns: 1fr; }
  .wc-page[data-view="areas"] .board { margin-top: 16px; }
  .wc-page .lane { border: 1px solid var(--line); border-radius: 16px;
    background: color-mix(in oklab, var(--ink) 1.5%, var(--bg)); overflow: hidden; }
  .wc-page .lane.over { border-color: color-mix(in oklab, var(--accent) 55%, var(--line));
    background: var(--accent-softer); }
  .wc-page .lane-h { display: flex; align-items: center; gap: 10px; padding: 16px 18px 14px;
    border-bottom: 1px solid var(--line); background: var(--bg-elev); }
  .wc-page .lane-h h2 { margin: 0; font-family: var(--ff-ui); font-weight: 500; font-size: 13px;
    text-transform: uppercase; letter-spacing: 0.11em; }
  .wc-page .lane-h .n { font-family: var(--ff-display); font-size: 22px; font-weight: 500;
    letter-spacing: -0.02em; line-height: 1; margin-left: auto; font-variant-numeric: tabular-nums; }
  .wc-page .lane-h .what { font-family: var(--ff-mono); font-size: 10px; color: var(--ink-soft); }
  .wc-page .lane.now .lane-h { background: color-mix(in oklab, var(--accent) 5%, var(--bg-elev)); }
  .wc-page .lane.now .lane-h h2, .wc-page .lane.now .lane-h .n { color: var(--accent); }
  .wc-page .lane.waiting .lane-h { background: color-mix(in oklab, var(--sev-reply) 7%, var(--bg-elev)); }
  .wc-page .lane.waiting .lane-h h2, .wc-page .lane.waiting .lane-h .n { color: var(--sev-reply); }
  .wc-page .stack { display: flex; flex-direction: column; gap: 10px; padding: 14px; }
  .wc-page.dense .stack { gap: 7px; padding: 10px; }
  .wc-page.dense .c-h { padding: 10px 12px; gap: 7px; }
  .wc-page.dense .c-t { font-size: 13.5px; }
  .wc-page[data-view="tabs"] .lane .stack, .wc-page .lane.arch .stack {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)); align-items: start; }
  .wc-page[data-view="tabs"] .more, .wc-page[data-view="tabs"] .empty,
  .wc-page .lane.arch .more, .wc-page .lane.arch .empty { grid-column: 1 / -1; }

  /* archive lane: full width under the board, collapsible */
  .wc-page .lane.arch .lane-h { background: var(--bg-elev); cursor: pointer; }
  .wc-page .lane.arch .lane-h h2, .wc-page .lane.arch .lane-h .n { color: var(--ink-mid); }
  .wc-page .lane-tog { width: 26px; height: 26px; margin-left: -4px; border: none; background: none;
    color: var(--ink-soft); cursor: pointer; display: inline-flex; align-items: center;
    justify-content: center; flex: none; }
  .wc-page .lane-tog svg { transition: transform 160ms ease; }
  .wc-page .lane.closed .lane-tog svg { transform: rotate(-90deg); }

  .wc-page .card { position: relative; background: var(--bg-elev); border: 1px solid var(--line);
    border-radius: 12px; box-shadow: var(--shadow-1); cursor: pointer;
    -webkit-tap-highlight-color: transparent; transition: border-color 150ms, box-shadow 150ms, transform 150ms; }
  .wc-page .card:hover { border-color: color-mix(in oklab, var(--accent) 40%, var(--line));
    box-shadow: var(--shadow-2); }
  .wc-page .card:active { transform: scale(0.995); }
  .wc-page .card:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .wc-page .card.stale { border-left: 3px solid var(--down); }
  .wc-page .card.live { border-left: 3px solid var(--up); }
  .wc-page .card.archived { opacity: 0.72; border-left: none; }
  .wc-page .card.archived:hover { opacity: 1; }
  .wc-page .card.dragging { opacity: 0.4; }
  .wc-page .card.just { animation: wc-justmoved 800ms ease; }
  @keyframes wc-justmoved { 0% { box-shadow: 0 0 0 3px var(--accent-soft); } 100% { box-shadow: var(--shadow-1); } }
  .wc-page .c-h { padding: 14px 15px; display: flex; flex-direction: column; gap: 9px; }
  .wc-page .c-t { font-size: 15.5px; font-weight: 500; line-height: 1.35; letter-spacing: -0.01em;
    text-wrap: pretty; padding-right: 24px; }
  .wc-page .c-m { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .wc-page .tag { font-family: var(--ff-mono); font-size: 10px; text-transform: uppercase;
    letter-spacing: 0.07em; color: var(--ink-soft); border: 1px solid var(--line); border-radius: 999px;
    padding: 2px 7px; white-space: nowrap; }
  .wc-page .tag.id { color: var(--ink-mid); }
  .wc-page .tag.warn { color: var(--sev-reply); border-color: color-mix(in oklab, var(--sev-reply) 40%, var(--line)); }
  .wc-page .tag.bad { color: var(--down); border-color: color-mix(in oklab, var(--down) 42%, var(--line)); }
  .wc-page .tag.due { color: var(--sev-due); border-color: color-mix(in oklab, var(--sev-due) 45%, var(--line)); }
  .wc-page .tag.local { color: var(--accent); border-color: color-mix(in oklab, var(--accent) 40%, var(--line)); }
  .wc-page .c-age { margin-left: auto; font-family: var(--ff-mono); font-size: 12px; color: var(--ink-mid);
    font-variant-numeric: tabular-nums; white-space: nowrap; }
  .wc-page .c-act { position: absolute; top: 7px; right: 7px; width: 26px; height: 26px; border-radius: 7px;
    border: none; background: none; color: var(--ink-soft); display: inline-flex; align-items: center;
    justify-content: center; cursor: pointer; opacity: 0; transition: opacity 120ms, background 120ms, color 120ms; }
  .wc-page .card:hover .c-act, .wc-page .c-act:focus-visible { opacity: 1; }
  .wc-page .c-act:hover { background: var(--line-2); color: var(--ink); }
  @media (hover: none) { .wc-page .c-act { opacity: 1; } }
  .wc-page .more { font-family: var(--ff-mono); font-size: 11px; color: var(--ink-soft); padding: 4px 4px 2px; }
  .wc-page .empty { font-size: 13.5px; color: var(--ink-soft); padding: 18px 4px; text-align: center; }

  /* by area: every area with its own three lanes */
  .wc-page .areas { display: flex; flex-direction: column; gap: 16px; margin-top: 22px; }
  .wc-page .agrp { border: 1px solid var(--line); border-radius: 16px;
    background: color-mix(in oklab, var(--ink) 1.5%, var(--bg)); overflow: hidden; }
  .wc-page .agrp-h { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 15px 18px 13px;
    border-bottom: 1px solid var(--line); background: var(--bg-elev); }
  .wc-page .agrp-h h2 { margin: 0; font-family: var(--ff-display); font-size: 17px; font-weight: 500;
    letter-spacing: -0.02em; }
  .wc-page .agrp-h .what { font-family: var(--ff-mono); font-size: 10px; color: var(--ink-soft); }
  .wc-page .agrp-n { margin-left: auto; font-family: var(--ff-display); font-size: 20px; font-weight: 500;
    line-height: 1; color: var(--ink-mid); font-variant-numeric: tabular-nums; }
  .wc-page .agrp-b { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px;
    padding: 14px; align-items: start; }
  .wc-page .abox { min-width: 0; }
  .wc-page .abox-h { display: flex; align-items: baseline; gap: 8px; padding: 2px 2px 9px;
    font-family: var(--ff-ui); font-size: 11px; text-transform: uppercase; letter-spacing: 0.11em;
    color: var(--ink-soft); }
  .wc-page .abox-h em { font-style: normal; font-family: var(--ff-mono); font-size: 11px; color: var(--ink-mid); }
  .wc-page .abox.now .abox-h { color: var(--accent); }
  .wc-page .abox.waiting .abox-h { color: var(--sev-reply); }
  .wc-page .abox .stack { display: flex; flex-direction: column; gap: 9px; padding: 0; min-height: 40px; }
  .wc-page .abox.over .stack { outline: 1px dashed color-mix(in oklab, var(--accent) 55%, var(--line));
    outline-offset: 5px; border-radius: 10px; }
  .wc-page .abox.void .stack::after { content: "-"; font-family: var(--ff-mono); font-size: 12px;
    color: var(--ink-soft); padding: 4px 2px; }

  .wc-page .foot { margin-top: 26px; display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center;
    font-family: var(--ff-mono); font-size: 11.5px; color: var(--ink-soft); }
  .wc-page .foot .btn { margin-left: auto; }
  .wc-page .src { display: inline-flex; align-items: center; gap: 6px; }
  .wc-page .src i { width: 7px; height: 7px; border-radius: 50%; background: var(--up); }
  .wc-page .src.cached i, .wc-page .src.skipped i { background: var(--idle); }
  .wc-page .src.error i, .wc-page .src.unavailable i { background: var(--down); }

  /* card menu, toast */
  .wc-page .menu { position: fixed; z-index: 80; width: 186px; padding: 6px; background: var(--bg-elev);
    border: 1px solid var(--line); border-radius: 12px; box-shadow: var(--shadow-2); }
  .wc-page .menu-k { font-family: var(--ff-mono); font-size: 9px; text-transform: uppercase;
    letter-spacing: 0.1em; color: var(--ink-soft); padding: 6px 8px 4px; }
  .wc-page .menu button { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left;
    border: none; background: none; cursor: pointer; padding: 7px 8px; border-radius: 7px;
    font-family: var(--ff-ui); font-size: 13px; color: var(--ink-mid); }
  .wc-page .menu button:hover { background: var(--line-2); color: var(--ink); }
  .wc-page .menu button.on { color: var(--accent); }
  .wc-page .menu button.on::after { content: "✓"; margin-left: auto; font-size: 11px; }
  .wc-page .menu button.danger:hover { color: var(--down); }
  .wc-page .menu-sep { height: 1px; background: var(--line); margin: 5px 4px; }
  .wc-page .toast { position: fixed; z-index: 90; left: 50%; bottom: 22px; transform: translateX(-50%);
    display: flex; align-items: center; gap: 14px; padding: 11px 14px 11px 16px; background: var(--ink);
    color: var(--bg-elev); border-radius: 12px; box-shadow: var(--shadow-2); font-size: 13.5px;
    animation: wc-pop2 160ms ease; }
  .wc-page .toast button { border: none; background: none;
    color: color-mix(in oklab, var(--accent) 55%, white); font-family: var(--ff-mono); font-size: 11px;
    text-transform: uppercase; letter-spacing: 0.08em; cursor: pointer; }
  @keyframes wc-pop2 { from { opacity: 0; transform: translate(-50%, 8px); } to { opacity: 1; transform: translate(-50%, 0); } }

  /* sheet + panes */
  .wc-page .scrim { position: fixed; inset: 0; z-index: 70; background: oklch(22% 0.02 260 / 0.42);
    backdrop-filter: blur(3px); animation: wc-fade 140ms ease; }
  .wc-page .sheet, .wc-page .pane { position: fixed; z-index: 71; top: 50%; left: 50%;
    transform: translate(-50%, -50%); width: min(660px, 94vw); max-height: 88vh; display: flex;
    flex-direction: column; background: var(--bg-elev); border: 1px solid var(--line); border-radius: 20px;
    box-shadow: 0 40px 90px -34px oklch(20% 0.02 260 / 0.5); overflow: hidden;
    animation: wc-pop 190ms cubic-bezier(0.2, 0.9, 0.3, 1); }
  .wc-page .pane { width: min(600px, 94vw); }
  .wc-page .sheet-h { position: relative; padding: 22px 24px 18px; border-bottom: 1px solid var(--line); }
  .wc-page .sheet-k { font-family: var(--ff-mono); font-size: 10px; text-transform: uppercase;
    letter-spacing: 0.13em; color: var(--accent); }
  .wc-page .sheet[data-lane="waiting"] .sheet-k { color: var(--sev-reply); }
  .wc-page .sheet[data-lane="next"] .sheet-k, .wc-page .sheet[data-lane="arch"] .sheet-k { color: var(--ink-soft); }
  .wc-page .sheet-t { margin: 9px 0 0; font-family: var(--ff-display); font-size: clamp(20px, 2.6vw, 27px);
    font-weight: 500; letter-spacing: -0.025em; line-height: 1.24; padding-right: 42px; text-wrap: pretty; }
  .wc-page .sheet-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 13px; }
  .wc-page .sheet-x { position: absolute; top: 18px; right: 18px; width: 34px; height: 34px;
    border-radius: 50%; border: 1px solid var(--line); background: var(--bg-elev); color: var(--ink-mid);
    display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
  .wc-page .sheet-x:hover { color: var(--accent); border-color: color-mix(in oklab, var(--accent) 40%, var(--line)); }
  .wc-page .sheet-b, .wc-page .pane-b { overflow-y: auto; -webkit-overflow-scrolling: touch;
    padding: 20px 24px 24px; display: flex; flex-direction: column; gap: 22px; }
  .wc-page .sheet-b h3, .wc-page .pane-b section > h3 { margin: 0 0 9px; font-family: var(--ff-mono);
    font-size: 9.5px; font-weight: 400; text-transform: uppercase; letter-spacing: 0.11em; color: var(--ink-soft); }
  .wc-page .sheet-desc { margin: 0; font-size: 14.5px; line-height: 1.6; color: var(--ink-mid); text-wrap: pretty; }
  .wc-page .sheet dl { margin: 0; display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 6px 12px; }
  .wc-page .sheet dt { font-family: var(--ff-mono); text-transform: uppercase; font-size: 9.5px;
    letter-spacing: 0.09em; color: var(--ink-soft); padding-top: 3px; }
  .wc-page .sheet dd { margin: 0; font-size: 13.5px; }
  .wc-page .sheet dd.mono { font-family: var(--ff-mono); font-size: 12px; word-break: break-all; }
  .wc-page .cmd { display: flex; align-items: center; gap: 10px; margin-top: 12px; padding: 8px 11px;
    border: 1px solid var(--line); border-radius: 9px; background: var(--bg); font-family: var(--ff-mono);
    font-size: 11.5px; }
  .wc-page .cmd span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .wc-page .cmd button { margin-left: auto; border: none; background: none; color: var(--accent);
    font-family: var(--ff-mono); font-size: 11px; cursor: pointer; flex: none; }
  .wc-page .log { list-style: none; margin: 0; padding: 0; }
  .wc-page .log li { position: relative; display: grid; grid-template-columns: 12px minmax(0, 1fr);
    gap: 14px; padding-bottom: 16px; }
  .wc-page .log li:last-child { padding-bottom: 0; }
  .wc-page .log li::before { content: ""; position: absolute; left: 5px; top: 14px; bottom: 0; width: 1px;
    background: var(--line); }
  .wc-page .log li:last-child::before { display: none; }
  .wc-page .log i { width: 11px; height: 11px; border-radius: 50%; margin-top: 4px;
    border: 2px solid color-mix(in oklab, var(--accent) 35%, var(--line)); background: var(--bg-elev); }
  .wc-page .log li:last-child i { border-color: var(--accent); background: var(--accent); }
  .wc-page .log time { display: block; font-family: var(--ff-mono); font-size: 10.5px;
    text-transform: uppercase; letter-spacing: 0.07em; color: var(--ink-soft); }
  .wc-page .log span { display: block; font-size: 13.5px; line-height: 1.5; margin-top: 3px; text-wrap: pretty; }
  .wc-page .prompt-sec > h3 { display: flex; align-items: center; gap: 10px; }
  .wc-page .disc { display: inline-flex; align-items: center; gap: 7px; border: none; background: none;
    padding: 0; cursor: pointer; color: inherit; font: inherit; letter-spacing: inherit; text-transform: inherit; }
  .wc-page .disc:hover { color: var(--accent); }
  .wc-page .disc svg { flex: none; transition: transform 160ms ease; }
  .wc-page .disc.open svg { transform: rotate(90deg); }
  .wc-page .p-copy { margin-left: auto; display: inline-flex; align-items: center; gap: 6px;
    border: 1px solid var(--line); background: var(--bg-elev); color: var(--ink-mid); border-radius: 7px;
    padding: 5px 10px; font-family: var(--ff-mono); font-size: 10px; text-transform: uppercase;
    letter-spacing: 0.08em; cursor: pointer; transition: color 140ms, border-color 140ms; }
  .wc-page .p-copy:hover { color: var(--accent); border-color: color-mix(in oklab, var(--accent) 40%, var(--line)); }
  .wc-page .p-copy.done { color: var(--up); border-color: color-mix(in oklab, var(--up) 45%, var(--line)); }
  .wc-page .pbox { margin: 0; padding: 15px 16px; max-height: 236px; overflow: auto;
    background: oklch(26% 0.014 260); color: oklch(93% 0.008 250); border-radius: 12px;
    font-family: var(--ff-mono); font-size: 11.5px; line-height: 1.72; white-space: pre-wrap;
    word-break: break-word; tab-size: 2; }
  .wc-page .sheet-f, .wc-page .pane-f { border-top: 1px solid var(--line); background: var(--bg);
    padding: 13px 24px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
    font-family: var(--ff-mono); font-size: 11.5px; color: var(--ink-soft); }
  .wc-page .sheet-acts { margin-left: auto; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .wc-page .sheet-acts button, .wc-page .btn { border: 1px solid var(--line); background: var(--bg-elev);
    color: var(--ink-mid); border-radius: 8px; padding: 7px 13px; font-family: var(--ff-ui);
    font-size: 13px; cursor: pointer; }
  .wc-page .sheet-acts button:hover, .wc-page .btn:hover { color: var(--accent);
    border-color: color-mix(in oklab, var(--accent) 40%, var(--line)); }
  .wc-page .sheet-acts button.danger:hover { color: var(--down);
    border-color: color-mix(in oklab, var(--down) 40%, var(--line)); }
  .wc-page .sheet-acts button.primary, .wc-page .btn.primary { background: var(--ink);
    color: var(--bg-elev); border-color: var(--ink); }
  .wc-page .sheet-acts button.primary:hover, .wc-page .btn.primary:hover { background: var(--accent);
    border-color: var(--accent); color: var(--bg-elev); }
  .wc-page .seg { display: flex; border: 1px solid var(--line); border-radius: 9px; overflow: hidden;
    background: var(--bg-elev); }
  .wc-page .seg button { flex: 1; min-width: 0; padding: 9px 6px; border: none;
    border-right: 1px solid var(--line); background: none; cursor: pointer; font-family: var(--ff-mono);
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-soft);
    white-space: nowrap; }
  .wc-page .seg button:last-child { border-right: none; }
  .wc-page .seg button.on { background: color-mix(in oklab, var(--accent) 12%, var(--bg-elev)); color: var(--accent); }
  .wc-page .edit-t, .wc-page .edit-d { width: 100%; font-family: inherit; color: var(--ink);
    background: var(--bg); border: 1px solid color-mix(in oklab, var(--accent) 45%, var(--line));
    border-radius: 9px; padding: 8px 10px; }
  .wc-page .edit-t { font-family: var(--ff-display); font-size: 20px; font-weight: 500; letter-spacing: -0.02em; }
  .wc-page .edit-d { font-size: 14px; line-height: 1.6; min-height: 92px; resize: vertical; }
  .wc-page .local-note { font-family: var(--ff-mono); font-size: 10.5px; color: var(--ink-soft);
    margin-top: 8px; line-height: 1.5; }

  .wc-page .pane-h { display: flex; align-items: center; gap: 12px; padding: 18px 20px 16px;
    border-bottom: 1px solid var(--line); }
  .wc-page .pane-h h2 { margin: 0; font-family: var(--ff-display); font-size: 19px; font-weight: 500;
    letter-spacing: -0.02em; }
  .wc-page .pane-h .sub { font-family: var(--ff-mono); font-size: 10px; color: var(--ink-soft); }
  .wc-page .pane-x { margin-left: auto; width: 32px; height: 32px; flex: none; border-radius: 50%;
    border: 1px solid var(--line); background: var(--bg-elev); color: var(--ink-mid);
    display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
  .wc-page .pane-x:hover { color: var(--accent); border-color: color-mix(in oklab, var(--accent) 40%, var(--line)); }
  .wc-page .pane-f .go { margin-left: auto; }
  .wc-page .legend { display: flex; flex-direction: column; gap: 2px; }
  .wc-page .lg { display: grid; grid-template-columns: 22px minmax(0, 1fr); align-items: center;
    gap: 0 12px; padding: 8px 0; border-top: 1px solid var(--line-2); }
  .wc-page .legend .lg:first-child { border-top: none; }
  .wc-page .lg-bar { width: 4px; margin: 0 auto; height: 20px; border-radius: 2px; }
  .wc-page .lg-dot { width: 10px; height: 10px; border-radius: 50%; margin: 0 auto; }
  .wc-page .lg-b { min-width: 0; }
  .wc-page .lg-b b { display: block; font-weight: 400; font-size: 13.5px; letter-spacing: -0.01em; }
  .wc-page .lg-b span { display: block; font-family: var(--ff-mono); font-size: 10.5px; line-height: 1.5;
    color: var(--ink-soft); margin-top: 2px; }
  .wc-page .srcs { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 158px), 1fr)); gap: 8px; }
  .wc-page .srcs .src { display: flex; align-items: center; gap: 8px; padding: 9px 11px;
    border: 1px solid var(--line); border-radius: 10px; font-family: var(--ff-mono); font-size: 11px;
    color: var(--ink-mid); }
  .wc-page .srcs .src b { margin-left: auto; font-weight: 400; color: var(--ink);
    font-variant-numeric: tabular-nums; }
  .wc-page .rows { display: flex; flex-direction: column; }
  .wc-page .row { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; padding: 11px 0;
    border-top: 1px solid var(--line-2); }
  .wc-page .rows .row:first-child { border-top: none; }
  .wc-page .row-b { flex: 1; min-width: 140px; }
  .wc-page .row-b b { display: block; font-weight: 400; font-size: 13.5px; letter-spacing: -0.01em; }
  .wc-page .row-b span { display: block; font-family: var(--ff-mono); font-size: 10px; color: var(--ink-soft);
    margin-top: 2px; }
  .wc-page .row .seg { flex: none; width: auto; min-width: 158px; }
  .wc-page .row .seg button { padding: 8px 11px; }
  .wc-page .tog { position: relative; flex: none; width: 40px; height: 23px; border-radius: 999px;
    border: 1px solid var(--line); background: var(--line-2); cursor: pointer; padding: 0;
    transition: background 140ms, border-color 140ms; }
  .wc-page .tog::after { content: ""; position: absolute; top: 2px; left: 2px; width: 17px; height: 17px;
    border-radius: 50%; background: var(--bg-elev); box-shadow: var(--shadow-1);
    transition: transform 160ms cubic-bezier(0.2, 0.9, 0.3, 1); }
  .wc-page .tog.on { background: var(--accent); border-color: var(--accent); }
  .wc-page .tog.on::after { transform: translateX(17px); }
  @keyframes wc-fade { from { opacity: 0 } to { opacity: 1 } }
  @keyframes wc-pop { from { opacity: 0; transform: translate(-50%, calc(-50% + 10px)) scale(0.98) }
    to { opacity: 1; transform: translate(-50%, -50%) scale(1) } }
  @keyframes wc-rise { from { transform: translateY(100%) } to { transform: none } }

  @media (max-width: 1180px) { .wc-page .urg-l { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 1080px) { .wc-page .board { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 860px) {
    .wc-page .board { grid-template-columns: 1fr; }
    .wc-page .agrp-b { grid-template-columns: 1fr; gap: 16px; }
  }
  @media (max-width: 720px) {
    .wc-page .page { padding: 20px 16px 40px; }
    .wc-page .head { gap: 12px; padding-bottom: 14px; }
    .wc-page .head-icn { width: 40px; height: 40px; border-radius: 11px; }
    .wc-page .head-t h1 { font-size: 23px; }
    .wc-page .hero { grid-template-columns: minmax(0, 1fr) auto; gap: 2px 14px; padding: 14px 15px 14px 16px; }
    .wc-page .hero-t { font-size: clamp(19px, 5vw, 23px); white-space: normal; display: -webkit-box;
      -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .wc-page .hero-when { flex-direction: row; align-items: baseline; gap: 9px; }
    .wc-page .hero-when b { font-size: 24px; }
    .wc-page .hero-when em { margin-top: 0; }
    .wc-page .hero-go { display: none; }
    .wc-page .urg-l { grid-template-columns: 1fr; gap: 10px; }
    .wc-page .search { order: -1; flex: 1 1 100%; max-width: none; }
    .wc-page .viewseg { margin-left: 0; }
    .wc-page .filter, .wc-page .lanetabs { width: auto; flex-wrap: nowrap; overflow-x: auto;
      scrollbar-width: none; }
    .wc-page .filter::-webkit-scrollbar, .wc-page .lanetabs::-webkit-scrollbar { display: none; }
    .wc-page .filter button, .wc-page .lanetabs button { flex: none; padding: 9px 13px; }
    .wc-page .sheet-acts { width: 100%; margin-left: 0; }
    .wc-page .sheet-acts button { flex: 1; text-align: center; justify-content: center; }
  }
  @media (max-width: 640px) {
    .wc-page .sheet, .wc-page .pane { top: auto; bottom: 0; left: 0; transform: none; width: 100%;
      max-height: 92vh; border-radius: 20px 20px 0 0; border-bottom: none;
      animation: wc-rise 240ms cubic-bezier(0.2, 0.9, 0.3, 1); }
    .wc-page .sheet-h { padding: 20px 18px 16px; }
    .wc-page .sheet-b, .wc-page .pane-b { padding: 18px 18px 22px; gap: 20px; }
    .wc-page .sheet-f, .wc-page .pane-f { padding: 12px 18px calc(12px + env(safe-area-inset-bottom)); }
    .wc-page .sheet-x { top: 15px; right: 15px; }
    .wc-page .sheet dl { grid-template-columns: 78px minmax(0, 1fr); }
    .wc-page .seg button { padding: 10px 4px; font-size: 9.5px; }
  }
  `;

  // --- time -----------------------------------------------------------------
  const DAY = 86400000;

  const age = (ms, now) => {
    if (!ms) return "no date";
    const m = Math.max(0, Math.round((now - ms) / 60000));
    if (m < 2) return "just now";
    if (m < 60) return `${m}m ago`;
    if (m < 1440) return `${Math.round(m / 60)}h ago`;
    return `${Math.round(m / 1440)}d ago`;
  };

  const shortAge = (ms, now) => {
    if (!ms) return "no date";
    const m = Math.max(0, Math.round((now - ms) / 60000));
    if (m < 2) return "now";
    if (m < 60) return `${m}m`;
    if (m < 1440) return `${Math.round(m / 60)}h`;
    return `${Math.round(m / 1440)}d`;
  };

  const daysSince = (ms, now) => (ms ? Math.floor((now - ms) / DAY) : 0);
  const daysUntil = (ms, now) => Math.ceil((ms - now) / DAY);
  const hours = ms => (ms >= 3600000 ? `${(ms / 3600000).toFixed(1)}h` : `${Math.round(ms / 60000)}m`);

  const dueLabel = (at, now) => {
    const days = daysUntil(at, now);
    if (days < 0) return `${-days}d overdue`;
    if (days === 0) return "due today";
    return `${days}d left`;
  };

  // --- overrides ------------------------------------------------------------
  // Everything the snapshot cannot own: a lane moved by hand, a title or a
  // description rewritten, an archived or deleted card. They live in this
  // browser only and never reach Jira, Linear or Zammad.
  function useOverrides() {
    const [overrides, setOverrides] = useState(() => readJson(OV_KEY, {}));
    const patch = useCallback((id, values) => {
      setOverrides(prev => {
        const merged = Object.assign({}, prev[id], values);
        Object.keys(merged).forEach(k => (merged[k] === null || merged[k] === undefined) && delete merged[k]);
        const next = Object.assign({}, prev);
        if (Object.keys(merged).length) next[id] = merged; else delete next[id];
        writeJson(OV_KEY, next);
        return next;
      });
    }, []);
    const clear = useCallback(() => { writeJson(OV_KEY, {}); setOverrides({}); }, []);
    return [overrides, patch, clear];
  }

  const applyOverride = (task, ov) => (ov ? Object.assign({}, task, {
    column: ov.column || task.column,
    title: ov.title || task.title,
    localDesc: ov.desc || "",
    local: true,
  }) : task);

  // --- derived views --------------------------------------------------------
  function urgencyOf(task, now) {
    if (task.column === "arch") return null;
    if (task.due && task.due.at) {
      const days = daysUntil(task.due.at, now);
      if (days <= DUE_HORIZON_D && days >= -DUE_FORGET_D) {
        return { sev: "due", chip: days < 0 ? "overdue" : "deadline", weight: 10000 - days,
                 big: `${Math.abs(days)}d`,
                 // The reason comes from the collector, in whatever language it wrote it.
                 why: task.due.why || "a date decides this one" };
      }
    }
    // Without a date there is nothing to be late about: a task the source gave
    // no timestamp for must not read as idle since forever.
    if (!task.updatedAt) return null;
    const idle = daysSince(task.updatedAt, now);
    if (task.column === "now" && task.stale) {
      return { sev: "stalled", chip: "stalled", weight: 5000 + idle, big: `${idle}d`,
               why: "In progress and nobody moving it. Needs a decision, not work." };
    }
    if (task.column === "waiting" && task.stale) {
      return { sev: "reply", chip: "no reply", weight: 1000 + idle, big: `${idle}d`,
               why: "You asked, nobody answered. The number is the silence." };
    }
    return null;
  }

  function backlog(task, now) {
    const rows = [];
    (task.agents || []).forEach(a => rows.push({
      at: a.updatedAt,
      when: shortAge(a.updatedAt, now),
      what: `${a.agent}: ${a.title || a.label || "session"}${a.branch ? ` on ${a.branch}` : ""}`
        + (a.runs > 1 ? ` (${a.runs} sessions)` : ""),
    }));
    (task.prs || []).forEach(pr => rows.push({
      at: task.updatedAt,
      when: `PR #${pr.number}`,
      what: (pr.decision || pr.state || "open").toLowerCase()
        + (pr.checksFailed && pr.checksFailed.length ? `, CI red on ${pr.checksFailed.join(", ")}` : "")
        + ((pr.reviews || []).length ? `, ${pr.reviews.length} reviews` : ""),
    }));
    // The three summaries are written by the collector: the label is ours, the
    // sentence is whatever language it came in.
    const detail = task.detail || {};
    if (detail.done) rows.push({ at: task.updatedAt + 1, when: "done", what: detail.done });
    if (detail.todo) rows.push({ at: task.updatedAt + 2, when: "missing", what: detail.todo });
    if (detail.next) rows.push({ at: task.updatedAt + 3, when: "next step", what: detail.next });
    if (!rows.length) rows.push({ at: task.updatedAt, when: shortAge(task.updatedAt, now),
                                  what: "Last movement recorded by the source." });
    return rows.sort((a, b) => (a.at || 0) - (b.at || 0));
  }

  function resumePrompt(task, now, extraDesc) {
    const refs = task.sources.map(s => s.label).join(", ");
    const detail = task.detail || {};
    const rows = backlog(task, now);
    const resume = (task.agents || []).map(a => a.resume).filter(Boolean)[0];
    // The scaffolding is English like the rest of the chrome; the values keep
    // the language the sources wrote them in.
    return [
      "Resume this task with me. Read it first, then tell me the next concrete step before you touch anything.",
      "",
      `TASK: ${task.title}`,
      `STATE: ${LANE_NAME[task.column]} · area ${AREA_NAME[task.area] || task.area} · updated ${age(task.updatedAt, now)}`,
      refs ? `REFS: ${refs}` : "",
      task.due && task.due.at ? `DEADLINE: ${dueLabel(task.due.at, now)}${task.due.why ? ` (${task.due.why})` : ""}` : "",
      "",
      "CONTEXT",
      extraDesc || detail.done || task.note || "No description recorded.",
      detail.todo ? `\nMISSING\n${detail.todo}` : "",
      "",
      "BACKLOG",
      rows.map(r => `- ${r.when}: ${r.what}`).join("\n"),
      resume ? `\nRESUME WITH\n${resume}` : "",
      "",
      "Start by confirming what is already done, then propose the next step.",
    ].filter(line => line !== "").join("\n");
  }

  // --- small pieces ---------------------------------------------------------
  function Copyable({ text }) {
    const [done, setDone] = useState(false);
    const copy = e => {
      e.stopPropagation();
      if (!navigator.clipboard) return;
      navigator.clipboard.writeText(text).then(() => {
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }, () => {});
    };
    return (
      <div className="cmd">
        <span>{text}</span>
        <button onClick={copy}>{done ? "copied" : "copy"}</button>
      </div>
    );
  }

  const Dots = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" />
    </svg>
  );

  const InfoGlyph = () => (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
         strokeLinecap="round">
      <circle cx="12" cy="12" r="9" /><path d="M12 11v5.5" />
      <circle cx="12" cy="7.8" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );

  function Card({ task, now, onOpen, onMenu, onDrag, dragging }) {
    const live = (task.agents || []).length > 0 && task.column !== "arch";
    const pr = (task.prs || [])[0];
    const due = task.due && task.due.at ? daysUntil(task.due.at, now) : null;
    const classes = ["card", live ? "live" : "", task.stale ? "stale" : "",
                     task.column === "arch" ? "archived" : "", dragging ? "dragging" : ""];
    return (
      <article
        className={classes.filter(Boolean).join(" ")}
        role="button" tabIndex={0} draggable
        onClick={() => onOpen(task)}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(task); } }}
        onDragStart={e => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", task.id); onDrag(task.id); }}
        onDragEnd={() => onDrag(null)}
      >
        <button className="c-act" type="button" aria-label="Task actions"
                onClick={e => { e.stopPropagation(); onMenu(e.currentTarget, task); }}>
          <Dots />
        </button>
        <div className="c-h">
          <span className="c-t">{task.title}</span>
          <span className="c-m">
            {task.sources.map(s => (
              <span className={`tag ${s.source === "agent" ? "" : "id"}`} key={`${s.source}-${s.label}`}>{s.label}</span>
            ))}
            {due !== null && <span className="tag due">{due < 0 ? `${-due}d overdue` : `${due}d left`}</span>}
            {task.stale && <span className="tag bad">{task.stale}</span>}
            {pr && (
              <span className={`tag ${pr.checksFailed && pr.checksFailed.length ? "bad" : "warn"}`}>
                PR #{pr.number}
              </span>
            )}
            {task.local && <span className="tag local">local</span>}
            <span className="c-age">{shortAge(task.updatedAt, now)}</span>
          </span>
        </div>
      </article>
    );
  }

  function Stack({ tasks, lane, now, card, hidden }) {
    return (
      <div className="stack">
        {tasks.map(t => card(t))}
        {!tasks.length && <div className="empty">{EMPTY_LANE[lane]}</div>}
        {hidden > 0 && <div className="more">+{hidden} hidden by the filter</div>}
      </div>
    );
  }

  function Lane({ lane, label, what, tasks, now, card, drop, over, collapsed, onToggle }) {
    const head = (
      <div className="lane-h" onClick={onToggle}>
        {onToggle && (
          <button className="lane-tog" type="button" aria-label="Toggle archive">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
          </button>
        )}
        <h2>{label}</h2>
        <span className="what">{what}</span>
        <span className="n">{tasks.length}</span>
      </div>
    );
    return (
      <section
        className={`lane ${lane}${over ? " over" : ""}${collapsed ? " closed" : ""}`}
        onDragOver={e => drop.over(e, lane)}
        onDragLeave={e => drop.leave(e, lane)}
        onDrop={e => drop.drop(e, lane)}
      >
        {head}
        {!collapsed && <Stack tasks={tasks} lane={lane} now={now} card={card} hidden={0} />}
      </section>
    );
  }

  // --- panes ----------------------------------------------------------------
  function Pane({ title, sub, foot, onClose, children }) {
    useEffect(() => {
      const esc = e => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
      window.addEventListener("keydown", esc, true);
      return () => window.removeEventListener("keydown", esc, true);
    }, [onClose]);
    return (
      <>
        <div className="scrim" onClick={onClose} />
        <div className="pane" role="dialog" aria-modal="true" aria-label={title}>
          <header className="pane-h">
            <h2>{title}</h2>
            {sub && <span className="sub">{sub}</span>}
            <button className="pane-x" type="button" aria-label="Close" onClick={onClose}>
              <Icons.close size={14} />
            </button>
          </header>
          <div className="pane-b">{children}</div>
          <footer className="pane-f">
            {foot}
            <button className="btn go" type="button" onClick={onClose}>Close</button>
          </footer>
        </div>
      </>
    );
  }

  const LEGEND = [
    ["bar", "var(--up)", "Green edge: live", "An agent session is open on it right now."],
    ["bar", "var(--down)", "Red edge: stale", "Nothing has moved on it for more than 7 days."],
    ["dot", "var(--accent)", "Accent: On now", "Claimed as in progress: the work you are actually doing."],
    ["dot", "var(--sev-reply)", "Violet: Waiting", "Somebody else owes you something. Not your move."],
    ["dot", "var(--ink-soft)", "Neutral: Queued", "Agreed but not started. No age pressure yet."],
    ["dot", "var(--line)", "Dim: Archive", "Parked by hand, in this browser only."],
    ["dot", "var(--ink-mid)", "mail, slack, PR chips", "Work picked out of a message, not off a ticket."],
  ];
  const URG_LEGEND = [
    ["var(--sev-due)", "deadline", "A date decides it: certificates, filings, agreed cut-offs."],
    ["var(--sev-reply)", "no reply", "You asked, nobody answered. The number is the silence."],
    ["var(--sev-stalled)", "stalled", "In progress with no activity. Needs a decision, not work."],
  ];

  function InfoPane({ doc, total, now, onClose }) {
    return (
      <Pane title="Legend and sources" onClose={onClose}
            foot={<span>read {age(doc && doc.generatedAt, now)} · {total} items in the snapshot</span>}>
        <section>
          <h3>What the colours mean</h3>
          <div className="legend">
            {LEGEND.map(([kind, color, title, body]) => (
              <div className="lg" key={title}>
                <span className={kind === "bar" ? "lg-bar" : "lg-dot"} style={{ background: color }} />
                <span className="lg-b"><b>{title}</b><span>{body}</span></span>
              </div>
            ))}
          </div>
        </section>
        <section>
          <h3>Urgency chips</h3>
          <div className="legend">
            {URG_LEGEND.map(([color, title, body]) => (
              <div className="lg" key={title}>
                <span className="lg-dot" style={{ background: color }} />
                <span className="lg-b"><b>{title}</b><span>{body}</span></span>
              </div>
            ))}
          </div>
        </section>
        <section>
          <h3>Sources</h3>
          <div className="srcs">
            {Object.entries((doc && doc.sources) || {}).map(([key, status]) => (
              <span className={`src ${status.status}`} key={key}>
                <i />{SOURCE_LABEL[key] || key}
                <b>{status.count != null ? status.count : status.status}</b>
              </span>
            ))}
          </div>
        </section>
        <section>
          <h3>Where this comes from</h3>
          <p className="local-note">
            The collector runs on the Mac and folds Jira, Zammad, Linear and the open Claude Code and
            Codex sessions into one file. The dashboard only reads it: no credential lives here, and
            nothing changed on this page travels back to the sources.
          </p>
          <p className="local-note">
            Mail, Slack and pull requests do not all get in. Only sender, subject and date are looked
            at, and one LLM pass keeps what still looks like open work. Those alone are read in full
            and attached to the task they belong to, or turned into a new card. A verdict lasts a
            month, so the same mail is never judged twice.
            {doc && doc.tokens && doc.tokens.calls > 0 && (
              ` Last run: ${doc.tokens.calls} calls, ${(doc.tokens.in + doc.tokens.out).toLocaleString("en")} tokens${doc.tokens.exact ? "" : " (estimated)"}.`
            )}
          </p>
        </section>
      </Pane>
    );
  }

  function SettingsPane({ prefs, setPref, overrideCount, onClearOverrides, onClose }) {
    return (
      <Pane title="Settings" sub="stored on this device only" onClose={onClose}
            foot={<span>{overrideCount ? `${overrideCount} local edits` : "no local edits"}</span>}>
        <section>
          <h3>View</h3>
          <div className="rows">
            <div className="row">
              <span className="row-b"><b>Layout</b><span>how the lanes are laid out</span></span>
              <div className="seg">
                {[["cols", "Columns"], ["areas", "By area"], ["tabs", "Tabs"]].map(([v, label]) => (
                  <button key={v} type="button" className={prefs.view === v ? "on" : ""}
                          onClick={() => setPref("view", v)}>{label}</button>
                ))}
              </div>
            </div>
            <div className="row">
              <span className="row-b"><b>Archive expanded</b><span>open the archive lane on load</span></span>
              <button className={`tog${prefs.arch ? " on" : ""}`} type="button" aria-pressed={!!prefs.arch}
                      aria-label="Archive expanded" onClick={() => setPref("arch", !prefs.arch)} />
            </div>
            <div className="row">
              <span className="row-b"><b>Compact cards</b><span>tighter padding, more on screen</span></span>
              <button className={`tog${prefs.dense ? " on" : ""}`} type="button" aria-pressed={!!prefs.dense}
                      aria-label="Compact cards" onClick={() => setPref("dense", !prefs.dense)} />
            </div>
            <div className="row">
              <span className="row-b"><b>Urgent band</b><span>show "needs you first" above the board</span></span>
              <button className={`tog${prefs.urg ? " on" : ""}`} type="button" aria-pressed={!!prefs.urg}
                      aria-label="Urgent band" onClick={() => setPref("urg", !prefs.urg)} />
            </div>
          </div>
        </section>
        <section>
          <h3>Local edits</h3>
          <div className="rows">
            <div className="row">
              <span className="row-b">
                <b>{overrideCount} cards edited here</b>
                <span>moves, titles, archived and hidden ones</span>
              </span>
              <button className="btn" type="button" disabled={!overrideCount} onClick={onClearOverrides}>
                Reset to the snapshot
              </button>
            </div>
          </div>
          <p className="local-note">
            They live in this browser and never reach Jira, Linear or Zammad. If the collector changes a
            task at the source, the local edit stays on top of it until you reset.
          </p>
        </section>
      </Pane>
    );
  }

  // --- sheet ----------------------------------------------------------------
  function Sheet({ task, now, onClose, onMove, onEdit, onArchive, onDelete }) {
    const [editing, setEditing] = useState(false);
    const [title, setTitle] = useState(task.title);
    const [desc, setDesc] = useState("");
    const [promptOpen, setPromptOpen] = useState(false);
    const [copied, setCopied] = useState(false);

    const detail = task.detail || {};
    const baseDesc = task.localDesc || detail.done || task.note || "No description recorded for this item yet.";

    useEffect(() => {
      setEditing(false);
      setTitle(task.title);
      setDesc(task.localDesc || (task.localDesc === "" ? "" : ""));
    }, [task.id, task.title, task.localDesc]);

    useEffect(() => {
      const esc = e => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
      window.addEventListener("keydown", esc, true);
      return () => window.removeEventListener("keydown", esc, true);
    }, [onClose]);

    const rows = backlog(task, now);
    const prompt = resumePrompt(task, now, baseDesc);
    const copyPrompt = () => {
      if (!navigator.clipboard) return;
      navigator.clipboard.writeText(prompt).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }, () => {});
    };
    const save = () => {
      onEdit(task, title.trim() || task.title, desc.trim());
      setEditing(false);
    };

    return (
      <>
        <div className="scrim" onClick={onClose} />
        <div className="sheet" data-lane={task.column} role="dialog" aria-modal="true" aria-label={task.title}>
          <header className="sheet-h">
            <div className="sheet-k">
              {[LANE_NAME[task.column], AREA_NAME[task.area] || task.area, shortAge(task.updatedAt, now)]
                .filter(Boolean).join(" · ")}
            </div>
            {editing
              ? <input className="edit-t" value={title} onChange={e => setTitle(e.target.value)} aria-label="Title" />
              : <h2 className="sheet-t">{task.title}</h2>}
            <div className="sheet-tags">
              {task.sources.map(s => (s.url
                ? <a className="tag id" href={s.url} target="_blank" rel="noopener" key={s.label}>{s.label}</a>
                : <span className="tag" key={s.label}>{s.label}</span>))}
              {task.state && <span className="tag">{task.state}</span>}
              {task.due && task.due.at && <span className="tag due">{dueLabel(task.due.at, now)}</span>}
              {task.local && <span className="tag local">edited here</span>}
            </div>
            <button className="sheet-x" type="button" aria-label="Close" onClick={onClose}>
              <Icons.close size={15} />
            </button>
          </header>

          <div className="sheet-b">
            <section>
              <h3>Status</h3>
              <div className="seg">
                {ALL_LANES.map(([lane, label]) => (
                  <button key={lane} type="button" className={task.column === lane ? "on" : ""}
                          onClick={() => onMove(task, lane)}>{label}</button>
                ))}
              </div>
              <p className="local-note">
                Moving a card moves it here only. The state at the source stays {task.state || "unchanged"}.
              </p>
            </section>

            <section>
              <h3>Description</h3>
              {editing
                ? <textarea className="edit-d" value={desc} placeholder={baseDesc}
                            onChange={e => setDesc(e.target.value)} aria-label="Description" />
                : <p className="sheet-desc">{baseDesc}</p>}
            </section>

            {(detail.todo || detail.next || task.due) && (
              <section>
                <h3>What is left</h3>
                <dl>
                  {detail.todo && <><dt>missing</dt><dd>{detail.todo}</dd></>}
                  {detail.next && <><dt>next</dt><dd>{detail.next}</dd></>}
                  {task.due && task.due.at && (
                    <><dt>deadline</dt><dd>{dueLabel(task.due.at, now)}{task.due.why ? ` · ${task.due.why}` : ""}
                      {task.due.source === "inferred" ? " (read out of the text)" : ""}</dd></>
                  )}
                </dl>
              </section>
            )}

            <section>
              <h3>Detail</h3>
              <dl>
                <dt>area</dt><dd>{AREA_NAME[task.area] || task.area}</dd>
                <dt>state</dt><dd>{task.state || "no state"}</dd>
                <dt>updated</dt><dd>{age(task.updatedAt, now)}</dd>
                {task.timeSpentMs > 0 && <><dt>time</dt><dd>{hours(task.timeSpentMs)} of agent sessions</dd></>}
                {task.note && <><dt>note</dt><dd>{task.note}</dd></>}
              </dl>
            </section>

            {(task.prs || []).length > 0 && (
              <section>
                <h3>Pull requests</h3>
                {task.prs.map(pr => (
                  <div key={pr.url} style={{ marginBottom: 12 }}>
                    <a className="btn" href={pr.url} target="_blank" rel="noopener">
                      #{pr.number} {pr.draft ? "(draft)" : ""} {pr.decision || pr.state}
                    </a>
                    <p className="local-note">
                      {pr.checksFailed && pr.checksFailed.length
                        ? `CI red: ${pr.checksFailed.join(", ")}`
                        : `${pr.checksTotal || 0} checks, none failed`}
                    </p>
                    {(pr.reviews || []).map((r, i) => (
                      <p className="local-note" key={`r${i}`}>
                        <b>{r.author}</b> {r.state.toLowerCase()}{r.body ? `: ${r.body}` : ""}
                      </p>
                    ))}
                  </div>
                ))}
              </section>
            )}

            {(task.agents || []).length > 0 && (
              <section>
                <h3>Agent sessions</h3>
                {task.agents.map(a => (
                  <div key={a.sessionId || a.label} style={{ marginBottom: 14 }}>
                    <dl>
                      <dt>agent</dt><dd>{a.agent}{a.runs > 1 ? ` · ${a.runs} sessions` : ""}</dd>
                      <dt>workspace</dt><dd className="mono">{a.cwd}{a.branch ? ` · ${a.branch}` : ""}</dd>
                      <dt>activity</dt>
                      <dd>{a.timeSpentMs > 0 ? `${hours(a.timeSpentMs)} · ` : ""}{age(a.updatedAt, now)}</dd>
                      {a.lastPrompt && <><dt>prompt</dt><dd className="mono">{a.lastPrompt}</dd></>}
                    </dl>
                    {a.resume && <Copyable text={a.resume} />}
                  </div>
                ))}
              </section>
            )}

            <section>
              <h3>Backlog</h3>
              <ol className="log">
                {rows.map((r, i) => (
                  <li key={i}><i /><div><time>{r.when}</time><span>{r.what}</span></div></li>
                ))}
              </ol>
            </section>

            {(task.create && (task.create.jira || task.create.linear)) && (
              <section>
                <h3>No ticket for this work</h3>
                <p className="sheet-desc">{task.create.body}</p>
                <div className="sheet-tags" style={{ marginTop: 12 }}>
                  {task.create.jira && <a className="btn" href={task.create.jira} target="_blank" rel="noopener">Create in Jira</a>}
                  {task.create.linear && <a className="btn" href={task.create.linear} target="_blank" rel="noopener">Create in Linear</a>}
                </div>
              </section>
            )}

            <section className="prompt-sec">
              <h3>
                <button className={`disc${promptOpen ? " open" : ""}`} type="button"
                        aria-expanded={promptOpen} onClick={() => setPromptOpen(!promptOpen)}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
                  Resume prompt
                </button>
                <button className={`p-copy${copied ? " done" : ""}`} type="button" onClick={copyPrompt}>
                  <Icons.copy size={12} />{copied ? "copied" : "copy"}
                </button>
              </h3>
              {promptOpen && <pre className="pbox">{prompt}</pre>}
            </section>
          </div>

          <footer className="sheet-f">
            <span>{task.sources.map(s => s.label).join(" · ")}</span>
            <div className="sheet-acts">
              {editing ? (
                <>
                  <button type="button" onClick={() => { setEditing(false); setTitle(task.title); setDesc(task.localDesc || ""); }}>
                    Cancel
                  </button>
                  <button type="button" className="primary" onClick={save}>Save here</button>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => { setDesc(task.localDesc || ""); setEditing(true); }}>Edit</button>
                  {task.column !== "arch" && <button type="button" onClick={() => onArchive(task)}>Archive</button>}
                  <button type="button" className="danger" onClick={() => onDelete(task)}>Hide</button>
                </>
              )}
            </div>
          </footer>
        </div>
      </>
    );
  }

  // --- page -----------------------------------------------------------------
  function Page({ close, initialTask }) {
    const [doc, setDoc] = useState(null);
    const [query, setQuery] = useState("");
    const [area, setArea] = useState("all");
    const [selectedId, setSelectedId] = useState(initialTask || null);
    const [overrides, patchOverride, clearOverrides] = useOverrides();
    const [prefs, setPrefs] = useState(() => Object.assign(
      { view: "cols", lane: "next", arch: false, dense: false, urg: true }, readJson(PREF_KEY, {})));
    const [menu, setMenu] = useState(null);
    const [toast, setToast] = useState(null);
    const [pane, setPane] = useState(null);
    const [dragId, setDragId] = useState(null);
    const [overZone, setOverZone] = useState(null);
    const [justId, setJustId] = useState(null);
    const searchRef = useRef(null);
    const toastTimer = useRef(null);

    const setPref = useCallback((key, value) => {
      setPrefs(prev => { const next = Object.assign({}, prev, { [key]: value }); writeJson(PREF_KEY, next); return next; });
    }, []);

    const reload = useCallback(() =>
      fetch("/api/_p/work-cockpit/snapshot", { cache: "no-store" })
        .then(r => r.json())
        .then(setDoc)
        .catch(error => setDoc({ error: String(error) })), []);

    useEffect(() => {
      reload();
      const timer = setInterval(reload, 60000);
      return () => clearInterval(timer);
    }, [reload]);

    const showToast = useCallback((msg, undo) => {
      clearTimeout(toastTimer.current);
      setToast({ msg, undo });
      toastTimer.current = setTimeout(() => setToast(null), 5200);
    }, []);

    const now = (doc && doc.serverNow) || Date.now();
    const stale = doc && doc.generatedAt && (now - doc.generatedAt) > ((doc && doc.staleAfterMs) || 7200000);

    // Every task the snapshot carries, with the local overrides applied on top
    // and the deleted ones dropped.
    const [tasks, base] = useMemo(() => {
      const out = [];
      const original = {};
      AREAS.forEach(([a]) => LANES.forEach(([c]) => {
        (((doc && doc.areas) || {})[a] || {})[c] &&
          doc.areas[a][c].forEach(t => {
            original[t.id] = { column: c, title: t.title };
            const ov = overrides[t.id];
            if (ov && ov.deleted) return;
            out.push(applyOverride(t, ov));
          });
      }));
      return [out, original];
    }, [doc, overrides]);

    const needle = query.trim().toLowerCase();
    const matches = useCallback(task => {
      if (!needle) return true;
      const haystack = [task.title, task.state, task.note, task.localDesc,
                        (task.detail || {}).done, (task.detail || {}).todo]
        .concat(task.sources.map(s => s.label))
        .concat((task.agents || []).map(a => a.branch || a.label));
      return haystack.some(v => (v || "").toLowerCase().includes(needle));
    }, [needle]);

    const visible = useMemo(
      () => tasks.filter(t => (area === "all" || t.area === area) && matches(t)),
      [tasks, area, matches]);

    const byLane = useMemo(() => {
      const out = { next: [], now: [], waiting: [], arch: [] };
      visible.forEach(t => (out[t.column] || out.next).push(t));
      Object.values(out).forEach(list => list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
      return out;
    }, [visible]);

    const areaCounts = useMemo(() => {
      const counts = { all: 0 };
      AREAS.forEach(([a]) => { counts[a] = 0; });
      tasks.filter(matches).forEach(t => {
        if (t.column === "arch") return;
        counts.all += 1;
        counts[t.area] = (counts[t.area] || 0) + 1;
      });
      return counts;
    }, [tasks, matches]);

    // The hero is the last thing that moved: a live agent session first, then
    // the most recently touched card.
    const hero = useMemo(() => {
      const pool = visible.filter(t => t.column !== "arch");
      const live = pool.filter(t => (t.agents || []).length);
      const pick = (live.length ? live : pool).slice()
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
      return pick || null;
    }, [visible]);

    const urgent = useMemo(() => visible
      .map(t => ({ task: t, urg: urgencyOf(t, now) }))
      .filter(row => row.urg)
      .sort((a, b) => b.urg.weight - a.urg.weight)
      .slice(0, 4), [visible, now]);

    const staleCount = useMemo(
      () => visible.filter(t => t.stale && t.column !== "arch").length, [visible]);

    const selected = visible.find(t => t.id === selectedId)
      || tasks.find(t => t.id === selectedId) || null;

    // The open task lives in the URL: a card is linkable, and reopening the
    // page lands back on what you were looking at.
    const select = useCallback(task => {
      setSelectedId(task ? task.id : null);
      window.location.hash = task ? `${HASH}=${encodeURIComponent(task.id)}` : HASH;
    }, []);

    // Landing back on the lane the snapshot says drops the override instead of
    // pinning it: an undone move must leave no trace.
    const moveTo = useCallback((id, lane) => {
      const home = (base[id] || {}).column;
      patchOverride(id, { column: lane === home ? null : lane });
    }, [base, patchOverride]);

    const move = useCallback((task, lane) => {
      if (task.column === lane) return;
      const from = task.column;
      moveTo(task.id, lane);
      setJustId(task.id);
      setTimeout(() => setJustId(null), 800);
      showToast(`Moved to ${LANE_NAME[lane]}, here only.`, () => moveTo(task.id, from));
    }, [moveTo, showToast]);

    const remove = useCallback(task => {
      patchOverride(task.id, { deleted: true });
      if (selectedId === task.id) select(null);
      showToast("Card hidden, here only.", () => patchOverride(task.id, { deleted: null }));
    }, [patchOverride, select, selectedId, showToast]);

    const edit = useCallback((task, title, desc) => {
      patchOverride(task.id, { title: title === (base[task.id] || {}).title ? null : title, desc: desc || null });
      showToast("Text saved in this browser.");
    }, [base, patchOverride, showToast]);

    // keyboard: '/' focuses the search, Esc clears it or closes the page
    useEffect(() => {
      const onKey = e => {
        const typing = e.target.closest && e.target.closest("input, textarea, [contenteditable='true']");
        if (e.key === "/" && !typing) { e.preventDefault(); searchRef.current && searchRef.current.focus(); return; }
        if (e.key !== "Escape") return;
        if (menu) { setMenu(null); return; }
        if (selectedId || pane) return; // the sheet and the panes close themselves
        if (query) { setQuery(""); return; }
        close();
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [close, menu, pane, query, selectedId]);

    useEffect(() => {
      if (!menu) return;
      const off = e => { if (!e.target.closest(".menu")) setMenu(null); };
      window.addEventListener("mousedown", off);
      return () => window.removeEventListener("mousedown", off);
    }, [menu]);

    const drop = {
      over: (e, zone) => { if (!dragId) return; e.preventDefault(); setOverZone(zone); },
      leave: (e, zone) => { if (!e.currentTarget.contains(e.relatedTarget)) setOverZone(z => (z === zone ? null : z)); },
      drop: (e, zone) => {
        if (!dragId) return;
        e.preventDefault();
        setOverZone(null);
        const lane = zone.split(":").pop();
        const task = tasks.find(t => t.id === dragId);
        setDragId(null);
        if (task) move(task, lane);
      },
    };

    const card = task => (
      <div key={task.id} className={justId === task.id ? "just" : ""}>
        <Card task={task} now={now} dragging={dragId === task.id}
              onOpen={select} onDrag={setDragId}
              onMenu={(anchor, t) => {
                const r = anchor.getBoundingClientRect();
                setMenu({ task: t, left: Math.max(10, Math.min(r.right - 186, window.innerWidth - 196)),
                          top: Math.min(r.bottom + 6, window.innerHeight - 240) });
              }} />
      </div>
    );

    const archLane = (
      <Lane lane="arch" label={ARCH[1]} what={ARCH[2]} tasks={byLane.arch} now={now} card={card}
            drop={drop} over={overZone === "arch"} collapsed={!prefs.arch && !needle}
            onToggle={() => setPref("arch", !prefs.arch)} />
    );

    return (
      <div className={`wc-page${prefs.dense ? " dense" : ""}`} data-view={prefs.view}>
        <style>{STYLE}</style>
        <div className="page">
          <header className="head">
            <span className="head-icn"><Icons.briefcase size={22} /></span>
            <div className="head-t">
              <h1>Work cockpit</h1>
              <div className="sub">
                {doc && doc.generatedAt
                  ? `read ${age(doc.generatedAt, now)} · ${areaCounts.all} items`
                  : "loading the snapshot…"}
              </div>
            </div>
            <div className="head-a">
              <button className="iconbtn" type="button" title="Legend and sources" aria-label="Legend and sources"
                      onClick={() => setPane("info")}><InfoGlyph /></button>
              <button className="iconbtn" type="button" title="Settings" aria-label="Settings"
                      onClick={() => setPane("set")}><Icons.sliders size={17} /></button>
              <button className="iconbtn" type="button" title="Reload" aria-label="Reload"
                      onClick={reload}><Icons.refresh size={17} /></button>
              <button className="iconbtn" type="button" title="Close (Esc)" aria-label="Close"
                      onClick={close}><Icons.close size={18} /></button>
            </div>
          </header>

          {doc && doc.error && <div className="banner err">{doc.error}</div>}
          {stale && (
            <div className="banner">
              Snapshot stuck for {shortAge(doc.generatedAt, now)}: the collector on the Mac is not
              running. Everything below is old.
            </div>
          )}

          {hero && (
            <div className="top">
              <button className="hero" type="button" onClick={() => select(hero)}
                      aria-label="Open the last task that moved">
                <span className="hero-k"><i />Continue</span>
                <span className="hero-t">{hero.title}</span>
                <span className="hero-b">
                  <span className="hero-area">{AREA_NAME[hero.area] || hero.area}</span>
                  <span className="hero-sep">·</span>
                  <span className="hero-m">
                    {(hero.agents || []).length
                      ? `${hero.agents[0].agent} session · ${hero.agents[0].branch || hero.agents[0].cwd || hero.agents[0].label}`
                      : hero.sources.map(s => s.label).join(" · ")}
                  </span>
                  {staleCount > 0 && <span className="hero-stale">{staleCount} stale</span>}
                </span>
                <span className="hero-when">
                  <b>{shortAge(hero.updatedAt, now)}</b>
                  <em>{(hero.agents || []).length ? "live" : "ago"}</em>
                </span>
                <span className="hero-go"><Icons.chevRight size={15} /></span>
              </button>
            </div>
          )}

          {prefs.urg && (
            <section className="urg">
              <div className="urg-h"><span>Needs you first</span><span className="n">{urgent.length}</span></div>
              {urgent.length ? (
                <div className="urg-l">
                  {urgent.map(({ task, urg }) => (
                    <button className="urow" type="button" key={task.id} data-sev={urg.sev}
                            onClick={() => select(task)}>
                      <span className="urow-top">
                        <span className="urow-chip"><i />{urg.chip}</span>
                        <span className="urow-w">{urg.big}</span>
                      </span>
                      <span className="urow-t">{task.title}</span>
                      <span className="urow-m">{urg.why}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="urg-none">Nothing waiting on you in this area.</div>
              )}
            </section>
          )}

          <div className="toolbar">
            <label className="search">
              <Icons.search size={15} />
              <input ref={searchRef} type="search" value={query} placeholder="Search tasks, tickets, notes"
                     autoComplete="off" aria-label="Search tasks" onChange={e => setQuery(e.target.value)} />
              {query
                ? <button className="q-x" type="button" aria-label="Clear search" onClick={() => setQuery("")}>
                    <Icons.close size={13} />
                  </button>
                : <span className="q-k">/</span>}
            </label>
            <div className="filter" role="tablist" aria-label="Area">
              {[["all", "All"]].concat(AREAS.map(([k, label]) => [k, label])).map(([key, label]) => (
                <button key={key} role="tab" aria-selected={area === key} className={area === key ? "on" : ""}
                        onClick={() => setArea(key)}>{label} <em>{areaCounts[key] || 0}</em></button>
              ))}
            </div>
            <div className="viewseg" role="group" aria-label="Board layout">
              {[["cols", "Columns"], ["areas", "By area"], ["tabs", "Tabs"]].map(([v, label]) => (
                <button key={v} type="button" className={prefs.view === v ? "on" : ""}
                        onClick={() => setPref("view", v)}>{label}</button>
              ))}
            </div>
          </div>

          {prefs.view === "tabs" && (
            <div className="lanetabs" role="tablist" aria-label="Lane">
              {ALL_LANES.map(([lane, label]) => (
                <button key={lane} type="button" className={prefs.lane === lane ? "on" : ""}
                        onClick={() => setPref("lane", lane)}>{label} <em>{byLane[lane].length}</em></button>
              ))}
            </div>
          )}

          {prefs.view === "areas" ? (
            <>
              <div className="areas">
                {AREAS.map(([key, label, what]) => {
                  const total = LANES.reduce((n, [lane]) => n + byLane[lane].filter(t => t.area === key).length, 0);
                  if (area !== "all" && area !== key) return null;
                  return (
                    <section className="agrp" key={key}>
                      <div className="agrp-h"><h2>{label}</h2><span className="what">{what}</span>
                        <span className="agrp-n">{total}</span></div>
                      <div className="agrp-b">
                        {LANES.map(([lane, laneLabel]) => {
                          const list = byLane[lane].filter(t => t.area === key);
                          const zone = `${key}:${lane}`;
                          return (
                            <div className={`abox ${lane}${list.length ? "" : " void"}${overZone === zone ? " over" : ""}`}
                                 key={lane}
                                 onDragOver={e => drop.over(e, zone)}
                                 onDragLeave={e => drop.leave(e, zone)}
                                 onDrop={e => drop.drop(e, zone)}>
                              <div className="abox-h">{laneLabel} <em>{list.length}</em></div>
                              <div className="stack">{list.map(t => card(t))}</div>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
              </div>
              <div className="board">{archLane}</div>
            </>
          ) : (
            <div className="board">
              {LANES.filter(([lane]) => prefs.view !== "tabs" || prefs.lane === lane).map(([lane, label, what]) => (
                <Lane key={lane} lane={lane} label={label} what={what} tasks={byLane[lane]} now={now}
                      card={card} drop={drop} over={overZone === lane} />
              ))}
              {(prefs.view !== "tabs" || prefs.lane === "arch") && archLane}
            </div>
          )}

          <div className="foot">
            {Object.entries((doc && doc.sources) || {}).map(([source, status]) => (
              <span className={`src ${status.status}`} key={source}>
                <i />{SOURCE_LABEL[source] || source}: {status.status}
                {status.count != null ? ` (${status.count})` : ""}
              </span>
            ))}
            <button className="btn" type="button" onClick={() => setPane("info")}>Legend and sources</button>
          </div>
        </div>

        {selected && (
          <Sheet task={selected} now={now} onClose={() => select(null)}
                 onMove={move} onEdit={edit}
                 onArchive={t => { move(t, "arch"); select(null); }}
                 onDelete={t => { remove(t); }} />
        )}

        {pane === "info" && <InfoPane doc={doc} total={areaCounts.all} now={now} onClose={() => setPane(null)} />}
        {pane === "set" && (
          <SettingsPane prefs={prefs} setPref={setPref} overrideCount={Object.keys(overrides).length}
                        onClearOverrides={() => { clearOverrides(); showToast("Snapshot ripristinato."); }}
                        onClose={() => setPane(null)} />
        )}

        {menu && (
          <div className="menu" style={{ left: menu.left, top: menu.top }}>
            <div className="menu-k">Move to</div>
            {LANES.map(([lane, label]) => (
              <button key={lane} type="button" className={menu.task.column === lane ? "on" : ""}
                      onClick={() => { move(menu.task, lane); setMenu(null); }}>{label}</button>
            ))}
            <div className="menu-sep" />
            <button type="button" onClick={() => { move(menu.task, "arch"); setMenu(null); }}>Archive</button>
            <button type="button" className="danger" onClick={() => { remove(menu.task); setMenu(null); }}>Hide</button>
          </div>
        )}

        {toast && (
          <div className="toast">
            <span>{toast.msg}</span>
            {toast.undo && <button type="button" onClick={() => { toast.undo(); setToast(null); }}>undo</button>}
          </div>
        )}
      </div>
    );
  }

  const hashTask = () => {
    const hash = window.location.hash;
    if (!hash.startsWith(HASH)) return null;
    const [, id] = hash.split("=");
    return id ? decodeURIComponent(id) : "";
  };

  // The page lives in the URL, so it stays deep-linkable while the home band
  // drives it: `open` is an edge (band click / Esc), the hash is the state.
  function Surface({ open, onClose }) {
    const [task, setTask] = useState(hashTask);
    const wasOpen = useRef(open);
    useEffect(() => {
      const sync = () => setTask(hashTask());
      window.addEventListener("hashchange", sync);
      return () => window.removeEventListener("hashchange", sync);
    }, []);
    const clearHash = () => {
      if (window.location.hash.startsWith(HASH)) history.replaceState(null, "", window.location.pathname);
    };
    useEffect(() => {
      if (open && !wasOpen.current) { window.location.hash = HASH; setTask(""); }
      if (!open && wasOpen.current) { clearHash(); setTask(null); }
      wasOpen.current = open;
    }, [open]);
    const hide = () => { clearHash(); setTask(null); onClose(); };
    if (task === null) return null;
    return <Page close={hide} initialTask={task} />;
  }

  function useSignal() {
    const [doc, setDoc] = useState(null);
    useEffect(() => {
      const load = () => fetch("/api/_p/work-cockpit/snapshot", { cache: "no-store" })
        .then(r => r.json())
        .then(setDoc)
        .catch(error => setDoc({ error: String(error) }));
      load();
      const timer = setInterval(load, 60000);
      return () => clearInterval(timer);
    }, []);
    if (!doc) return null;
    if (doc.error) return { tone: "down", dot: "down", value: "snapshot non leggibile", meta: doc.error };
    const now = doc.serverNow || Date.now();
    const count = column => AREAS.reduce((n, [area]) =>
      n + (((doc.areas || {})[area] || {})[column] || []).length, 0);
    const [nowN, waiting, next] = LANES.map(([column]) => count(column));
    const areas = AREAS.filter(([area]) =>
      LANES.some(([column]) => (((doc.areas || {})[area] || {})[column] || []).length > 0)).length;
    const isStale = doc.generatedAt && (now - doc.generatedAt) > (doc.staleAfterMs || 7200000);
    return {
      tone: isStale ? "warn" : "ok",
      dot: isStale ? "idle" : "up",
      value: `${nowN} ora · ${waiting} in attesa`,
      meta: isStale
        ? `snapshot fermo da ${age(doc.generatedAt, now)}: il collector non sta girando`
        : `${nowN + waiting + next} item in ${areas} aree · sync ${age(doc.generatedAt, now)}`,
    };
  }

  window.__lgboardPlugins = window.__lgboardPlugins || {};
  window.__lgboardPlugins["work-cockpit"] = { id: "work-cockpit", useSignal, Surface };
})();
