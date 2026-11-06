// Design "Indice": hosts as a table with inline meters, services as a box-free index.
// Gets everything through ctx (see layoutCtx in components.jsx). Registers on
// window.__lgboardLayouts, loaded on demand when an indice-* theme is active.
(function () {
  const { useState, useEffect } = React;
  const { Icons, BrandMark, PinButton, PluginTileActions, PluginBand, formatBytes, resolveTarget } = window;

  const WARN_PCT = 80;
  const greetIt = (d) => {
    const h = d.getHours();
    return h < 5 ? 'Buonanotte' : h < 13 ? 'Buongiorno' : h < 18 ? 'Buon pomeriggio' : 'Buonasera';
  };
  const dateIt = (d) => new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Rome' }).format(d);
  const num = (v, digits = 2) => Number(v).toLocaleString('it-IT', { maximumFractionDigits: digits });

  // Reachability is not in config.json: it reads off the service's own URL.
  const accessOf = (app) => {
    const u = app.url || '';
    if (/\.ts\.net|\/\/100\.\d+\./.test(u)) return 'Tailscale';
    if (/\/\/(192\.168|10)\.\d+\./.test(u)) return 'LAN';
    return null;
  };
  const stClass = (h) => (h?.status === 'up' ? '' : h?.status === 'down' ? 'down' : h?.status === 'stale' || h?.status === 'idle' ? 'idle' : 'unknown');
  const latency = (h) => {
    if (!h || h.status === 'unknown') return 'no check';
    if (h.status === 'up') return h.latencyMs != null ? `${Math.round(h.latencyMs)} ms` : '';
    return h.status === 'down' ? 'giù' : h.status;
  };

  function Meter({ pct }) {
    if (pct == null) return <span className="na">n/d</span>;
    return (
      <span className="meter">
        <span className="t"><i className={pct >= WARN_PCT ? 'warn' : ''} style={{ width: `${Math.min(100, pct)}%` }} /></span>
        <b className="num">{Math.round(pct)}%</b>
      </span>
    );
  }

  const COLS = [
    { key: 'cpu', label: 'CPU', cell: (h) => <Meter pct={h.cpu} /> },
    { key: 'ram', label: 'RAM', cell: (h) => <Meter pct={h.ram?.pct} /> },
    { key: 'storage', label: 'Disco', drawer: 'stor', on: (h) => (h.disks || []).length > 0,
      cell: (h) => <Meter pct={(h.disks || []).length ? Math.max(...h.disks.map(d => d.pct || 0)) : null} /> },
    { key: 'temp', label: 'Temperatura', cell: (h) => (h.temps?.cpuC == null ? <span className="na">n/d</span> : <span className="num">{Math.round(h.temps.cpuC)} °C</span>) },
    { key: 'containers', label: 'Container', drawer: 'cont', on: (h) => !!h.containers,
      cell: (h) => (h.containers ? <b className="num plainb">{h.containers.running}/{h.containers.total}</b> : <span className="na">n/d</span>) },
    { key: 'net', label: 'Rete', cell: (h) => (h.net ? <span className="num">{num(h.net.downMBs)} MB/s</span> : <span className="na">n/d</span>) },
    { key: 'uptime', label: 'Uptime', cell: (h) => (h.uptimeSec ? <span className="num">{Math.floor(h.uptimeSec / 86400)} g</span> : <span className="na">n/d</span>) },
  ];

  function Hosts({ ctx }) {
    const [drawer, setDrawer] = useState(null); // `${hostId}:stor|cont`
    const vis = ctx.prefs.statsVisible || {};
    const cols = COLS.filter(c => vis[c.key] !== false);
    const grid = { gridTemplateColumns: `minmax(170px,1.2fr) ${cols.map(c => (c.key === 'cpu' || c.key === 'ram' || c.key === 'storage' ? 'minmax(120px,1fr)' : 'minmax(84px,.7fr)')).join(' ')}` };
    if (!ctx.hosts.length) return <div className="hosts empty">{ctx.statsLoaded ? 'Nessun host raggiungibile' : 'Carico i vitali…'}</div>;
    return (
      <div className="hosts">
        <div className="hrow head" style={grid} aria-hidden="true">
          <span>Host</span>{cols.map(c => <span key={c.key}>{c.label}</span>)}
        </div>
        {ctx.hosts.map(h => {
          const off = h.status === 'down';
          const open = drawer?.startsWith(h.id + ':') ? drawer.split(':')[1] : null;
          return (
            <React.Fragment key={h.id}>
              <div className={`hrow ${off ? 'off' : ''}`} style={grid}>
                <span className="hname">
                  <i className={`dot ${stClass(h)}`} />{h.name}
                  <small>{off ? 'offline' : h.isLocal ? `${h.cpuInfo?.cores ?? '?'} core · hub` : 'agente nativo'}</small>
                </span>
                {cols.map(c => {
                  const label = <span className="mlabel">{c.label}</span>;
                  if (off) return <span key={c.key} className="cell">{label}<span className="na">n/d</span></span>;
                  if (c.drawer && c.on(h)) return (
                    <button key={c.key} className="cell cellbtn" aria-expanded={open === c.drawer}
                      aria-label={`${c.label} di ${h.name}: dettagli`}
                      onClick={() => setDrawer(open === c.drawer ? null : `${h.id}:${c.drawer}`)}>
                      {label}{c.cell(h)}
                    </button>
                  );
                  return <span key={c.key} className="cell">{label}{c.cell(h)}</span>;
                })}
              </div>
              {open === 'stor' && (
                <div className="drawer"><div className="g">
                  {h.disks.map(d => (
                    <div className="disk" key={d.id || d.label}>
                      <div className="r"><b>{d.label}</b><span className="num">{formatBytes(d.usedBytes)} / {formatBytes(d.totalBytes)}</span></div>
                      <span className="meter"><span className="t"><i className={d.pct >= WARN_PCT ? 'warn' : ''} style={{ width: `${d.pct}%` }} /></span></span>
                    </div>
                  ))}
                </div></div>
              )}
              {open === 'cont' && (
                <div className="drawer"><div className="g">
                  {(h.containers.items || []).map(c => (
                    <span className="ctr" key={c.name} title={c.image || ''}>
                      <i className={`dot ${c.state === 'running' ? '' : 'idle'}`} />{c.name}
                      {c.state !== 'running' && <em>{c.state}</em>}
                    </span>
                  ))}
                  {!(h.containers.items || []).length && <span>Nessun container</span>}
                </div></div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    );
  }

  function Actions({ ctx }) {
    return ctx.quickActions.map(a => {
      const I = Icons[a.icon] || Icons.dot;
      return (
        <button key={a.id} className={`btn ${a.primary ? 'pri' : ''}`} onClick={() => ctx.invokeAction(a)}>
          <I size={16} />{a.label}{a.action === 'copy' && <code>{a.payload}</code>}
        </button>
      );
    });
  }

  function Pinned({ ctx, block }) {
    const { favSort, favIds, favById, health } = ctx;
    return (
      <div className="favs">
        {favSort.sorted(favIds).map(id => {
          const a = favById[id];
          const h = health[a.id];
          return (
            <a key={id} className={`fav ${h?.status === 'down' ? 'is-down' : ''}`} href={a.url || '#'} target={resolveTarget(a)} rel="noopener" {...favSort.item(id)}>
              <span className="plate"><BrandMark app={a} /></span>
              <span className="tx">
                <span className="n">{a.name}<i className={`dot ${stClass(h)}`} title={window.statusTitle(h)} /></span>
                <span className="d">{a.desc}</span>
              </span>
              <span className="fav-tools">
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

  function Item({ ctx, app }) {
    const h = ctx.health[app.id];
    const access = accessOf(app);
    return (
      <a className={`item ${h?.status === 'down' ? 'is-down' : ''}`} href={app.url || '#'} target={resolveTarget(app)} rel="noopener">
        <span className="plate"><BrandMark app={app} /></span>
        <span className="tx">
          <span className="n">
            {app.name}<i className={`dot ${stClass(h)}`} title={window.statusTitle(h)} />
            {access && <span className={`tag ${access === 'Tailscale' ? 'ts' : ''}`}>{access}</span>}
          </span>
          <span className="d">{app.desc}</span>
        </span>
        <span className="lat num">{latency(h)}</span>
        <span className="item-tools">
          <PluginTileActions app={app} discovery={ctx.discovery} plugins={ctx.plugins} />
          <PinButton app={app} onChanged={ctx.loadConfig} size={15} />
        </span>
      </a>
    );
  }

  const TITLES = { stats: 'Host', pinned: 'Fissati', plugins: 'Plugin' };

  function Block({ ctx, block, first }) {
    const { sectionSort, sectionIds, isClosed, toggleClosed } = ctx;
    const closed = isClosed(block.key);
    const title = TITLES[block.kind] || block.title;
    const hostsOn = ctx.hosts.filter(h => h.status !== 'down').length;
    const downs = block.kind === 'apps' ? block.list.filter(a => ctx.health[a.id]?.status === 'down').length : 0;
    const summary = block.kind === 'stats' ? `${hostsOn} online`
      : block.kind === 'plugins' ? `${block.count} attivi`
      : block.count + (downs ? ` · ${downs} giù` : '');
    return (
      <section {...sectionSort.item(block.key)}>
        <div className="h">
          <h2>{title}</h2><span className="c num">{summary}</span>
          <div className="tools">
            {block.kind === 'stats' && ctx.show('showQuickActions') && <Actions ctx={ctx} />}
            {block.kind === 'plugins' && <button className="btn" onClick={ctx.openStore}>Plugin store</button>}
            <button {...sectionSort.grip(block.key, sectionIds)}><Icons.grip size={14} /></button>
            <button className={`mini ${closed ? 'closed' : ''}`} onClick={() => toggleClosed(block.key)}
              aria-expanded={!closed} aria-label={`${closed ? 'Espandi' : 'Comprimi'} ${title}`}>
              <Icons.chevDown size={16} />
            </button>
          </div>
        </div>
        {!closed && (
          block.kind === 'stats' ? <Hosts ctx={ctx} />
          : block.kind === 'pinned' ? <Pinned ctx={ctx} block={block} />
          : block.kind === 'plugins' ? (
            <PluginBand list={ctx.pluginList} manifests={ctx.manifests} onOpen={ctx.openPlugin}
              order={ctx.prefs.pluginOrder} onOrder={(o) => ctx.setPrefs(p => ({ ...p, pluginOrder: o }))}
              collapsed={ctx.prefs.pluginCollapsed}
              onCollapse={(id, v) => ctx.setPrefs(p => ({ ...p, pluginCollapsed: { ...p.pluginCollapsed, [id]: v } }))} />
          )
          : <div className="list">{block.list.map(a => <Item key={a.id} ctx={ctx} app={a} />)}</div>
        )}
      </section>
    );
  }

  function Indice({ ctx }) {
    const [now, setNow] = useState(new Date());
    useEffect(() => { const id = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(id); }, []);
    const { branding, features, sectionSort, sectionIds, blockByKey, mode, setMode } = ctx;
    const shown = sectionSort.sorted(sectionIds).map(k => blockByKey[k]).filter(b => b?.on);
    const statsOn = shown.some(b => b.kind === 'stats');
    return (
      <div className={`wrap ${ctx.density === 'compact' ? 'dense' : ''}`}>
        <header className="top">
          <div className="brand">
            <div className="m" aria-hidden="true">{branding.monogram || 'L'}</div>
            <div>
              <b>{features.showGreeting !== false ? `${greetIt(now)}, ${branding.user || 'Guest'}` : (branding.title || 'lgboard')}</b>
              <span>{dateIt(now)} · {branding.title || ''}</span>
            </div>
          </div>
          {features.showCommandPalette !== false && (
            <button className="find" onClick={ctx.openSearch}>
              <Icons.search size={18} /><span>Cerca servizi e azioni</span><kbd>⌘K</kbd>
            </button>
          )}
          <div className="acts">
            <button className="ib" onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')} aria-label="Cambia tema chiaro o scuro">
              {mode === 'dark' ? <Icons.sun size={18} /> : <Icons.moon size={18} />}
            </button>
            <button className={`ib ${ctx.tweaksOpen ? 'on' : ''}`} onClick={() => ctx.toggleTweaks()} aria-label="Tweaks" aria-expanded={ctx.tweaksOpen}>
              {ctx.tweaksOpen ? <Icons.panelCloseRight size={18} /> : <Icons.panelOpenRight size={18} />}
            </button>
          </div>
        </header>
        {!statsOn && ctx.show('showQuickActions') && <div className="qa-solo"><Actions ctx={ctx} /></div>}
        {shown.map(b => <Block key={b.key} ctx={ctx} block={b} />)}
        {features.showFooter !== false && (
          <footer className="ix-foot">
            <span>{branding.title || 'lgboard'}</span>
            <a href={branding.repoUrl || 'https://github.com/lglot/lgboard'} target="_blank" rel="noopener">github.com/lglot/lgboard</a>
            <span>Icone: dashboard-icons e favicon dei progetti</span>
          </footer>
        )}
      </div>
    );
  }

  window.__lgboardLayouts.indice = Indice;
})();
