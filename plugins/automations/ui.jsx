// Automations plugin — UI.
//
// The home card says how many runs are due in the next hour; the surface it
// opens lists every scheduled job collected across hosts. Read-only. Each job
// shows a clear title (precomputed by the collector via the llm-gateway) with
// the schedule beside it; a row expands into its detail card (explanation,
// schedule, next/last run, log, command). No runtime LLM.
//
// Two views: "Tutti" (per-host inventory) and "Prossima ora" (an agenda of the
// fires due within the hour, grouped by the minute they happen).
//
// Contract (see lgboard public/components.jsx):
//   window.__lgboardPlugins.automations = { id, useSignal, Surface }

(function () {
  const { useState, useEffect, useCallback, useMemo, useRef } = React;

  const MIN = 60_000;
  const ENDPOINT = '/api/_p/automations/list';

  function pluginFetch(path) {
    return fetch(path, { cache: 'no-store' }).then(r => r.json());
  }

  /* ---------------- cron helpers (drive the "next hour" agenda) ---------------- */
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
      if (!isFinite(from) || !isFinite(to)) return null; // named fields (MON, JAN…)
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

  // Only real cron lines can be expanded: systemd timers ship a precomputed
  // next_run instead, and launchd only reports which trigger kind it uses.
  const cronOf = (a) => (a.type === 'cron' ? parseCron(a.schedule_raw) : null);

  // Every fire inside the next `withinMin` minutes (a */10 job fires six times).
  function firesWithin(a, from, withinMin = 60) {
    const spec = cronOf(a);
    if (spec) {
      const out = [];
      const d = new Date(from);
      d.setSeconds(0, 0);
      for (let i = 1; i <= withinMin; i++) {
        d.setTime(d.getTime() + MIN);
        if (hits(spec, d)) out.push(d.getTime());
      }
      return out;
    }
    if (a.next_run && a.next_run > from && a.next_run <= from + withinMin * MIN) return [a.next_run];
    return [];
  }

  const schedulable = (a) => !!cronOf(a) || !!a.next_run;

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

  function fmtIn(ms, now) {
    const s = Math.max(0, Math.round((ms - now) / 1000));
    if (s < 60) return 'ora';
    const m = Math.round(s / 60);
    return m < 60 ? `tra ${m}m` : `tra ${Math.round(m / 60)}h`;
  }

  const fmtAbs = (ms) => new Date(ms).toLocaleString('it-IT',
    { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const fmtClock = (ms) => new Date(ms).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

  function matches(a, q) {
    if (!q) return true;
    const hay = [a.title, a.name, a.host, a.type, a.command, a.schedule_human, a.schedule_raw, a.explanation]
      .filter(Boolean).join(' ').toLowerCase();
    return q.toLowerCase().split(/\s+/).every(w => hay.includes(w));
  }

  /* ---------------- data ---------------- */
  // `active` keeps the closed surface from polling: the home card is the only
  // reader until the user opens it.
  function useAutomations(active, intervalMs) {
    const [doc, setDoc] = useState(null);
    const reload = useCallback(() => {
      pluginFetch(ENDPOINT).then(setDoc).catch(e => setDoc({ error: String(e) }));
    }, []);
    useEffect(() => {
      if (!active) return;
      reload();
      const id = setInterval(reload, intervalMs);
      return () => clearInterval(id);
    }, [active, reload, intervalMs]);
    return [doc, reload];
  }

  /* ---------------- rows ---------------- */
  function JobRow({ a, now }) {
    const [open, setOpen] = useState(false);
    const toggle = () => setOpen(o => !o);
    const fires = firesWithin(a, now, 60);
    const detail = [
      ['quando', a.schedule_human, false],
      a.schedule_raw && a.schedule_raw !== a.schedule_human ? ['raw', a.schedule_raw, true] : null,
      ['nome', a.name, true],
      ['tipo', a.type, true],
      ['host', a.host, true],
      fires.length ? ['prossima', fires.length > 1
        ? `${fmtIn(fires[0], now)} — ${fmtClock(fires[0])}, poi altre ${fires.length - 1} entro l'ora`
        : `${fmtIn(fires[0], now)} — ${fmtClock(fires[0])}`, false] : null,
      ['ultima', a.last_run ? `${fmtAge(a.last_run, now)} — ${fmtAbs(a.last_run)}` : 'nessuna esecuzione nel log', false],
      a.command ? ['comando', a.command, true] : null,
      a.log_path ? ['log', a.log_path, true] : null,
      a.source ? ['fonte', a.source, true] : null,
    ].filter(Boolean);
    return (
      <>
        <div className={`pm-row click${open ? ' open' : ''}`} role="button" tabIndex={0} aria-expanded={open}
          onClick={toggle}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}>
          <span className={`dot dot-${a.last_status === 'fail' ? 'down' : a.last_status === 'ok' ? 'up' : 'unknown'}`} />
          <div className="pm-main">
            <div className="pm-name">
              {a.title || a.name}
              <span className="pm-tag">{a.type}</span>
            </div>
          </div>
          <div className="pm-right">
            <b>{a.schedule_human}</b>
            <span className="muted">{a.last_run ? fmtAge(a.last_run, now) : 'mai eseguita'}</span>
          </div>
          <PluginChevron open={open} />
        </div>
        {open && (
          <div className="pm-detail">
            {a.explanation ? <p>{a.explanation}</p> : null}
            <dl>
              {detail.map(([k, v, mono]) => (
                <React.Fragment key={k}><dt>{k}</dt><dd className={mono ? 'mono' : undefined}>{v}</dd></React.Fragment>
              ))}
            </dl>
          </div>
        )}
      </>
    );
  }

  function Slot({ slot, now }) {
    const [open, setOpen] = useState(false);
    const toggle = () => setOpen(o => !o);
    const names = slot.items.map(j => j.title || j.name);
    const hosts = [...new Set(slot.items.map(j => j.host))];
    return (
      <>
        <div className={`pm-slot${open ? ' open' : ''}`} role="button" tabIndex={0} aria-expanded={open} onClick={toggle}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}>
          <span className="pm-slot-time">{fmtClock(slot.at)}</span>
          <div>
            <div className="pm-slot-what">{slot.items.length === 1 ? names[0] : `${slot.items.length} job`}</div>
            <div className="pm-slot-sub">{slot.items.length === 1 ? hosts[0] : names.join(' · ')}</div>
          </div>
          <span className="pm-slot-in">{fmtIn(slot.at, now)}</span>
          <PluginChevron open={open} />
        </div>
        {open && (
          <div className="pm-slot-jobs">
            {slot.items.map((j, k) => (
              <div className="pm-slot-job" key={k}>
                <b>{j.title || j.name}</b>
                <span>{j.host} · {j.type}</span>
                <span className="push">{j.schedule_human}</span>
              </div>
            ))}
          </div>
        )}
      </>
    );
  }

  function NextHour({ jobs, now, unschedulable }) {
    if (!jobs.length) {
      return <div className="pm-empty">Nessuna esecuzione prevista entro un'ora.</div>;
    }
    const runs = jobs.reduce((n, j) => n + j.fires.length, 0);
    // Group every fire by the minute it happens: the agenda reads like departures.
    const byMin = new Map();
    for (const j of jobs) {
      for (const at of j.fires) {
        const key = Math.round((at - now) / MIN);
        if (!byMin.has(key)) byMin.set(key, { at, items: [] });
        byMin.get(key).items.push(j.job);
      }
    }
    const slots = [...byMin.values()].sort((a, b) => a.at - b.at);
    const first = slots[0];
    return (
      <>
        <div className="pm-hero">
          <span className="pm-hero-in">{fmtIn(first.at, now).replace('tra ', '')}</span>
          <div className="pm-hero-txt">
            <b>
              {first.items.length === 1 ? (first.items[0].title || first.items[0].name) : `${first.items.length} job`}
              {' '}alle {fmtClock(first.at)}
            </b>
            <span>{first.items.length === 1 ? `su ${first.items[0].host}` : [...new Set(first.items.map(j => j.host))].join(', ')}</span>
          </div>
          <div className="pm-hero-side">
            <b>{runs}</b>esecuzioni entro un'ora
          </div>
        </div>
        <div className="pm-sect">
          <div className="pm-sect-h">
            <h4>Agenda</h4><span className="count">{slots.length}</span>
            <span className="pm-sect-note">{jobs.length} job · clicca un orario per il dettaglio</span>
          </div>
          {slots.map((sl, k) => <Slot key={k} slot={sl} now={now} />)}
        </div>
        {unschedulable > 0 && (
          <div className="pm-empty">
            {unschedulable} job restano fuori dall'agenda: il collector non espone
            un orario calcolabile per i trigger launchd e per i timer senza prossima esecuzione.
          </div>
        )}
      </>
    );
  }

  /* ---------------- surface ---------------- */
  function Surface({ open, onClose }) {
    const [doc, reload] = useAutomations(open, 60_000);
    const [q, setQ] = useState('');
    const [host, setHost] = useState('all');
    const [view, setView] = useState('all');
    const inputRef = useRef(null);

    useEffect(() => {
      if (!open) return;
      setQ(''); setHost('all'); setView('all');
      const id = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(id);
    }, [open]);

    const all = doc?.automations || [];
    const now = doc?.serverNow || Date.now();
    const upcoming = useMemo(() => {
      const out = [];
      for (const j of all) {
        const fires = firesWithin(j, now, 60);
        if (fires.length) out.push({ job: j, at: fires[0], fires });
      }
      return out.sort((a, b) => a.at - b.at);
    }, [all, now]);

    if (!open) return null;

    const hostIds = Object.keys(doc?.hosts || {});
    const inScope = all.filter(a => host === 'all' || a.host === host);
    const shown = inScope.filter(a => matches(a, q));
    const own = shown.filter(a => a.category !== 'os');
    const sys = shown.filter(a => a.category === 'os');
    const ownTotal = all.filter(a => a.category !== 'os').length;
    const skipped = hostIds.filter(h => doc.hosts[h].status !== 'ok');
    const dueScope = upcoming.filter(j => (host === 'all' || j.job.host === host) && matches(j.job, q));
    const unschedulable = inScope.filter(a => !schedulable(a)).length;

    const byHost = {};
    own.forEach(a => { (byHost[a.host] = byHost[a.host] || []).push(a); });
    const order = hostIds.filter(h => byHost[h]);
    Object.keys(byHost).forEach(h => { if (!order.includes(h)) order.push(h); });

    const tools = (
      <>
        <input ref={inputRef} className="pm-filter" value={q} onChange={e => setQ(e.target.value)}
          placeholder="Filtra per nome, tipo, comando…" aria-label="Filtra automazioni" />
        <div className="pm-segment" role="tablist" aria-label="Vista">
          <button className={view === 'all' ? 'on' : ''} onClick={() => setView('all')}>Tutti</button>
          <button className={view === 'next' ? 'on' : ''} onClick={() => setView('next')}>Prossima ora</button>
        </div>
        {hostIds.length > 1 && (
          <div className="pm-segment" role="tablist" aria-label="Host">
            <button className={host === 'all' ? 'on' : ''} onClick={() => setHost('all')}>Tutti</button>
            {hostIds.map(h => (
              <button key={h} className={host === h ? 'on' : ''} onClick={() => setHost(h)}
                title={doc.hosts[h].error || undefined}>
                <span className={`dot dot-${doc.hosts[h].status === 'ok' ? 'up' : 'idle'}`} />{h}
              </button>
            ))}
          </div>
        )}
      </>
    );

    return (
      <div className="modal-scrim" onClick={onClose}>
        <PluginModal icon="clock" tone={skipped.length ? 'warn' : null} title="Automazioni"
          sub={doc
            ? `${hostIds.length} host · raccolto ${fmtAge(doc.generatedAt, Date.now())}`
            : 'caricamento…'}
          onReload={reload} onClose={onClose}
          kpis={[
            { label: "Esecuzioni entro un'ora", value: dueScope.reduce((n, j) => n + j.fires.length, 0), tone: 'ok' },
            { label: 'Job propri', value: own.length, of: (q || host !== 'all') ? ` / ${ownTotal}` : null },
            { label: 'Sorgenti ok', value: hostIds.length - skipped.length, of: `/${hostIds.length}`,
              tone: skipped.length ? 'warn' : 'ok' },
          ]}
          tools={tools}>

          {doc?.error && <div className="pm-error">{doc.error}</div>}

          {view === 'next' ? <NextHour jobs={dueScope} now={now} unschedulable={unschedulable} /> : (
            <>
              {skipped.map(h => (
                <div className="pm-banner warn" key={h}>
                  <span className="dot dot-idle" />
                  <div>
                    <div className="pm-banner-t" style={{ fontSize: 15 }}>{h} non interrogabile</div>
                    <div className="pm-banner-s">{doc.hosts[h].error} — i job di questa sorgente mancano dalla lista.</div>
                  </div>
                </div>
              ))}

              {order.map(h => (
                <div className="pm-sect" key={h}>
                  <div className="pm-sect-h">
                    <h4>{h}</h4>
                    <span className="count">{byHost[h].length}</span>
                    <span className="pm-sect-note">
                      ultima attività {fmtAge(Math.max(0, ...byHost[h].map(a => a.last_run || 0)), now)}
                    </span>
                  </div>
                  {byHost[h].map(a => <JobRow key={a.id} a={a} now={now} />)}
                </div>
              ))}

              {doc && own.length === 0 && (
                <div className="pm-empty">Nessun job proprio {q ? `che corrisponde a “${q}”` : 'su questo host'}.</div>
              )}

              {sys.length > 0 && (
                <details className="pm-more" open={!!q}>
                  <summary>{sys.length} job di sistema (OS) — apt, logrotate, fstrim…</summary>
                  {sys.map(a => <JobRow key={a.id} a={a} now={now} />)}
                </details>
              )}
            </>
          )}
        </PluginModal>
      </div>
    );
  }

  /* ---------------- home card ---------------- */
  function useSignal() {
    const [doc] = useAutomations(true, 60_000);
    if (!doc) return null;
    if (doc.error) {
      return { tone: 'down', dot: 'down', value: 'inventario non leggibile', meta: doc.error };
    }
    const now = doc.serverNow || Date.now();
    const all = doc.automations || [];
    const own = all.filter(a => a.category !== 'os').length;
    const hostIds = Object.keys(doc.hosts || {});
    const skipped = hostIds.filter(h => doc.hosts[h].status !== 'ok');
    const due = all.map(a => firesWithin(a, now, 60)).filter(f => f.length);
    const runs = due.reduce((n, f) => n + f.length, 0);
    return {
      tone: skipped.length ? 'warn' : 'ok',
      dot: skipped.length ? 'idle' : 'up',
      value: runs ? `${runs} esecuzioni entro un'ora` : "niente entro un'ora",
      meta: skipped.length
        ? `${due.length} job in coda · ${skipped.join(', ')} non interrogabile`
        : `${due.length} job in coda su ${own} propri · ${hostIds.length} host`,
    };
  }

  window.__lgboardPlugins = window.__lgboardPlugins || {};
  window.__lgboardPlugins.automations = { id: 'automations', useSignal, Surface };
})();
