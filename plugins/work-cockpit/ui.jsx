// Work cockpit plugin - UI.
//
// One read-only view of everything Luigi is working on: Jira and Zammad for
// A-Cube, Linear for Homelab and Personal, plus the Claude Code / Codex
// sessions open right now. Three areas, three columns (Ora, In attesa,
// Prossimi), every card links back to its original source.
//
// The collector on the Mac unifies the sources, so one task = one card even
// when it exists in Jira and Zammad at once; the card lists every source it
// was built from, so a wrong merge stays visible instead of hiding work.
//
// Full-screen view, not a modal: deep-linkable as <dashboard>/#work-cockpit.
//
// Contract (see lgboard public/components.jsx):
//   window.__lgboardPlugins['work-cockpit'] = { id, Launcher }

(function () {
  const { useState, useEffect, useCallback } = React;

  const HASH = "#work-cockpit";
  const AREAS = [["a-cube", "A-Cube"], ["homelab", "Homelab"], ["personal", "Personal"]];
  const COLUMNS = [["now", "Ora"], ["waiting", "In attesa"], ["next", "Prossimi"]];
  const VISIBLE = 5;

  const STYLE = `
  .wc-page { position: fixed; inset: 0; z-index: 60; overflow: auto;
    background: var(--bg); padding: 26px clamp(14px, 4vw, 46px) 40px; }
  .wc-head { display: flex; align-items: flex-start; justify-content: space-between;
    gap: 16px; padding-bottom: 14px; border-bottom: 1px solid var(--line); }
  .wc-head h2 { margin: 0; font-size: 26px; letter-spacing: -.03em; }
  .wc-sub { font-size: 12px; color: var(--ink-soft); margin-top: 4px; }
  .wc-actions { display: flex; gap: 6px; }
  .wc-banner { margin: 14px 0 0; padding: 10px 13px; border-radius: 9px; font-size: 13px;
    border: 1px solid color-mix(in oklab, var(--idle, #d8a23a) 55%, var(--line));
    background: color-mix(in oklab, var(--idle, #d8a23a) 9%, transparent); color: var(--ink); }
  .wc-banner.err { border-color: color-mix(in oklab, var(--down, #c0556b) 55%, var(--line));
    background: color-mix(in oklab, var(--down, #c0556b) 8%, transparent); color: var(--down, #c0556b); }
  .wc-area { padding: 18px 0 20px; border-bottom: 1px solid var(--line); }
  .wc-area:last-of-type { border-bottom: 0; }
  .wc-area-h { display: flex; align-items: baseline; gap: 9px; margin: 0 0 10px; }
  .wc-area-h h3 { margin: 0; font-size: 16px; font-weight: 600; }
  .wc-area-h span { font-family: var(--ff-mono); font-size: 11px; color: var(--ink-soft); }
  .wc-columns { display: grid; grid-template-columns: 1.25fr 1fr 1fr; gap: 16px; }
  .wc-col { min-width: 0; }
  .wc-col-label { display: flex; align-items: baseline; gap: 6px; margin: 0 0 6px;
    font-family: var(--ff-mono); font-size: 10px; text-transform: uppercase;
    letter-spacing: .08em; color: var(--ink-soft); }
  .wc-col.now .wc-col-label { color: var(--accent); }
  .wc-card { display: block; padding: 9px 10px; border-top: 1px solid var(--line-2);
    border-radius: 8px; transition: background 120ms; }
  .wc-card:hover { background: var(--accent-softer); }
  .wc-card:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .wc-title { font-size: 13.5px; font-weight: 550; line-height: 1.35; overflow: hidden;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .wc-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 4px;
    font-family: var(--ff-mono); font-size: 10px; color: var(--ink-soft); }
  .wc-chip { padding: 1px 5px; border-radius: 4px; border: 1px solid var(--line);
    color: var(--ink-mid); text-transform: uppercase; letter-spacing: .04em; }
  .wc-chip.state { border-color: color-mix(in oklab, var(--accent) 40%, var(--line));
    color: var(--accent); }
  .wc-chip.agent { border-color: color-mix(in oklab, var(--up, #3fb27f) 45%, var(--line));
    color: var(--up, #3fb27f); }
  .wc-note { font-style: italic; color: var(--ink-mid); }
  .wc-more { display: block; width: 100%; margin-top: 6px; padding: 5px; border: 0;
    border-top: 1px dashed var(--line); background: none; cursor: pointer;
    font-family: var(--ff-mono); font-size: 10.5px; color: var(--ink-soft); }
  .wc-more:hover { color: var(--accent); }
  .wc-empty { padding: 9px 2px; font-size: 12px; color: var(--ink-soft); }
  .wc-foot { display: flex; flex-wrap: wrap; gap: 14px; padding-top: 14px;
    font-family: var(--ff-mono); font-size: 11px; color: var(--ink-soft); }
  .wc-src.ok { color: var(--up, #3fb27f); }
  .wc-src.error { color: var(--down, #c0556b); }
  .wc-src.unavailable, .wc-src.cached, .wc-src.skipped { color: var(--idle, #d8a23a); }
  @media (max-width: 860px) {
    .wc-page { padding: 18px 14px 32px; }
    .wc-columns { grid-template-columns: 1fr; gap: 10px; }
    .wc-col { border-top: 1px solid var(--line-2); padding-top: 8px; }
  }
  `;

  const age = (ms, now) => {
    if (!ms) return "senza data";
    const m = Math.max(0, Math.round((now - ms) / 60000));
    if (m < 2) return "ora";
    if (m < 60) return `${m}m fa`;
    if (m < 1440) return `${Math.round(m / 60)}h fa`;
    return `${Math.round(m / 1440)}g fa`;
  };

  function Card({ task, now }) {
    // A card built from a session alone already says agent and workspace in its
    // single source: repeating them as state and agent chips is noise.
    const loose = task.sources.length === 1 && task.sources[0].source === "agent";
    const body = (
      <>
        <div className="wc-title">{task.title}</div>
        <div className="wc-meta">
          {task.sources.map(s => <span className="wc-chip" key={`${s.source}-${s.label}`}>{s.label}</span>)}
          {task.state && !loose && <span className="wc-chip state">{task.state}</span>}
          {(loose ? task.agents.slice(0, 1) : task.agents).map(a => (
            <span className="wc-chip agent" key={a.label}>{loose ? a.agent : `${a.agent}: ${a.label}`}</span>
          ))}
          <span>{age(task.updatedAt, now)}</span>
          {task.note && <span className="wc-note">{task.note}</span>}
        </div>
      </>
    );
    return task.url
      ? <a className="wc-card" href={task.url} target="_blank" rel="noopener" title="Apri la fonte">{body}</a>
      : <div className="wc-card">{body}</div>;
  }

  function Column({ name, label, tasks, now }) {
    const [open, setOpen] = useState(false);
    const shown = open ? tasks : tasks.slice(0, VISIBLE);
    const hidden = tasks.length - shown.length;
    return (
      <div className={`wc-col ${name}`}>
        <div className="wc-col-label">{label}<span>{tasks.length || ""}</span></div>
        {shown.length
          ? shown.map(t => <Card key={t.id} task={t} now={now} />)
          : <div className="wc-empty">Niente qui.</div>}
        {(hidden > 0 || open) && (
          <button className="wc-more" onClick={() => setOpen(!open)}>
            {open ? "mostra meno" : `+${hidden} altri`}
          </button>
        )}
      </div>
    );
  }

  function Page({ close }) {
    const [doc, setDoc] = useState(null);
    const reload = useCallback(() =>
      fetch("/api/_p/work-cockpit/snapshot")
        .then(r => r.json())
        .then(setDoc)
        .catch(error => setDoc({ error: String(error) })), []);

    useEffect(() => {
      reload();
      const esc = e => e.key === "Escape" && close();
      window.addEventListener("keydown", esc);
      const timer = setInterval(reload, 60000);
      return () => { window.removeEventListener("keydown", esc); clearInterval(timer); };
    }, [close, reload]);

    const now = doc?.serverNow || Date.now();
    const stale = doc?.generatedAt && (now - doc.generatedAt) > (doc.staleAfterMs || 7200000);
    const total = area => COLUMNS.reduce((n, [c]) => n + (doc?.areas?.[area]?.[c]?.length || 0), 0);

    return (
      <div className="wc-page">
        <style>{STYLE}</style>
        <div className="wc-head">
          <div>
            <h2>Work cockpit</h2>
            <div className="wc-sub">
              {doc?.generatedAt
                ? `Snapshot aggiornato ${age(doc.generatedAt, now)}. Ogni card apre la fonte originale.`
                : "Caricamento snapshot…"}
            </div>
          </div>
          <div className="wc-actions">
            <button className="iconbtn" onClick={reload} aria-label="Ricarica" title="Ricarica">↻</button>
            <button className="iconbtn" onClick={close} aria-label="Chiudi" title="Chiudi (Esc)">×</button>
          </div>
        </div>

        {doc?.error && <div className="wc-banner err">{doc.error}</div>}
        {stale && (
          <div className="wc-banner">
            Snapshot fermo da {age(doc.generatedAt, now)}: il collector sul Mac non sta girando.
            I dati qui sotto sono vecchi.
          </div>
        )}

        {AREAS.map(([key, label]) => (
          <section className="wc-area" key={key}>
            <div className="wc-area-h"><h3>{label}</h3><span>{total(key)}</span></div>
            <div className="wc-columns">
              {COLUMNS.map(([column, name]) => (
                <Column key={column} name={column} label={name}
                        tasks={doc?.areas?.[key]?.[column] || []} now={now} />
              ))}
            </div>
          </section>
        ))}

        <div className="wc-foot">
          {Object.entries(doc?.sources || {}).map(([source, status]) => (
            <span className={`wc-src ${status.status}`} key={source}>
              {source}: {status.status}{status.count != null ? ` (${status.count})` : ""}
              {status.error ? ` — ${status.error}` : ""}
            </span>
          ))}
        </div>
      </div>
    );
  }

  function Launcher() {
    const [open, setOpen] = useState(() => window.location.hash === HASH);
    useEffect(() => {
      const sync = () => setOpen(window.location.hash === HASH);
      window.addEventListener("hashchange", sync);
      return () => window.removeEventListener("hashchange", sync);
    }, []);
    const show = () => { window.location.hash = HASH; setOpen(true); };
    const hide = () => {
      if (window.location.hash === HASH) history.replaceState(null, "", window.location.pathname);
      setOpen(false);
    };
    return (
      <>
        <button className="iconbtn" onClick={show} aria-label="Work cockpit" title="Work cockpit">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="7" width="18" height="13" rx="2" />
            <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18M10 12v2h4v-2" />
          </svg>
        </button>
        {open && <Page close={hide} />}
      </>
    );
  }

  window.__lgboardPlugins = window.__lgboardPlugins || {};
  window.__lgboardPlugins["work-cockpit"] = { id: "work-cockpit", Launcher };
})();
