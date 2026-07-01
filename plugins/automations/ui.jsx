// Automations plugin — UI.
//
// Registers a header Launcher (clock button) that opens a modal listing every
// scheduled job collected across hosts. Read-only: shows status, schedule, last
// run, and offers LLM "explain / overlap / failures" reports. No edit.
//
// Contract (see lgboard public/components.jsx):
//   window.__lgboardPlugins.automations = { id, Launcher }
// The host renders <Launcher/> in the header (PluginLaunchers).

(function () {
  const { useState, useEffect, useCallback } = React;

  const STYLE = `
  .auto-modal { width: min(960px, 94vw); max-height: 86vh; display: flex; flex-direction: column; }
  .auto-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
  .auto-head h3 { margin: 0; }
  .auto-sub { font-size: 12px; opacity: .7; }
  .auto-toolbar { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
  .auto-btn { font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 8px;
    border: 1px solid var(--border, #2a2f45); background: transparent; color: inherit; cursor: pointer; }
  .auto-btn:hover { border-color: var(--accent, #6c8cff); }
  .auto-llm { border: 1px solid var(--border, #2a2f45); border-radius: 10px; padding: 10px 12px;
    margin-bottom: 12px; font-size: 13px; white-space: pre-wrap; background: rgba(127,127,127,.06); }
  .auto-llm.err { border-color: #c0556b; }
  .auto-body { overflow: auto; }
  .auto-host { margin-bottom: 14px; }
  .auto-host-h { display: flex; align-items: center; gap: 8px; font-weight: 600; margin: 8px 0 4px; }
  .auto-badge { font-size: 11px; padding: 1px 7px; border-radius: 999px; border: 1px solid currentColor; }
  .auto-badge.ok { color: #3fb27f; } .auto-badge.stale { color: #d8a23a; } .auto-badge.unreachable { color: #c0556b; }
  .auto-row { display: grid; grid-template-columns: 14px 1fr auto; gap: 10px; align-items: center;
    padding: 6px 4px; border-top: 1px solid var(--border, #232843); }
  .auto-dot { width: 9px; height: 9px; border-radius: 50%; }
  .auto-dot.ok { background: #3fb27f; } .auto-dot.fail { background: #c0556b; } .auto-dot.unknown { background: #7b819b; }
  .auto-name { font-weight: 600; }
  .auto-meta { font-size: 12px; opacity: .72; }
  .auto-meta .mono { font-family: ui-monospace, monospace; }
  .auto-tag { font-size: 10px; text-transform: uppercase; opacity: .55; margin-left: 6px; }
  .auto-explain { font: inherit; font-size: 11px; padding: 2px 8px; border-radius: 7px;
    border: 1px solid var(--border, #2a2f45); background: transparent; color: inherit; cursor: pointer; }
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

  function Row({ a, now, onExplain, llmOff }) {
    return (
      <div className="auto-row">
        <span className={`auto-dot ${a.last_status || 'unknown'}`} title={a.last_status} />
        <div>
          <div><span className="auto-name">{a.name}</span><span className="auto-tag">{a.type}</span></div>
          <div className="auto-meta">
            {a.schedule_human}
            {a.last_run ? <> · ultimo {fmtAge(a.last_run, now)}</> : null}
            {a.command ? <> · <span className="mono">{a.command.length > 70 ? a.command.slice(0, 70) + '…' : a.command}</span></> : null}
          </div>
        </div>
        {!llmOff && a.type !== 'service' && (
          <button className="auto-explain" onClick={() => onExplain('explain', a.id)} title="Spiega con l'LLM">spiega</button>
        )}
      </div>
    );
  }

  function HostBlock({ host, meta, items, now, onExplain, llmOff }) {
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
        {custom.map(a => <Row key={a.id} a={a} now={now} onExplain={onExplain} llmOff={llmOff} />)}
        {os.length > 0 && (
          <details className="auto-os">
            <summary>{os.length} job di sistema (OS)</summary>
            {os.map(a => <Row key={a.id} a={a} now={now} onExplain={onExplain} llmOff={llmOff} />)}
          </details>
        )}
      </div>
    );
  }

  function AutomationsModal({ open, onClose }) {
    const [doc, setDoc] = useState(null);
    const [llm, setLlm] = useState(null);     // { text } | { error } | { loading }
    const [llmOff, setLlmOff] = useState(false);

    const reload = useCallback(() => {
      pluginFetch('/api/_p/automations/list').then(setDoc).catch(e => setDoc({ error: String(e) }));
    }, []);

    useEffect(() => { if (open) reload(); }, [open, reload]);

    const runReport = useCallback((report, id) => {
      setLlm({ loading: true });
      const qs = id ? `?report=${report}&id=${encodeURIComponent(id)}` : `?report=${report}`;
      pluginFetch('/api/_p/automations/explain' + qs).then(r => {
        if (r.available === false) { setLlmOff(true); setLlm({ error: 'LLM non configurato (manca ANTHROPIC_API_KEY)' }); return; }
        if (r.error) { setLlm({ error: r.error }); return; }
        setLlm({ text: r.text });
      }).catch(e => setLlm({ error: String(e) }));
    }, []);

    if (!open) return null;
    const now = doc?.serverNow || Date.now();

    // group by host, hosts with metadata first in a stable order
    const groups = {};
    (doc?.automations || []).forEach(a => { (groups[a.host] = groups[a.host] || []).push(a); });
    const hostOrder = Object.keys(doc?.hosts || {}).filter(h => groups[h] || doc.hosts[h]);
    Object.keys(groups).forEach(h => { if (!hostOrder.includes(h)) hostOrder.push(h); });

    return (
      <div className="modal-scrim" onClick={onClose}>
        <style>{STYLE}</style>
        <div className="modal auto-modal" onClick={e => e.stopPropagation()}>
          <div className="auto-head">
            <div>
              <h3>Automazioni</h3>
              <div className="auto-sub">
                {doc?.generatedAt ? <>aggiornato {fmtAge(doc.generatedAt, now)} · {(doc.automations || []).filter(a => a.category !== 'os').length} job (esclusi OS)</> : 'caricamento…'}
              </div>
            </div>
            <button className="iconbtn" onClick={onClose} aria-label="Chiudi">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>

          {!llmOff && (
            <div className="auto-toolbar">
              <button className="auto-btn" onClick={() => runReport('overlap')}>Trova overlap/race</button>
              <button className="auto-btn" onClick={() => runReport('failures')}>Job che falliscono</button>
              <button className="auto-btn" onClick={reload}>↻ Ricarica</button>
            </div>
          )}

          {llm && (
            <div className={`auto-llm ${llm.error ? 'err' : ''}`}>
              {llm.loading ? 'Analisi in corso…' : (llm.error || llm.text)}
            </div>
          )}

          <div className="auto-body">
            {doc?.error && <div className="auto-llm err">{doc.error}</div>}
            {hostOrder.map(h => (
              <HostBlock key={h} host={h} meta={doc.hosts?.[h]} items={groups[h] || []} now={now} onExplain={runReport} llmOff={llmOff} />
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
