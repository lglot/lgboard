// Host status plugin - UI.
//
// The home card answers the only question that matters (is the host healthy?);
// the surface it opens shows the two things that today only exist inside logs
// and Slack DMs: the health checks (NFS mounts from fstab, ELF architecture of
// the Hermes binaries, same checks as host-health-check.sh) and what the alerts
// aggregator has been doing (configured alerts + their recent runs).
// Read-only, green when everything is fine, loud about what is broken.
//
// Contract (see lgboard public/components.jsx):
//   window.__lgboardPlugins['host-status'] = { id, useSignal, Surface }

(function () {
  const { useState, useEffect, useCallback, useMemo } = React;

  const MIN = 60_000, HOUR = 3_600_000;
  const ENDPOINT = '/api/_p/host-status/overview';

  /* ---- cron helpers: the alert sparkline is the schedule's expected fires ----
     Duplicated from the automations plugin on purpose: a plugin has to stand on
     its own, and this is a pure function of its alerts.toml schedules. */
  function field(spec, lo, hi) {
    const out = new Set();
    for (const part of String(spec).split(',')) {
      const [range, stepRaw] = part.split('/');
      const step = stepRaw ? parseInt(stepRaw, 10) : 1;
      if (!isFinite(step) || step <= 0) return null;
      let from = lo, to = hi;
      if (range !== '*') {
        const bits = range.split('-');
        from = parseInt(bits[0], 10);
        to = bits[1] != null ? parseInt(bits[1], 10) : (stepRaw ? hi : from);
      }
      if (!isFinite(from) || !isFinite(to)) return null;
      for (let v = from; v <= to; v += step) out.add(v);
    }
    return out;
  }

  function parseCron(c) {
    const p = String(c || '').trim().split(/\s+/);
    if (p.length < 5) return null;
    const min = field(p[0], 0, 59), hour = field(p[1], 0, 23), dow = field(p[4], 0, 6);
    if (!min || !hour || !dow) return null;
    return { min, hour, dow };
  }

  const hits = (spec, d) => spec.min.has(d.getMinutes()) && spec.hour.has(d.getHours()) && spec.dow.has(d.getDay());

  function nextFire(cron, from, withinMin) {
    const spec = parseCron(cron);
    if (!spec) return null;
    const d = new Date(from);
    d.setSeconds(0, 0);
    for (let i = 1; i <= withinMin; i++) {
      d.setTime(d.getTime() + MIN);
      if (hits(spec, d)) return d.getTime();
    }
    return null;
  }

  // Expected fires per hour over the last 24h — oldest bucket first.
  function hourly24(cron, now) {
    const spec = parseCron(cron);
    if (!spec) return null;
    const out = [];
    const start = new Date(now - 23 * HOUR);
    start.setMinutes(0, 0, 0);
    for (let h = 0; h < 24; h++) {
      let n = 0;
      const base = new Date(start.getTime() + h * HOUR);
      for (let m = 0; m < 60; m++) {
        const d = new Date(base.getTime() + m * MIN);
        if (d.getTime() <= now && hits(spec, d)) n++;
      }
      out.push(n);
    }
    return out;
  }

  /* ---------------- formatting ---------------- */
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

  const fmtIn = (ms, now) => {
    const m = Math.max(0, Math.round((ms - now) / MIN));
    return m < 60 ? `tra ${m}m` : `tra ${Math.round(m / 60)}h`;
  };
  const fmtAbs = (ms) => new Date(ms).toLocaleString('it-IT',
    { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const fmtClock = (ms) => new Date(ms).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

  function fmtSize(b) {
    if (b == null) return '';
    if (b < 1024) return `${b} B`;
    if (b < 1048576) return `${(b / 1024).toFixed(0)} KB`;
    return `${(b / 1048576).toFixed(1)} MB`;
  }

  /* ---------------- data ---------------- */
  // `active` keeps the closed surface from polling: the home card is the only
  // reader until the user opens it.
  function useOverview(active, intervalMs) {
    const [doc, setDoc] = useState(null);
    const reload = useCallback(() => {
      fetch(ENDPOINT, { cache: 'no-store' })
        .then(r => r.json())
        .then(setDoc)
        .catch(e => setDoc({ error: String(e) }));
    }, []);
    useEffect(() => {
      if (!active) return;
      reload();
      const id = setInterval(reload, intervalMs);
      return () => clearInterval(id);
    }, [active, reload, intervalMs]);
    return [doc, reload];
  }

  const dotFor = (status) => status === 'ok' ? 'up' : status === 'fail' ? 'down' : 'unknown';

  const Spark = ({ series, title }) => {
    const max = Math.max(1, ...series);
    return (
      <span className="pm-spark" title={title}>
        {series.map((v, i) => (
          <i key={i} className={v === 0 ? 'zero' : v === max ? 'hot' : ''}
            style={{ height: `${v === 0 ? 8 : 8 + (v / max) * 92}%` }} />
        ))}
      </span>
    );
  };

  /* ---------------- rows ---------------- */
  // States one fact and hides the rest behind the chevron.
  function FactRow({ status, name, tag, value, problem, facts }) {
    const [open, setOpen] = useState(false);
    const toggle = () => setOpen(o => !o);
    return (
      <>
        <div className={`pm-row click${open ? ' open' : ''}${status === 'fail' ? ' bad' : ''}`}
          role="button" tabIndex={0} aria-expanded={open} onClick={toggle}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}>
          <span className={`dot dot-${dotFor(status)}`} />
          <div className="pm-main">
            <div className="pm-name">{name}{tag ? <span className="pm-tag">{tag}</span> : null}</div>
          </div>
          <div className="pm-right"><b>{value}</b></div>
          <PluginChevron open={open} />
        </div>
        {open && (
          <div className="pm-detail">
            {problem ? <p>{problem}</p> : null}
            <dl>
              {facts.filter(Boolean).map(([k, v, mono]) => (
                <React.Fragment key={k}><dt>{k}</dt><dd className={mono ? 'mono' : undefined}>{v}</dd></React.Fragment>
              ))}
            </dl>
          </div>
        )}
      </>
    );
  }

  function AlertRow({ a, runs, now, series }) {
    const [open, setOpen] = useState(false);
    const toggle = () => setOpen(o => !o);
    const bad = a.status === 'fail';
    const next = a.enabled ? nextFire(a.schedule, now, 24 * 60) : null;
    return (
      <>
        <div className={`pm-row click${bad ? ' bad' : ''}${open ? ' open' : ''}`}
          role="button" tabIndex={0} aria-expanded={open} onClick={toggle}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}>
          <span className={`dot dot-${bad ? 'down' : a.enabled ? dotFor(a.status) : 'unknown'}`} />
          <div className="pm-main">
            <div className="pm-name">{a.name}<span className="pm-tag">{a.enabled ? a.schedule : 'disabilitato'}</span></div>
          </div>
          <div className="pm-right">
            {series ? <Spark series={series} title="esecuzioni previste per ora, ultime 24h" /> : null}
            <b>{fmtAge(a.lastAt, now)}</b>
          </div>
          <PluginChevron open={open} />
        </div>
        {open && (
          <div className="pm-detail">
            {a.description ? <p>{a.description}</p> : null}
            <dl>
              <dt>ultima</dt>
              <dd>{a.lastAt ? `${fmtAbs(a.lastAt)} · rc=${a.lastRc}` : 'mai eseguito nel log'}</dd>
              <dt>volume 24h</dt>
              <dd>{a.lines24h} {a.lines24h === 1 ? 'riga' : 'righe'} di log{a.fails24h ? ` · ${a.fails24h} fallite` : ' · nessuna fallita'}</dd>
              <dt>messaggio</dt><dd className="mono">{a.lastMessage || '(nessun output)'}</dd>
              <dt>schedule</dt><dd className="mono">{a.schedule || '—'}</dd>
              <dt>prossima</dt>
              <dd>{next ? `${fmtIn(next, now)} — ${fmtClock(next)}` : 'non entro 24h'}</dd>
              {a.command ? <><dt>comando</dt><dd className="mono">{a.command}</dd></> : null}
            </dl>
            {runs.length > 0 && (
              <div className="pm-runs">
                <div className="pm-runs-h">ultime {runs.length} esecuzioni</div>
                {runs.map((r, i) => (
                  <div key={i} className={`pm-run${r.rc !== 0 ? ' bad' : ''}`}>
                    <span>{r.ts}</span>
                    <span title={r.message}>{r.rc !== 0 ? `rc=${r.rc} ` : ''}{r.message || '(nessun output)'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </>
    );
  }

  /* ---------------- surface ---------------- */
  function Surface({ open, onClose }) {
    const [doc, reload] = useOverview(open, 60_000);
    const alerts = doc?.alerts;
    const now = doc?.serverNow || Date.now();
    const series = useMemo(() => {
      const out = {};
      for (const a of (alerts?.configured || [])) out[a.name] = a.enabled ? hourly24(a.schedule, now) : null;
      return out;
    }, [alerts, now]);

    if (!open) return null;

    const health = doc?.health;
    const issues = (health?.problems || [])
      .concat((alerts?.failing || []).map(n => `alert ${n}: ultima esecuzione fallita`))
      .concat(alerts?.error ? ['stato degli alert non leggibile'] : []);
    const healthy = doc && !doc.error && issues.length === 0;
    const mountsOk = (health?.mounts || []).filter(m => m.status === 'ok').length;
    const binsOk = (health?.binaries || []).filter(b => b.status === 'ok').length;
    const koAlerts = (alerts?.configured || []).filter(a => a.status === 'fail').length;
    const lines24h = (alerts?.configured || []).reduce((n, a) => n + (a.lines24h || 0), 0);

    return (
      <div className="modal-scrim" onClick={onClose}>
        <PluginModal icon="pulse" tone={doc && !healthy ? 'down' : null} title="Stato host"
          sub={doc ? `${doc.host} · letto ${fmtAge(doc.serverNow, Date.now())}` : 'caricamento…'}
          onReload={reload} onClose={onClose}
          kpis={doc && !doc.error ? [
            { label: 'Mount NFS', value: mountsOk, of: `/${health?.mounts.length ?? 0}`,
              tone: mountsOk === (health?.mounts.length ?? 0) ? 'ok' : 'down' },
            { label: 'Binari Hermes', value: binsOk, of: `/${health?.binaries.length ?? 0}`,
              tone: binsOk === (health?.binaries.length ?? 0) ? 'ok' : 'down' },
            { label: 'Alert falliti', value: koAlerts, of: `/${alerts?.configured.length ?? 0}`,
              tone: koAlerts ? 'down' : 'ok' },
            { label: 'Righe log 24h', value: lines24h },
          ] : null}>

          {doc?.error && <div className="pm-error">{doc.error}</div>}
          {alerts?.error && <div className="pm-error">{alerts.error}</div>}

          {doc && !doc.error && (
            <div className={`pm-banner ${healthy ? 'ok' : 'fail'}`}>
              <span className={`dot dot-${healthy ? 'up' : 'down'}`} style={{ width: 10, height: 10 }} />
              <div>
                <div className="pm-banner-t">
                  {healthy ? 'Tutto sano' : `${issues.length} ${issues.length === 1 ? 'problema' : 'problemi'}`}
                </div>
                {healthy
                  ? <div className="pm-banner-s">Mount NFS leggibili, binari Hermes sull'architettura giusta, nessun alert fallito.</div>
                  : <ul>{issues.map((p, i) => <li key={i}>{p}</li>)}</ul>}
              </div>
            </div>
          )}

          {health && (
            <div className="pm-sect">
              <div className="pm-sect-h">
                <h4>Mount NFS</h4><span className="count">{health.mounts.length}</span>
                <span className="pm-sect-note">da /etc/fstab</span>
              </div>
              {health.mounts.map(m => (
                <FactRow key={m.mountpoint} status={m.status} name={m.mountpoint} tag={m.fstype || m.fstab}
                  value={m.readable ? `${m.entries} voci` : (m.mounted ? 'illeggibile' : 'non montato')}
                  problem={m.problem}
                  facts={[
                    ['sorgente', m.mounted ? m.source : m.declared, true],
                    ['tipo', m.fstype || m.fstab, true],
                    m.probeMs != null ? ['lettura', `${m.probeMs} ms`, false] : null,
                    ['stato', m.mounted
                      ? (m.readable ? 'montato e leggibile' : 'montato ma illeggibile')
                      : 'dichiarato in fstab, non montato', false],
                  ]} />
              ))}
              {health.mounts.length === 0 && <div className="pm-empty">Nessun mount NFS in fstab.</div>}
            </div>
          )}

          {health && (
            <div className="pm-sect">
              <div className="pm-sect-h">
                <h4>Binari Hermes</h4><span className="count">{health.binaries.length}</span>
                <span className="pm-sect-note">arch nativa {health.nativeMachine}</span>
              </div>
              {health.binaries.map(b => (
                <FactRow key={b.name} status={b.status} name={b.name} tag={b.machine}
                  value={fmtSize(b.sizeBytes)} problem={b.problem}
                  facts={[
                    ['percorso', `${health.binDir}/${b.name}`, true],
                    ['arch', `${b.machine} · nativa ${health.nativeMachine}`, false],
                    ['modo', b.executable ? 'eseguibile' : 'non eseguibile', false],
                    ['aggiornato', `${fmtAge(b.mtime, now)} — ${fmtAbs(b.mtime)}`, false],
                  ]} />
              ))}
              {health.binaries.length === 0 && <div className="pm-empty">Nessun binario.</div>}
            </div>
          )}

          {alerts && (
            <div className="pm-sect">
              <div className="pm-sect-h">
                <h4>Alert</h4><span className="count">{alerts.configured.length}</span>
                <span className="pm-sect-note">alerts.toml · {alerts.tz}</span>
              </div>
              {alerts.configured.map(a => (
                <AlertRow key={a.name} a={a} now={now} series={series[a.name]}
                  runs={alerts.recent.filter(r => r.name === a.name).slice(0, alerts.runsPerAlert)} />
              ))}
              {alerts.configured.length === 0 && <div className="pm-empty">Nessun alert configurato.</div>}
            </div>
          )}

          {alerts && alerts.recent.length > 0 && (
            <details className="pm-more">
              <summary>Tutte le esecuzioni registrate ({alerts.recent.length})</summary>
              {alerts.recent.map((r, i) => (
                <div key={i} className={`pm-run${r.rc !== 0 ? ' bad' : ''}`}
                  style={{ gridTemplateColumns: '122px 130px 1fr' }}>
                  <span>{r.ts}</span><span style={{ color: 'var(--ink)' }}>{r.name}</span>
                  <span title={r.message}>{r.rc !== 0 ? `rc=${r.rc} ` : ''}{r.message || '(nessun output)'}</span>
                </div>
              ))}
            </details>
          )}
        </PluginModal>
      </div>
    );
  }

  /* ---------------- home card ---------------- */
  function useSignal() {
    const [doc] = useOverview(true, 60_000);
    if (!doc) return null;
    if (doc.error) return { tone: 'down', dot: 'down', value: 'stato non leggibile', meta: doc.error };
    const { health, alerts } = doc;
    const issues = (health?.problems || []).length
      + (alerts?.failing || []).length
      + (alerts?.error ? 1 : 0);
    return {
      tone: issues ? 'down' : 'ok',
      dot: issues ? 'down' : 'up',
      value: issues ? `${issues} ${issues === 1 ? 'problema' : 'problemi'}` : 'Tutto sano',
      meta: `${health?.mounts.length ?? 0} mount · ${health?.binaries.length ?? 0} binari · ${alerts?.configured.length ?? 0} alert`,
    };
  }

  window.__lgboardPlugins = window.__lgboardPlugins || {};
  window.__lgboardPlugins['host-status'] = { id: 'host-status', useSignal, Surface };
})();
