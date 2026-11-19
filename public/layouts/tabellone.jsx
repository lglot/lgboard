// Design "Tabellone": the home as an airport departures board, one row per service.
// Gets everything through ctx (see layoutCtx in components.jsx). Registers on
// window.__lgboardLayouts, loaded on demand when a tabellone-* theme is active.
(function () {
  const { useState, useEffect } = React;
  const { Icons, BrandMark, PinButton, PluginTileActions, PluginBand, formatBytes, resolveTarget } = window;

  const WARN_PCT = 80;
  // shortcut: 200 ms is a display-only threshold the server knows nothing about, make it a healthcheck setting if it ever has to alert.
  const SLOW_MS = 200;
  const WORD = { up: 'In orario', slow: 'In ritardo', down: 'Soppresso', unknown: 'Senza check' };
  const statusOf = (h) => {
    if (h?.status === 'down') return 'down';
    if (h?.status !== 'up') return 'unknown';
    return h.latencyMs > SLOW_MS ? 'slow' : 'up';
  };
  const latency = (h, st) => {
    if (st !== 'up' && st !== 'slow') return 'n/d';
    return h.latencyMs != null ? `${Math.round(h.latencyMs)} ms` : 'cont.';
  };

  const TIME = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });
  const DATE = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Rome' });
  const num = (v) => Number(v).toLocaleString('it-IT', { maximumFractionDigits: 2 });
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  // Authentication is not in config.json, so this column only states what the URL proves.
  const accessOf = (app) => {
    const u = app.url || '';
    if (/\.ts\.net|\/\/100\.\d+\./.test(u) || /tailscale/i.test(app.desc || '')) return 'Tailscale';
    if (/\/\/(192\.168|10)\.\d+\./.test(u)) return 'LAN';
    return 'Web';
  };
  const diskPct = (h) => ((h.disks || []).length ? Math.max(...h.disks.map(d => d.pct || 0)) : null);
  const CELLS = [
    { key: 'cpu', label: 'CPU', val: (h) => (h.cpu == null ? null : `${Math.round(h.cpu)}%`) },
    { key: 'ram', label: 'RAM', val: (h) => (h.ram?.pct == null ? null : `${Math.round(h.ram.pct)}%`) },
    { key: 'temp', label: 'Temp', val: (h) => (h.temps?.cpuC == null ? null : `${Math.round(h.temps.cpuC)}°C`) },
    { key: 'net', label: 'Rete', val: (h) => (h.net ? `${num(h.net.downMBs)} MB/s` : null) },
    { key: 'containers', label: 'Container', drawer: 'cont', val: (h) => (h.containers ? `${h.containers.running}/${h.containers.total}` : null) },
    { key: 'uptime', label: 'Uptime', val: (h) => (h.uptimeSec ? `${Math.floor(h.uptimeSec / 86400)} g` : null) },
    { key: 'storage', label: 'Disco', drawer: 'stor', warn: (h) => diskPct(h) >= WARN_PCT, val: (h) => (diskPct(h) == null ? null : `${Math.round(diskPct(h))}%`) },
  ];
  const hostDot = (h) => (h.status === 'up' ? 'up' : h.status === 'down' ? 'down' : 'slow');

  // Its own component so the per-second tick does not re-render the board.
  function Clock() {
    const [now, setNow] = useState(new Date());
    useEffect(() => { const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id); }, []);
    return <div className="tb-clock"><b className="tb-mono">{TIME.format(now)}</b><span>{DATE.format(now)}</span></div>;
  }

  function Chevron({ closed, label, onClick }) {
    return (
      <button className={`tb-ib ${closed ? 'closed' : ''}`} onClick={onClick} aria-expanded={!closed}
        aria-label={`${closed ? 'Espandi' : 'Comprimi'} ${label}`}>
        <Icons.chevDown size={18} />
      </button>
    );
  }

  function HostStrip({ ctx, drawer, setDrawer }) {
    const closed = ctx.isClosed('stats');
    const vis = ctx.prefs.statsVisible || {};
    const cells = CELLS.filter(c => vis[c.key] !== false);
    const online = ctx.hosts.filter(h => h.status !== 'down').length;
    return (
      <section className={`tb-hosts ${closed ? 'closed' : ''}`} aria-label="Vitali degli host">
        {closed && <span className="tb-host-sum">Vitali degli host <span className="tb-mono">{online}/{ctx.hosts.length}</span> online</span>}
        {!closed && !ctx.hosts.length && <span className="tb-host-sum">{ctx.statsLoaded ? 'Nessun host raggiungibile' : 'Carico i vitali…'}</span>}
        {!closed && ctx.hosts.map(h => {
          const off = h.status === 'down';
          return (
            <div className="tb-host" key={h.id}>
              <h2><i className={`tb-dot ${hostDot(h)}`} title={off ? 'offline' : h.status} />{h.name}</h2>
              {cells.map(c => {
                const v = off ? null : c.val(h);
                const body = (
                  <React.Fragment>
                    <small>{c.label}</small>
                    <b className={`tb-mono ${!off && c.warn?.(h) ? 'warn' : ''}`}>{v ?? 'n/d'}</b>
                  </React.Fragment>
                );
                if (!c.drawer || v == null) return <div className={`tb-kv is-${c.key}`} key={c.key}>{body}</div>;
                const id = `${h.id}:${c.drawer}`;
                return (
                  <button className={`tb-kv is-${c.key} is-btn`} key={c.key} aria-expanded={drawer === id}
                    aria-label={`${c.label} di ${h.name}: ${v}, dettagli`}
                    onClick={() => setDrawer(drawer === id ? null : id)}>
                    {body}
                  </button>
                );
              })}
            </div>
          );
        })}
        <span className="tb-hosts-tog"><Chevron closed={closed} label="vitali degli host" onClick={() => ctx.toggleClosed('stats')} /></span>
      </section>
    );
  }

  function Drawer({ ctx, drawer }) {
    const [id, kind] = (drawer || '').split(':');
    const h = ctx.hosts.find(x => x.id === id);
    if (!h || h.status === 'down') return null;
    if (kind === 'stor') return (
      <div className="tb-drawer">
        <h3>Dischi di {h.name}</h3>
        <div className="tb-disks">
          {(h.disks || []).map(d => (
            <div key={d.id || d.label}>
              <div className="r"><b>{d.label}</b><span className="tb-mono">{formatBytes(d.usedBytes)} / {formatBytes(d.totalBytes)}</span></div>
              <div className="tb-trk"><i className={d.pct >= WARN_PCT ? 'warn' : ''} style={{ width: `${Math.min(100, d.pct)}%` }} /></div>
            </div>
          ))}
        </div>
      </div>
    );
    const items = h.containers?.items || [];
    const stopped = items.filter(c => c.state !== 'running').length;
    return (
      <div className="tb-drawer">
        <h3>Container su {h.name}: {items.length - stopped} in esecuzione, {plural(stopped, 'fermo', 'fermi')}</h3>
        <div className="tb-clist tb-mono">
          {items.map(c => (
            <span key={c.name} title={c.image || ''}>
              <i className={`tb-dot ${c.state === 'running' ? 'up' : 'unknown'}`} />
              <span className="n">{c.name}</span>
              {c.state !== 'running' && <em>{c.state}</em>}
            </span>
          ))}
          {!items.length && <span>Nessun container</span>}
        </div>
      </div>
    );
  }

  function Actions({ ctx }) {
    return ctx.quickActions.map(a => {
      const I = Icons[a.icon] || Icons.dot;
      return (
        <button key={a.id} className={`tb-btn ${a.primary ? 'solid' : ''}`} onClick={() => ctx.invokeAction(a)}>
          <I size={18} />{a.action === 'copy' ? <span className="tb-mono">{a.payload}</span> : a.label}
        </button>
      );
    });
  }

  function Pinned({ ctx }) {
    const { favSort, favIds, favById, health } = ctx;
    return (
      <div className="tb-pins">
        {favSort.sorted(favIds).map(id => {
          const a = favById[id];
          const st = statusOf(health[a.id]);
          return (
            <a key={id} className={`tb-pin ${st === 'down' ? 'is-down' : ''}`} href={a.url || '#'} target={resolveTarget(a)} rel="noopener" {...favSort.item(id)}>
              <span className="tb-plate"><BrandMark app={a} /></span>
              <span className="n">{a.name}</span>
              <i className={`tb-dot ${st}`} role="img" aria-label={WORD[st]} title={WORD[st]} />
              <span className="tb-pin-tools">
                <PluginTileActions app={a} discovery={ctx.discovery} plugins={ctx.plugins} />
                <PinButton app={a} onChanged={ctx.loadConfig} size={15} />
                <button {...favSort.grip(id, favIds)}><Icons.grip size={14} /></button>
              </span>
            </a>
          );
        })}
      </div>
    );
  }

  function Row({ ctx, app, i, sec }) {
    const h = ctx.health[app.id];
    const st = statusOf(h);
    return (
      <a className={`tb-row ${st === 'down' ? 'is-down' : ''}`} href={app.url || '#'} target={resolveTarget(app)} rel="noopener" style={{ '--i': i }}>
        <span className="tb-plate"><BrandMark app={app} /></span>
        <span className="tb-nm"><b>{app.name}</b><span>{app.desc}</span></span>
        <span className="tb-c tb-sec">{sec}</span>
        <span className="tb-c tb-hst">{ctx.appHost(app) === 'other' ? 'rete' : ctx.hostName(ctx.appHost(app))}</span>
        <span className="tb-c tb-acc">{accessOf(app)}</span>
        {/* keyed by status so the flap replays when the status changes */}
        <span className={`tb-st ${st}`} title={window.statusTitle(h)}><span key={st}>{WORD[st]}</span></span>
        <span className={`tb-lat tb-mono ${st}`}>{latency(h, st)}</span>
        <span className="tb-tools">
          <PluginTileActions app={app} discovery={ctx.discovery} plugins={ctx.plugins} />
          <PinButton app={app} onChanged={ctx.loadConfig} size={16} />
        </span>
      </a>
    );
  }

  function Board({ ctx, groups }) {
    const [tab, setTab] = useState('all');
    const { sectionSort, sectionIds, isClosed, toggleClosed, health } = ctx;
    const active = groups.some(g => g.key === tab) ? tab : 'all';
    const late = (a) => ['down', 'slow'].includes(statusOf(health[a.id]));
    const scoped = active === 'all' ? groups : groups.filter(g => g.key === active);
    const watch = scoped.flatMap(g => g.list).filter(late);
    const every = groups.flatMap(g => g.list);
    const down = every.filter(a => statusOf(health[a.id]) === 'down').length;
    const slow = every.filter(a => statusOf(health[a.id]) === 'slow').length;
    const catLabel = Object.fromEntries(ctx.categories.map(c => [c.id, c.label]));
    let i = 0; // staggers the flap down the whole board, not per group
    const row = (a) => <Row key={a.id} ctx={ctx} app={a} i={i++} sec={catLabel[a.cat] || a.cat} />;
    const WATCH = 'tb-watch';
    return (
      <div className="tb-boardbox">
        <div className="tb-tabs">
          <div className="tb-tablist" role="group" aria-label="Sezioni">
            {[{ key: 'all', title: 'Tutte' }, ...groups].map(g => (
              <button key={g.key} className={active === g.key ? 'on' : ''} aria-pressed={active === g.key} onClick={() => setTab(g.key)}>{g.title}</button>
            ))}
          </div>
          <span className="tb-sum tb-mono">{plural(every.length, 'servizio', 'servizi')} · {plural(down, 'soppresso', 'soppressi')} · {slow} in ritardo</span>
        </div>
        <div className={`tb-board ${ctx.density === 'compact' ? 'dense' : ''}`}>
          <div className="tb-cols" aria-hidden="true">
            <span /><span>Servizio</span><span className="tb-sec">Sezione</span><span className="tb-hst">Host</span><span className="tb-acc">Accesso</span>
            <span>Stato</span><span className="tb-lat">Latenza</span><span />
          </div>
          {watch.length > 0 && (
            <div>
              <div className="tb-grp">
                <span>Da guardare</span><span className="n tb-mono">{watch.length}</span>
                <span className="tb-tools"><Chevron closed={isClosed(WATCH)} label="Da guardare" onClick={() => toggleClosed(WATCH)} /></span>
              </div>
              {!isClosed(WATCH) && <div>{watch.map(row)}</div>}
            </div>
          )}
          {scoped.map(g => {
            const rows = g.list.filter(a => !late(a));
            if (!rows.length) return null;
            const closed = isClosed(g.key);
            return (
              <div key={g.key} {...sectionSort.item(g.key)}>
                <div className="tb-grp">
                  <span>{g.title}</span><span className="n tb-mono">{rows.length}</span>
                  <span className="tb-tools">
                    <button {...sectionSort.grip(g.key, sectionIds)}><Icons.grip size={14} /></button>
                    <Chevron closed={closed} label={g.title} onClick={() => toggleClosed(g.key)} />
                  </span>
                </div>
                {!closed && <div>{rows.map(row)}</div>}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const TITLES = { pinned: 'Fissati', plugins: 'Plugin' };

  function Section({ ctx, block }) {
    const closed = ctx.isClosed(block.key);
    const title = TITLES[block.kind];
    return (
      <section className="tb-section" {...ctx.sectionSort.item(block.key)}>
        <div className="tb-sh">
          <h2>{title}</h2>
          <span className="tb-tools">
            {block.kind === 'plugins' && <button className="tb-btn sm" onClick={ctx.openStore}>Plugin store</button>}
            <button {...ctx.sectionSort.grip(block.key, ctx.sectionIds)}><Icons.grip size={14} /></button>
            <Chevron closed={closed} label={title} onClick={() => ctx.toggleClosed(block.key)} />
          </span>
        </div>
        {!closed && (block.kind === 'pinned' ? <Pinned ctx={ctx} /> : (
          <PluginBand list={ctx.pluginList} manifests={ctx.manifests} onOpen={ctx.openPlugin}
            order={ctx.prefs.pluginOrder} onOrder={(o) => ctx.setPrefs(p => ({ ...p, pluginOrder: o }))}
            collapsed={ctx.prefs.pluginCollapsed}
            onCollapse={(id, v) => ctx.setPrefs(p => ({ ...p, pluginCollapsed: { ...p.pluginCollapsed, [id]: v } }))} />
        ))}
      </section>
    );
  }

  function Tabellone({ ctx }) {
    const [drawer, setDrawer] = useState(null); // `${hostId}:stor|cont`
    const { branding, features, sectionSort, sectionIds, blockByKey, mode, setMode } = ctx;
    const shown = sectionSort.sorted(sectionIds).map(k => blockByKey[k]).filter(b => b?.on);
    const statsOn = shown.some(b => b.kind === 'stats');
    const groups = shown.filter(b => b.kind === 'apps');
    const repo = branding.repoUrl || 'https://github.com/lglot/lgboard';
    return (
      <React.Fragment>
        <header className="tb-band">
          <div className="tb-top">
            <div className="tb-brand">
              <div className="m" aria-hidden="true">{branding.monogram || 'L'}</div>
              <div><b>{branding.title || 'lgboard'}</b><span>lgboard{branding.subtitle ? ` · ${branding.subtitle}` : ''}</span></div>
            </div>
            <Clock />
            <div className="tb-acts">
              {features.showCommandPalette !== false && (
                <button className="tb-btn" onClick={ctx.openSearch}><Icons.search size={18} />Cerca<kbd>⌘K</kbd></button>
              )}
              <button className="tb-btn" onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')} aria-label="Cambia tema chiaro o scuro">
                {mode === 'dark' ? <Icons.sun size={18} /> : <Icons.moon size={18} />}
              </button>
              <button className={`tb-btn ${ctx.tweaksOpen ? 'solid' : ''}`} onClick={() => ctx.toggleTweaks()} aria-label="Tweaks" aria-expanded={ctx.tweaksOpen}>
                <Icons.sliders size={18} />
              </button>
            </div>
          </div>
          {statsOn && <HostStrip ctx={ctx} drawer={drawer} setDrawer={setDrawer} />}
        </header>

        <main className="tb-wrap">
          {statsOn && !ctx.isClosed('stats') && <Drawer ctx={ctx} drawer={drawer} />}
          {ctx.show('showQuickActions') && ctx.quickActions.length > 0 && <div className="tb-qa"><Actions ctx={ctx} /></div>}
          {/* The board is one table: it sits where its first service section sits in the order. */}
          {shown.map(b => (
            b === groups[0] ? <Board key="board" ctx={ctx} groups={groups} />
              : b.kind === 'pinned' || b.kind === 'plugins' ? <Section key={b.key} ctx={ctx} block={b} />
              : null
          ))}
          {!groups.length && <p className="tb-empty">Nessun servizio</p>}
          {features.showFooter !== false && (
            <footer className="tb-foot">
              <span>{branding.footerText || 'lgboard · MIT'}</span>
              <a href={repo} target="_blank" rel="noopener">{repo.replace(/^https?:\/\//, '')}</a>
              <span>Icone: dashboard-icons e favicon dei progetti</span>
            </footer>
          )}
        </main>
      </React.Fragment>
    );
  }

  window.__lgboardLayouts.tabellone = Tabellone;
})();
