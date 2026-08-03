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
//   window.__lgboardPlugins["work-cockpit"] = { id, useSignal, Surface }

(function () {
  const { useState, useEffect, useCallback, useRef } = React;

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
  .wc-search { flex: 1; max-width: 260px; padding: 6px 9px; border-radius: 7px;
    border: 1px solid var(--line); background: transparent; color: var(--ink);
    font-family: var(--ff-mono); font-size: 12px; }
  .wc-search:focus { outline: none; border-color: var(--accent); }
  .wc-chip.stale { border-color: color-mix(in oklab, var(--idle, #d8a23a) 60%, var(--line));
    color: var(--idle, #d8a23a); }
  .wc-chip.pr { border-color: color-mix(in oklab, var(--accent) 40%, var(--line)); color: var(--accent); }
  .wc-chip.pr.ko { border-color: var(--down, #c0556b); color: var(--down, #c0556b); }
  .wc-delta { margin-top: 10px; font-size: 12px; color: var(--ink-soft); }
  .wc-card { cursor: pointer; }
  .wc-detail { position: fixed; inset: 0; z-index: 70; display: flex; justify-content: flex-end;
    background: color-mix(in oklab, #000 45%, transparent); }
  .wc-panel { width: min(560px, 96vw); height: 100%; overflow: auto; background: var(--bg);
    border-left: 1px solid var(--line); padding: 22px 24px 34px; }
  .wc-panel h3 { margin: 0 0 2px; font-size: 19px; letter-spacing: -.02em; }
  .wc-panel h4 { margin: 20px 0 6px; font-family: var(--ff-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: .08em; color: var(--ink-soft); }
  .wc-panel p { margin: 0 0 8px; font-size: 13.5px; line-height: 1.5; }
  .wc-panel .muted { color: var(--ink-soft); font-size: 12px; }
  .wc-next { padding: 9px 11px; border-radius: 8px; font-size: 13.5px;
    border: 1px solid color-mix(in oklab, var(--accent) 45%, var(--line));
    background: var(--accent-softer); }
  .wc-kv { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
  .wc-code { display: flex; align-items: center; gap: 8px; margin: 4px 0; padding: 7px 9px;
    border: 1px solid var(--line-2); border-radius: 7px; font-family: var(--ff-mono);
    font-size: 11.5px; color: var(--ink-mid); word-break: break-all; }
  .wc-code button { flex: 0 0 auto; border: 0; background: none; color: var(--accent);
    cursor: pointer; font-family: var(--ff-mono); font-size: 11px; margin-left: auto;
    white-space: nowrap; align-self: flex-start; }
  .wc-code span { white-space: pre-wrap; }
  .wc-list { margin: 0; padding-left: 17px; font-size: 12.5px; line-height: 1.6; color: var(--ink-mid); }
  .wc-btnrow { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
  .wc-btn { padding: 7px 12px; border-radius: 7px; border: 1px solid var(--line);
    background: none; color: var(--ink); font-size: 12.5px; cursor: pointer; text-decoration: none; }
  .wc-btn:hover { border-color: var(--accent); color: var(--accent); }
  @media (max-width: 860px) {
    .wc-page { padding: 18px 14px 32px; }
    .wc-columns { grid-template-columns: 1fr; gap: 10px; }
    .wc-col { border-top: 1px solid var(--line-2); padding-top: 8px; }
    .wc-panel { width: 100%; padding: 18px 16px 30px; }
    .wc-search { max-width: none; }
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

  const hours = ms => (ms >= 3600000 ? `${(ms / 3600000).toFixed(1)}h` : `${Math.round(ms / 60000)}m`);

  function Card({ task, now, open }) {
    // A card built from a session alone already says agent and workspace in its
    // single source: repeating them as state and agent chips is noise.
    const loose = task.sources.length === 1 && task.sources[0].source === "agent";
    const pr = (task.prs || [])[0];
    return (
      <div className="wc-card" onClick={() => open(task)} title="Apri il dettaglio">
        <div className="wc-title">{task.title}</div>
        <div className="wc-meta">
          {task.sources.map(s => <span className="wc-chip" key={`${s.source}-${s.label}`}>{s.label}</span>)}
          {task.state && !loose && <span className="wc-chip state">{task.state}</span>}
          {(loose ? task.agents.slice(0, 1) : task.agents).map(a => (
            <span className="wc-chip agent" key={a.label}>{loose ? a.agent : `${a.agent}: ${a.label}`}</span>
          ))}
          {pr && (
            <span className={`wc-chip pr ${pr.checksFailed?.length ? "ko" : ""}`}>
              PR #{pr.number}{pr.decision ? ` ${pr.decision.toLowerCase()}` : ""}
            </span>
          )}
          {task.stale && <span className="wc-chip stale">{task.stale}</span>}
          <span>{age(task.updatedAt, now)}</span>
          {task.note && <span className="wc-note">{task.note}</span>}
        </div>
      </div>
    );
  }

  function Column({ name, label, tasks, now, open }) {
    const [expanded, setExpanded] = useState(false);
    const shown = expanded ? tasks : tasks.slice(0, VISIBLE);
    const hidden = tasks.length - shown.length;
    return (
      <div className={`wc-col ${name}`}>
        <div className="wc-col-label">{label}<span>{tasks.length || ""}</span></div>
        {shown.length
          ? shown.map(t => <Card key={t.id} task={t} now={now} open={open} />)
          : <div className="wc-empty">Niente qui.</div>}
        {(hidden > 0 || expanded) && (
          <button className="wc-more" onClick={() => setExpanded(!expanded)}>
            {expanded ? "mostra meno" : `+${hidden} altri`}
          </button>
        )}
      </div>
    );
  }

  function Copyable({ text }) {
    const [done, setDone] = useState(false);
    const copy = () => {
      navigator.clipboard?.writeText(text).then(() => {
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      });
    };
    return (
      <div className="wc-code">
        <span>{text}</span>
        <button onClick={copy}>{done ? "copiato" : "copia"}</button>
      </div>
    );
  }

  function Detail({ task, now, close }) {
    useEffect(() => {
      const esc = e => e.key === "Escape" && (e.stopPropagation(), close());
      window.addEventListener("keydown", esc, true);
      return () => window.removeEventListener("keydown", esc, true);
    }, [close]);
    if (!task) return null;
    const detail = task.detail || {};
    const create = task.create || {};
    return (
      <div className="wc-detail" onClick={close}>
        <div className="wc-panel" onClick={e => e.stopPropagation()}>
          <h3>{task.title}</h3>
          <div className="muted">
            {task.area} · {task.state || "senza stato"} · aggiornato {age(task.updatedAt, now)}
            {task.timeSpentMs > 0 && ` · ${hours(task.timeSpentMs)} di sessioni agente`}
            {task.stale && ` · ${task.stale}`}
          </div>

          <div className="wc-kv" style={{ marginTop: 12 }}>
            {task.sources.map(s => s.url
              ? <a className="wc-btn" key={s.label} href={s.url} target="_blank" rel="noopener">{s.label}</a>
              : <span className="wc-chip" key={s.label}>{s.label}</span>)}
          </div>

          {detail.done && <><h4>Fatto</h4><p>{detail.done}</p></>}
          {detail.todo && <><h4>Manca</h4><p>{detail.todo}</p></>}
          {detail.next && <><h4>Prossimo passo</h4><div className="wc-next">{detail.next}</div></>}

          {(task.prs || []).length > 0 && (
            <>
              <h4>Pull request</h4>
              {task.prs.map(pr => (
                <div key={pr.url} style={{ marginBottom: 10 }}>
                  <a className="wc-btn" href={pr.url} target="_blank" rel="noopener">
                    #{pr.number} {pr.draft ? "(draft)" : ""} {pr.decision || pr.state}
                  </a>
                  <div className="muted" style={{ marginTop: 4 }}>
                    {pr.checksFailed?.length
                      ? `CI rossa: ${pr.checksFailed.join(", ")}`
                      : `${pr.checksTotal || 0} check, nessuno fallito`}
                  </div>
                  <ul className="wc-list">
                    {pr.reviews.map((r, i) => (
                      <li key={`r${i}`}><b>{r.author}</b> {r.state.toLowerCase()}{r.body ? `: ${r.body}` : ""}</li>
                    ))}
                    {pr.comments.map((c, i) => (
                      <li key={`c${i}`}><b>{c.author}</b>: {c.body}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </>
          )}

          {task.agents.length > 0 && (
            <>
              <h4>Sessioni agente</h4>
              {task.agents.map(a => (
                <div key={a.sessionId || a.label} style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 550 }}>
                    {a.agent} · {a.title || a.label} {a.runs > 1 ? `· ${a.runs} sessioni` : ""}
                  </div>
                  <div className="muted">
                    {a.cwd}{a.branch ? ` · ${a.branch}` : ""}
                    {a.timeSpentMs > 0 ? ` · ${hours(a.timeSpentMs)}` : ""} · {age(a.updatedAt, now)}
                  </div>
                  {a.lastPrompt && <p className="muted">Ultimo prompt: {a.lastPrompt}</p>}
                  {a.resume && <Copyable text={a.resume} />}
                  {a.files?.length > 0 && (
                    <ul className="wc-list">{a.files.slice(0, 8).map(f => <li key={f}>{f}</li>)}</ul>
                  )}
                </div>
              ))}
            </>
          )}

          {(create.jira || create.linear) && (
            <>
              <h4>Nessun ticket per questo lavoro</h4>
              <p className="muted">{create.body}</p>
              <div className="wc-btnrow">
                {create.jira && <a className="wc-btn" href={create.jira} target="_blank" rel="noopener">Crea in Jira</a>}
                {create.linear && <a className="wc-btn" href={create.linear} target="_blank" rel="noopener">Crea in Linear</a>}
              </div>
              <Copyable text={`${create.title}\n\n${create.body}`} />
            </>
          )}

          <div className="wc-btnrow" style={{ marginTop: 20 }}>
            <button className="wc-btn" onClick={close}>Chiudi (Esc)</button>
          </div>
        </div>
      </div>
    );
  }

  function Page({ close, initialTask }) {
    const [doc, setDoc] = useState(null);
    const [query, setQuery] = useState("");
    const [selectedId, setSelectedId] = useState(initialTask || null);
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
    const needle = query.trim().toLowerCase();
    const match = task => !needle || [task.title, task.state, task.note,
      ...task.sources.map(s => s.label), ...task.agents.map(a => a.branch || a.label)]
      .some(v => (v || "").toLowerCase().includes(needle));
    const tasksOf = (area, column) => (doc?.areas?.[area]?.[column] || []).filter(match);
    const total = area => COLUMNS.reduce((n, [c]) => n + tasksOf(area, c).length, 0);
    const allTasks = AREAS.flatMap(([a]) => COLUMNS.flatMap(([c]) => doc?.areas?.[a]?.[c] || []));
    const selected = allTasks.find(t => t.id === selectedId) || null;
    // The open task lives in the URL: a card is linkable, and reopening the
    // page lands back on what you were looking at.
    const select = task => {
      setSelectedId(task?.id || null);
      window.location.hash = task ? `${HASH}=${encodeURIComponent(task.id)}` : HASH;
    };

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
            <input className="wc-search" value={query} onChange={e => setQuery(e.target.value)}
                   placeholder="filtra…" aria-label="Filtra i task" />
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

        {(doc?.delta?.entered?.length > 0 || doc?.delta?.left?.length > 0) && (
          <div className="wc-delta">
            Nelle ultime 24h: {doc.delta.entered.length} entrati
            {doc.delta.entered.length > 0 && ` (${doc.delta.entered.slice(0, 3).join(", ")})`},
            {" "}{doc.delta.left.length} usciti
            {doc.delta.left.length > 0 && ` (${doc.delta.left.slice(0, 3).join(", ")})`}.
          </div>
        )}

        {AREAS.map(([key, label]) => (
          <section className="wc-area" key={key}>
            <div className="wc-area-h"><h3>{label}</h3><span>{total(key)}</span></div>
            <div className="wc-columns">
              {COLUMNS.map(([column, name]) => (
                <Column key={column} name={column} label={name} tasks={tasksOf(key, column)}
                        now={now} open={select} />
              ))}
            </div>
          </section>
        ))}

        <Detail task={selected} now={now} close={() => select(null)} />

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
    const count = column => AREAS.reduce((n, [area]) => n + (doc.areas?.[area]?.[column]?.length || 0), 0);
    const [nowN, waiting, next] = COLUMNS.map(([column]) => count(column));
    const areas = AREAS.filter(([area]) =>
      COLUMNS.some(([column]) => (doc.areas?.[area]?.[column]?.length || 0) > 0)).length;
    const stale = doc.generatedAt && (now - doc.generatedAt) > (doc.staleAfterMs || 7200000);
    return {
      tone: stale ? "warn" : "ok",
      dot: stale ? "idle" : "up",
      value: `${nowN} ora · ${waiting} in attesa`,
      meta: stale
        ? `snapshot fermo da ${age(doc.generatedAt, now)}: il collector non sta girando`
        : `${nowN + waiting + next} item in ${areas} aree · sync ${age(doc.generatedAt, now)}`,
    };
  }

  window.__lgboardPlugins = window.__lgboardPlugins || {};
  window.__lgboardPlugins["work-cockpit"] = { id: "work-cockpit", useSignal, Surface };
})();
