// Host status plugin - UI.
//
// Header Launcher (activity) opens a modal with two things that today only
// exist inside logs and Slack DMs: whether the host is healthy (NFS mounts and
// Hermes binaries, the same checks as host-health-check.sh) and what the
// alerts aggregator has been doing (configured alerts + recent runs).
// Read-only, green when everything is fine, loud about what is broken.
//
// Contract (see lgboard public/components.jsx):
//   window.__lgboardPlugins['host-status'] = { id, Launcher }

(function () {
  const { useState, useEffect, useCallback } = React;

  const STYLE = `
  .hs-modal { width: min(880px, 94vw); max-height: 86vh; display: flex; flex-direction: column; }
  .hs-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
  .hs-head h3 { margin: 0; }
  .hs-sub { font-size: 12px; color: var(--ink-mid); }
  .hs-body { overflow: auto; }
  .hs-banner { display: flex; align-items: flex-start; gap: 10px; padding: 12px 14px; border-radius: 10px;
    border: 1px solid var(--line); background: var(--accent-softer); margin-bottom: 16px; }
  .hs-banner.ok { border-color: color-mix(in oklab, var(--up, #3fb27f) 45%, var(--line));
    background: color-mix(in oklab, var(--up, #3fb27f) 8%, transparent); }
  .hs-banner.fail { border-color: color-mix(in oklab, var(--down, #c0556b) 55%, var(--line));
    background: color-mix(in oklab, var(--down, #c0556b) 8%, transparent); }
  .hs-banner-t { font-weight: 600; font-size: 14px; }
  .hs-banner.ok .hs-banner-t { color: var(--up, #3fb27f); }
  .hs-banner.fail .hs-banner-t { color: var(--down, #c0556b); }
  .hs-banner ul { margin: 6px 0 0; padding-left: 18px; }
  .hs-banner li { font-size: 13px; line-height: 1.5; color: var(--ink); }
  .hs-sect { margin-bottom: 16px; }
  .hs-sect-h { display: flex; align-items: baseline; gap: 8px; margin: 0 0 2px;
    font-family: var(--ff-mono); text-transform: uppercase; font-size: 10.5px;
    letter-spacing: .09em; color: var(--ink-soft); }
  .hs-sect-h span { margin-left: auto; text-transform: none; letter-spacing: 0;
    font-size: 11px; opacity: .75; }
  .hs-row { display: grid; grid-template-columns: 14px 1fr auto; gap: 10px; align-items: center;
    padding: 7px 4px; border-top: 1px solid var(--line-2); }
  .hs-row.bad { background: color-mix(in oklab, var(--down, #c0556b) 7%, transparent); }
  .hs-dot { width: 9px; height: 9px; border-radius: 50%; }
  .hs-dot.ok { background: var(--up, #3fb27f); }
  .hs-dot.fail { background: var(--down, #c0556b); }
  .hs-dot.off, .hs-dot.skip { background: var(--ink-soft, #7b819b); }
  .hs-dot.unknown { background: var(--idle, #d8a23a); }
  .hs-name { font-weight: 600; }
  .hs-meta { font-size: 12px; color: var(--ink-mid); }
  .hs-bad { font-size: 12px; color: var(--down, #c0556b); }
  .hs-right { font-size: 12px; color: var(--ink-mid); text-align: right; white-space: nowrap; }
  .hs-mono, .hs-meta .hs-mono { font-family: var(--ff-mono); }
  .hs-tag { font-family: var(--ff-mono); font-size: 10px; text-transform: uppercase;
    letter-spacing: .06em; color: var(--ink-soft); margin-left: 6px; }
  .hs-log { margin-top: 4px; }
  .hs-log > summary { cursor: pointer; color: var(--ink-mid); font-size: 12px; }
  .hs-log-line { display: grid; grid-template-columns: 130px 120px 1fr; gap: 10px;
    font-family: var(--ff-mono); font-size: 11.5px; padding: 3px 4px;
    border-top: 1px solid var(--line-2); color: var(--ink-mid); }
  .hs-log-line.bad { color: var(--down, #c0556b); }
  .hs-log-line b { color: var(--ink); font-weight: 600; }
  .hs-log-msg { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .hs-error { margin: 4px 0 10px; padding: 8px 12px; font-size: 13px;
    border: 1px solid var(--down, #c0556b); border-radius: 8px; color: var(--down, #c0556b); }
  .hs-empty { padding: 18px 4px; text-align: center; color: var(--ink-mid); font-size: 13px; }
  @media (max-width: 620px) { .hs-log-line { grid-template-columns: 1fr; gap: 0; } }
  `;

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

  function fmtRead(ms) {
    const s = Math.round((Date.now() - ms) / 1000);
    return s < 5 ? 'ora' : fmtAge(ms, Date.now());
  }

  function fmtSize(b) {
    if (b == null) return '';
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
    return `${(b / 1024 / 1024).toFixed(1)} MB`;
  }

  function Row({ status, name, tag, meta, problem, right }) {
    return (
      <div className={`hs-row${status === 'fail' ? ' bad' : ''}`}>
        <span className={`hs-dot ${status}`} title={status} />
        <div>
          <div><span className="hs-name">{name}</span>{tag ? <span className="hs-tag">{tag}</span> : null}</div>
          {problem ? <div className="hs-bad">{problem}</div> : null}
          {meta ? <div className="hs-meta">{meta}</div> : null}
        </div>
        <div className="hs-right">{right}</div>
      </div>
    );
  }

  function MountRow({ m }) {
    const meta = m.mounted
      ? <><span className="hs-mono">{m.source}</span> · {m.fstype}</>
      : <><span className="hs-mono">{m.declared}</span> · dichiarato in fstab come {m.fstab}</>;
    const right = m.readable ? `${m.entries} voci · ${m.probeMs} ms` : (m.mounted ? `${m.probeMs} ms` : 'non montato');
    return <Row status={m.status} name={m.mountpoint} meta={meta} problem={m.problem} right={right} />;
  }

  function BinRow({ b, now }) {
    return (
      <Row status={b.status} name={b.name} tag={b.machine}
           problem={b.problem}
           meta={<>{b.executable ? 'eseguibile' : 'non eseguibile'} · {fmtSize(b.sizeBytes)} · agg. {fmtAge(b.mtime, now)}</>}
           right={b.status === 'skip' ? 'script' : b.machine} />
    );
  }

  function AlertRow({ a, now }) {
    const last = a.lastAt
      ? <>ultima {fmtAge(a.lastAt, now)} · rc={a.lastRc}</>
      : <>mai eseguito nel log</>;
    const meta = <>{a.description}{a.lastMessage ? <> · <span className="hs-mono">{a.lastMessage}</span></> : null}</>;
    return (
      <Row status={a.status} name={a.name} tag={a.enabled ? a.schedule : 'disabilitato'}
           meta={meta}
           problem={a.status === 'fail' ? `ultima esecuzione fallita (rc=${a.lastRc}): ${a.lastMessage || 'nessun messaggio'}` : null}
           right={<>{last}<br />{a.lines24h} {a.lines24h === 1 ? 'riga' : 'righe'} log/24h{a.fails24h ? `, ${a.fails24h} ko` : ''}</>} />
    );
  }

  function StatusModal({ open, onClose }) {
    const [doc, setDoc] = useState(null);
    const [loading, setLoading] = useState(false);
    const reload = useCallback(() => {
      setLoading(true);
      fetch('/api/_p/host-status/overview', { cache: 'no-store' })
        .then(r => r.json())
        .then(d => { setDoc(d); setLoading(false); })
        .catch(e => { setDoc({ error: String(e) }); setLoading(false); });
    }, []);
    // Kept apart from the Esc listener: onClose changes identity on every parent
    // render, and folding both in one effect refetches once per stats poll.
    useEffect(() => { if (open) reload(); }, [open, reload]);
    useEffect(() => {
      if (!open) return;
      const onEsc = e => { if (e.key === 'Escape') onClose(); };
      window.addEventListener('keydown', onEsc);
      return () => window.removeEventListener('keydown', onEsc);
    }, [open, onClose]);

    if (!open) return null;
    const now = doc?.serverNow || Date.now();
    const health = doc?.health;
    const alerts = doc?.alerts;
    const problems = health?.problems || [];
    const failing = alerts?.failing || [];
    const issues = problems
      .concat(failing.map(n => `alert ${n}: ultima esecuzione fallita`))
      .concat(alerts?.error ? ['stato degli alert non leggibile'] : []);
    const healthy = doc && !doc.error && issues.length === 0;

    return (
      <div className="modal-scrim" onClick={onClose}>
        <style>{STYLE}</style>
        <div className="modal hs-modal" onClick={e => e.stopPropagation()}>
          <div className="hs-head">
            <div>
              <h3>Stato host</h3>
              <div className="hs-sub">
                {doc ? <>{doc.host} · letto {loading ? 'in corso…' : fmtRead(doc.serverNow)}</> : 'caricamento…'}
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

          <div className="hs-body">
            {doc?.error && <div className="hs-error">{doc.error}</div>}
            {alerts?.error && <div className="hs-error">{alerts.error}</div>}

            {doc && !doc.error && (
              <div className={`hs-banner ${healthy ? 'ok' : 'fail'}`}>
                <span className={`hs-dot ${healthy ? 'ok' : 'fail'}`} style={{ marginTop: 5 }} />
                <div>
                  <div className="hs-banner-t">
                    {healthy ? 'Tutto sano' : `${issues.length} ${issues.length === 1 ? 'problema' : 'problemi'}`}
                  </div>
                  {healthy
                    ? <div className="hs-meta">mount NFS leggibili, binari Hermes con l architettura giusta, nessun alert fallito</div>
                    : <ul>{issues.map((p, i) => <li key={i}>{p}</li>)}</ul>}
                </div>
              </div>
            )}

            {health && (
              <div className="hs-sect">
                <div className="hs-sect-h">Mount NFS<span>{health.mounts.length} da fstab</span></div>
                {health.mounts.map(m => <MountRow key={m.mountpoint} m={m} />)}
                {health.mounts.length === 0 && <div className="hs-empty">Nessun mount NFS in fstab.</div>}
              </div>
            )}

            {health && (
              <div className="hs-sect">
                <div className="hs-sect-h">Binari Hermes<span>{health.binDir} · arch nativa {health.nativeMachine}</span></div>
                {health.binaries.map(b => <BinRow key={b.name} b={b} now={now} />)}
                {health.binaries.length === 0 && <div className="hs-empty">Nessun binario.</div>}
              </div>
            )}

            {alerts && (
              <div className="hs-sect">
                <div className="hs-sect-h">Alert configurati<span>{alerts.configured.length} in alerts.toml · {alerts.tz}</span></div>
                {alerts.configured.map(a => <AlertRow key={a.name} a={a} now={now} />)}
                {alerts.configured.length === 0 && <div className="hs-empty">Nessun alert configurato.</div>}
              </div>
            )}

            {alerts && alerts.recent.length > 0 && (
              <details className="hs-log">
                <summary>Ultime esecuzioni dal log (max {alerts.runsPerAlert} per alert)</summary>
                {alerts.recent.map((r, i) => (
                  <div key={i} className={`hs-log-line${r.rc !== 0 ? ' bad' : ''}`}>
                    <span>{r.ts}</span><b>{r.name}</b>
                    <span className="hs-log-msg" title={r.message}>
                      {r.rc !== 0 ? `rc=${r.rc} ` : ''}{r.message || '(nessun output)'}
                    </span>
                  </div>
                ))}
              </details>
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
        <button className="iconbtn" onClick={() => setOpen(true)} aria-label="Stato host" title="Stato host e alert">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12h4l2.5 6 5-13 2.5 7h4" />
          </svg>
        </button>
        <StatusModal open={open} onClose={() => setOpen(false)} />
      </>
    );
  }

  window.__lgboardPlugins = window.__lgboardPlugins || {};
  window.__lgboardPlugins['host-status'] = { id: 'host-status', Launcher };
})();
