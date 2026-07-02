// Automations plugin — UI.
//
// Header Launcher (clock) opens a modal listing every scheduled job collected
// across hosts. Read-only. Each job shows a clear title (precomputed by the
// collector via the llm-gateway) with the schedule beneath; every row expands
// into a detail card (explanation, schedule, next/last run, log, command).
// No runtime LLM.
//
// Contract (see lgboard public/components.jsx):
//   window.__lgboardPlugins.automations = { id, Launcher }

(function () {
  const { useState, useEffect, useCallback, useRef } = React;

  const STYLE = `
  .auto-modal { width: min(960px, 94vw); max-height: 86vh; display: flex; flex-direction: column; }
  .auto-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
  .auto-head h3 { margin: 0; }
  .auto-sub { font-size: 12px; color: var(--ink-mid); }
  .auto-filter { width: 100%; box-sizing: border-box; margin-bottom: 6px;
    background: var(--bg); border: 1px solid var(--line); border-radius: 8px;
    padding: 8px 12px; font-family: var(--ff-ui); font-size: 13px; color: var(--ink);
    outline: none; transition: border-color 120ms; }
  .auto-filter:focus { border-color: var(--accent); }
  .auto-filter::placeholder { color: var(--ink-mid); }
  .auto-body { overflow: auto; }
  .auto-host { margin-bottom: 14px; }
  .auto-host-h { display: flex; align-items: center; gap: 8px; font-weight: 600; margin: 10px 0 4px; }
  .auto-badge { font-size: 11px; padding: 1px 7px; border-radius: 999px; border: 1px solid currentColor; }
  .auto-badge.ok { color: var(--up, #3fb27f); }
  .auto-badge.skip, .auto-badge.stale { color: var(--idle, #d8a23a); }
  .auto-badge.unreachable { color: var(--down, #c0556b); }
  .auto-row { display: grid; grid-template-columns: 14px 1fr 16px; gap: 10px; align-items: center;
    padding: 7px 4px; border-top: 1px solid var(--line-2); cursor: pointer; }
  .auto-row:hover { background: var(--accent-softer); }
  .auto-row:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; border-radius: 6px; }
  .auto-dot { width: 9px; height: 9px; border-radius: 50%; }
  .auto-dot.ok { background: var(--up, #3fb27f); }
  .auto-dot.fail { background: var(--down, #c0556b); }
  .auto-dot.unknown { background: var(--ink-soft, #7b819b); }
  .auto-title { font-weight: 600; }
  .auto-tag { font-family: var(--ff-mono); font-size: 10px; text-transform: uppercase;
    letter-spacing: .06em; color: var(--ink-soft); margin-left: 6px; }
  .auto-meta { font-size: 12px; color: var(--ink-mid); }
  .auto-meta .mono, .mono { font-family: var(--ff-mono); }
  .auto-chev { transition: transform .15s; color: var(--ink-soft); display: inline-flex; }
  .auto-chev.open { transform: rotate(90deg); }
  .auto-detail { margin: 2px 4px 10px 24px; padding: 10px 14px;
    border: 1px solid var(--line); background: var(--accent-softer); border-radius: 10px; }
  .auto-detail p { margin: 0 0 8px; font-size: 13px; line-height: 1.5; max-width: 70ch; }
  .auto-detail dl { margin: 0; display: grid; grid-template-columns: max-content 1fr; gap: 3px 14px; }
  .auto-detail dt { font-family: var(--ff-mono); text-transform: uppercase; font-size: 10px;
    letter-spacing: .08em; color: var(--ink-soft); padding-top: 2px; }
  .auto-detail dd { margin: 0; font-size: 12.5px; line-height: 1.45; word-break: break-word; }
  .auto-empty { padding: 24px 4px; text-align: center; color: var(--ink-mid); font-size: 13px; }
  .auto-error { margin: 4px 0 10px; padding: 8px 12px; font-size: 13px;
    border: 1px solid var(--down, #c0556b); border-radius: 8px; color: var(--down, #c0556b); }
  .auto-os > summary { cursor: pointer; color: var(--ink-mid); font-size: 12px; margin-top: 8px; }
  @media (prefers-reduced-motion: reduce) { .auto-chev { transition: none; } }
  `;

  function pluginFetch(path) {
    return fetch(path, { headers: { 'Content-Type': 'application/json' } }).then(r => r.json());
  }

  function fmtAge(ms, now) {
    if (!ms) return 'mai';
    const s = Math.max(0, Math.round((now - ms) / 1000));
    if (s < 90) return `${s}s fa`;
    const m = Math.round(s / 60);
    if (m < 90) return `${m}m fa`;
    const h = Math.round(m / 60);
    if (h < 48) return `${h}h fa`;
    return `${Math.round(h / 24)}g fa`;
  }

  function fmtIn(ms, now) {
    if (!ms || ms <= now) return null;
    const s = Math.round((ms - now) / 1000);
    if (s < 90) return `tra ${s}s`;
    const m = Math.round(s / 60);
    if (m < 90) return `tra ${m}m`;
    const h = Math.round(m / 60);
    if (h < 48) return `tra ${h}h`;
    return `tra ${Math.round(h / 24)}g`;
  }

  function fmtAbs(ms) {
    return new Date(ms).toLocaleString('it-IT',
      { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function matches(a, q) {
    if (!q) return true;
    const hay = [a.title, a.name, a.host, a.type, a.command, a.schedule_human, a.explanation]
      .filter(Boolean).join(' ').toLowerCase();
    return q.toLowerCase().split(/\s+/).every(w => hay.includes(w));
  }

  function Row({ a, now }) {
    const [open, setOpen] = useState(false);
    const toggle = () => setOpen(o => !o);
    const title = a.title || a.name;
    const showName = a.title && a.title !== a.name;
    const next = fmtIn(a.next_run, now);
    const detail = [
      ['quando', a.schedule_human, false],
      a.schedule_raw && a.schedule_raw !== a.schedule_human ? ['raw', a.schedule_raw, true] : null,
      a.next_run ? ['prossima', `${next || 'passata'} (${fmtAbs(a.next_run)})`, false] : null,
      a.last_run ? ['ultima', `${fmtAge(a.last_run, now)} (${fmtAbs(a.last_run)})`, false] : null,
      a.command ? ['comando', a.command, true] : null,
      a.log_path ? ['log', a.log_path, true] : null,
      a.source ? ['fonte', a.source, true] : null,
    ].filter(Boolean);
    return (
      <>
        <div className="auto-row" role="button" tabIndex={0} aria-expanded={open}
             onClick={toggle}
             onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}>
          <span className={`auto-dot ${a.last_status || 'unknown'}`} title={`stato: ${a.last_status || 'unknown'}`} />
          <div>
            <div><span className="auto-title">{title}</span><span className="auto-tag">{a.type}</span></div>
            <div className="auto-meta">
              <span title={a.schedule_raw !== a.schedule_human ? a.schedule_raw : undefined}>{a.schedule_human}</span>
              {next ? <> · prossima {next}</> : null}
              {a.last_run ? <> · ultima {fmtAge(a.last_run, now)}</> : null}
              {showName ? <> · <span className="mono">{a.name}</span></> : null}
            </div>
          </div>
          <span className={`auto-chev${open ? ' open' : ''}`}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
          </span>
        </div>
        {open && (
          <div className="auto-detail">
            {a.explanation ? <p>{a.explanation}</p> : null}
            <dl>
              {detail.map(([k, v, mono]) => (
                <React.Fragment key={k}>
                  <dt>{k}</dt><dd className={mono ? 'mono' : undefined}>{v}</dd>
                </React.Fragment>
              ))}
            </dl>
          </div>
        )}
      </>
    );
  }

  function HostBlock({ host, meta, items, now, q }) {
    const custom = items.filter(a => a.category !== 'os');
    const os = items.filter(a => a.category === 'os');
    if (q && !custom.length && !os.length) return null;
    const badge = meta?.status || 'ok';
    return (
      <div className="auto-host">
        <div className="auto-host-h">
          <span>{host}</span>
          <span className={`auto-badge ${badge}`}>{badge}{meta?.error ? ` · ${meta.error}` : ''}</span>
          <span className="auto-sub">{custom.length} job</span>
        </div>
        {custom.map(a => <Row key={a.id} a={a} now={now} />)}
        {os.length > 0 && (
          <details className="auto-os" open={!!q}>
            <summary>{os.length} job di sistema (OS)</summary>
            {os.map(a => <Row key={a.id} a={a} now={now} />)}
          </details>
        )}
      </div>
    );
  }

  function AutomationsModal({ open, onClose }) {
    const [doc, setDoc] = useState(null);
    const [q, setQ] = useState('');
    const inputRef = useRef(null);
    const reload = useCallback(() => {
      pluginFetch('/api/_p/automations/list').then(setDoc).catch(e => setDoc({ error: String(e) }));
    }, []);
    useEffect(() => {
      if (!open) return;
      setQ('');
      reload();
      setTimeout(() => inputRef.current?.focus(), 50);
      const onEsc = e => { if (e.key === 'Escape') onClose(); };
      window.addEventListener('keydown', onEsc);
      return () => window.removeEventListener('keydown', onEsc);
    }, [open, reload, onClose]);

    if (!open) return null;
    const now = doc?.serverNow || Date.now();

    const all = doc?.automations || [];
    const shown = all.filter(a => matches(a, q));
    const groups = {};
    shown.forEach(a => { (groups[a.host] = groups[a.host] || []).push(a); });
    const hostOrder = Object.keys(doc?.hosts || {}).filter(h => groups[h] || (!q && doc.hosts[h]));
    Object.keys(groups).forEach(h => { if (!hostOrder.includes(h)) hostOrder.push(h); });

    const nCustom = all.filter(a => a.category !== 'os').length;
    const nShown = shown.filter(a => a.category !== 'os').length;

    return (
      <div className="modal-scrim" onClick={onClose}>
        <style>{STYLE}</style>
        <div className="modal auto-modal" onClick={e => e.stopPropagation()}>
          <div className="auto-head">
            <div>
              <h3>Automazioni</h3>
              <div className="auto-sub">
                {doc?.generatedAt
                  ? <>aggiornato {fmtAge(doc.generatedAt, now)} · {q ? `${nShown}/${nCustom}` : nCustom} job (esclusi OS)</>
                  : 'caricamento…'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="iconbtn" onClick={reload} aria-label="Ricarica" title="Ricarica">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>
              </button>
              <button className="iconbtn" onClick={onClose} aria-label="Chiudi" title="Chiudi (Esc)">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
          </div>
          <input ref={inputRef} className="auto-filter" value={q} onChange={e => setQ(e.target.value)}
                 placeholder="Filtra per nome, host, tipo, comando…" aria-label="Filtra automazioni" />
          <div className="auto-body">
            {doc?.error && <div className="auto-error">{doc.error}</div>}
            {hostOrder.map(h => (
              <HostBlock key={h} host={h} meta={doc.hosts?.[h]} items={groups[h] || []} now={now} q={q} />
            ))}
            {doc && !doc.error && q && shown.length === 0 && (
              <div className="auto-empty">Nessuna automazione corrisponde a “{q}”.</div>
            )}
          </div>
        </div>
      </div>
    );
  }

  function Launcher() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button className="iconbtn" onClick={() => setOpen(true)} aria-label="Automazioni" title="Automazioni">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
          </svg>
        </button>
        <AutomationsModal open={open} onClose={() => setOpen(false)} />
      </>
    );
  }

  window.__lgboardPlugins = window.__lgboardPlugins || {};
  window.__lgboardPlugins.automations = { id: 'automations', Launcher };
})();
