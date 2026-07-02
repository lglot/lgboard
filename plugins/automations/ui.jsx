// Automations plugin — UI.
//
// Header Launcher (clock) opens a modal listing every scheduled job collected
// across hosts. Read-only. Each job shows a clear title (precomputed by the
// collector via the llm-gateway) with the technical name/schedule beneath; a
// chevron expands a dropdown with the precomputed explanation. No runtime LLM.
//
// Contract (see lgboard public/components.jsx):
//   window.__lgboardPlugins.automations = { id, Launcher }

(function () {
  const { useState, useEffect, useCallback } = React;

  const STYLE = `
  .auto-modal { width: min(960px, 94vw); max-height: 86vh; display: flex; flex-direction: column; }
  .auto-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
  .auto-head h3 { margin: 0; }
  .auto-sub { font-size: 12px; opacity: .7; }
  .auto-body { overflow: auto; }
  .auto-host { margin-bottom: 14px; }
  .auto-host-h { display: flex; align-items: center; gap: 8px; font-weight: 600; margin: 8px 0 4px; }
  .auto-badge { font-size: 11px; padding: 1px 7px; border-radius: 999px; border: 1px solid currentColor; }
  .auto-badge.ok { color: #3fb27f; } .auto-badge.stale { color: #d8a23a; } .auto-badge.unreachable { color: #c0556b; }
  .auto-row { display: grid; grid-template-columns: 14px 1fr 16px; gap: 10px; align-items: center;
    padding: 7px 4px; border-top: 1px solid var(--border, #232843); }
  .auto-row.has-expl { cursor: pointer; }
  .auto-row.has-expl:hover { background: rgba(127,127,127,.05); }
  .auto-dot { width: 9px; height: 9px; border-radius: 50%; }
  .auto-dot.ok { background: #3fb27f; } .auto-dot.fail { background: #c0556b; } .auto-dot.unknown { background: #7b819b; }
  .auto-title { font-weight: 600; }
  .auto-tag { font-size: 10px; text-transform: uppercase; opacity: .5; margin-left: 6px; }
  .auto-meta { font-size: 12px; opacity: .72; }
  .auto-meta .mono, .mono { font-family: ui-monospace, monospace; }
  .auto-chev { transition: transform .15s; opacity: .55; display: inline-flex; }
  .auto-chev.open { transform: rotate(90deg); }
  .auto-expl { margin: 0 4px 6px 24px; padding: 8px 12px; font-size: 13px; line-height: 1.45;
    border-left: 2px solid var(--accent, #6c8cff); background: rgba(127,127,127,.06); border-radius: 0 8px 8px 0; }
  .auto-expl .cmd { margin-top: 6px; font-size: 11px; opacity: .6; word-break: break-all; }
  .auto-os > summary { cursor: pointer; opacity: .6; font-size: 12px; margin-top: 8px; }
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
    return `${Math.round(m / 60)}h fa`;
  }

  function Row({ a, now }) {
    const [open, setOpen] = useState(false);
    const hasExpl = !!a.explanation;
    const title = a.title || a.name;
    const showName = a.title && a.title !== a.name;
    return (
      <>
        <div className={`auto-row${hasExpl ? ' has-expl' : ''}`}
             onClick={hasExpl ? () => setOpen(o => !o) : undefined}>
          <span className={`auto-dot ${a.last_status || 'unknown'}`} title={a.last_status} />
          <div>
            <div><span className="auto-title">{title}</span><span className="auto-tag">{a.type}</span></div>
            <div className="auto-meta">
              {a.schedule_human}
              {a.last_run ? <> · ultimo {fmtAge(a.last_run, now)}</> : null}
              {showName ? <> · <span className="mono">{a.name}</span></> : null}
            </div>
          </div>
          {hasExpl ? (
            <span className={`auto-chev${open ? ' open' : ''}`}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
            </span>
          ) : <span />}
        </div>
        {open && hasExpl && (
          <div className="auto-expl">
            <div>{a.explanation}</div>
            {a.command ? <div className="cmd mono">{a.command}</div> : null}
          </div>
        )}
      </>
    );
  }

  function HostBlock({ host, meta, items, now }) {
    const custom = items.filter(a => a.category !== 'os');
    const os = items.filter(a => a.category === 'os');
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
          <details className="auto-os">
            <summary>{os.length} job di sistema (OS)</summary>
            {os.map(a => <Row key={a.id} a={a} now={now} />)}
          </details>
        )}
      </div>
    );
  }

  function AutomationsModal({ open, onClose }) {
    const [doc, setDoc] = useState(null);
    const reload = useCallback(() => {
      pluginFetch('/api/_p/automations/list').then(setDoc).catch(e => setDoc({ error: String(e) }));
    }, []);
    useEffect(() => { if (open) reload(); }, [open, reload]);

    if (!open) return null;
    const now = doc?.serverNow || Date.now();

    const groups = {};
    (doc?.automations || []).forEach(a => { (groups[a.host] = groups[a.host] || []).push(a); });
    const hostOrder = Object.keys(doc?.hosts || {}).filter(h => groups[h] || doc.hosts[h]);
    Object.keys(groups).forEach(h => { if (!hostOrder.includes(h)) hostOrder.push(h); });

    const nCustom = (doc?.automations || []).filter(a => a.category !== 'os').length;

    return (
      <div className="modal-scrim" onClick={onClose}>
        <style>{STYLE}</style>
        <div className="modal auto-modal" onClick={e => e.stopPropagation()}>
          <div className="auto-head">
            <div>
              <h3>Automazioni</h3>
              <div className="auto-sub">
                {doc?.generatedAt
                  ? <>aggiornato {fmtAge(doc.generatedAt, now)} · {nCustom} job (esclusi OS) · clic su una riga per la spiegazione</>
                  : 'caricamento…'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="iconbtn" onClick={reload} aria-label="Ricarica" title="Ricarica">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>
              </button>
              <button className="iconbtn" onClick={onClose} aria-label="Chiudi">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
          </div>
          <div className="auto-body">
            {doc?.error && <div className="auto-expl" style={{ borderColor: '#c0556b' }}>{doc.error}</div>}
            {hostOrder.map(h => (
              <HostBlock key={h} host={h} meta={doc.hosts?.[h]} items={groups[h] || []} now={now} />
            ))}
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
