// Design "Linee": service sections as transit lines, services as stations on them.
// Gets everything through ctx (see layoutCtx in components.jsx). Registers on
// window.__lgboardLayouts, loaded on demand when a linee-* theme is active.
(function () {
  const { useState, useEffect, useRef } = React;
  const { Icons, BrandMark, PinButton, PluginTileActions, PluginBand, formatBytes, resolveTarget } = window;

  const WARN_PCT = 80;
  // Each color carries its own text color: white on green, yellow and teal is below 4.5:1.
  const PALETTE = [
    ['#E21D2D', '#FFFFFF'], ['#1E5BFF', '#FFFFFF'], ['#22A447', '#0B1230'],
    ['#F2B705', '#1B1B1B'], ['#8E54E9', '#FFFFFF'], ['#0FA3A3', '#0B1230'],
  ];
  const WORD = { up: 'Attiva', down: 'Sospesa', stale: 'Non aggiornata', idle: 'Inattiva', unknown: 'Senza check' };

  const greetIt = (d) => {
    const h = d.getHours();
    return h < 5 ? 'Buonanotte' : h < 13 ? 'Buongiorno' : h < 18 ? 'Buon pomeriggio' : 'Buonasera';
  };
  const dateIt = (d) => new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Rome' }).format(d);
  const num = (v, digits = 2) => Number(v).toLocaleString('it-IT', { maximumFractionDigits: digits });
  const pct = (v) => (v == null ? 'n/d' : `${Math.round(v)}%`);
  const upText = (s) => {
    const d = Math.floor(s / 86400);
    return d ? `su da ${d} ${d === 1 ? 'giorno' : 'giorni'}` : `su da ${Math.floor(s / 3600)} ore`;
  };

  const stOf = (h) => (WORD[h?.status] ? h.status : 'unknown');
  const latOf = (h) => {
    const st = stOf(h);
    if (st === 'up') return h.latencyMs != null ? `${Math.round(h.latencyMs)} ms` : h.probeType === 'container' ? 'container' : 'n/d';
    return st === 'unknown' ? 'no check' : WORD[st].toLowerCase();
  };
  // Reachability is not in config.json: it reads off the service's own URL.
  const accessOf = (app) => {
    const u = app.url || '';
    if (/\.ts\.net|\/\/100\.\d+\./.test(u) || /tailscale/i.test(app.desc || '')) return 'Tailscale';
    if (/\/\/(192\.168|10)\.\d+\./.test(u)) return 'LAN';
    return null;
  };
  const hostOf = (u) => { try { return new URL(u).hostname; } catch { return 'n/d'; } };

  // From config order, not the sorted sections: a line keeps color and letter when dragged.
  function lineTones(blocks) {
    const tones = { pinned: { color: 'var(--ink)', on: 'var(--bg)', code: 'F' } };
    const used = new Set(['F']);
    blocks.filter(b => b.kind === 'apps').forEach((b, i) => {
      const code = [...b.title.toUpperCase().replace(/[^A-Z0-9]/g, '')].find(c => !used.has(c)) || String(i + 1);
      used.add(code);
      const [color, on] = PALETTE[i % PALETTE.length];
      tones[b.key] = { color, on, code };
    });
    return tones;
  }

  const maxDisk = (h) => ((h.disks || []).length ? Math.max(...h.disks.map(d => d.pct || 0)) : null);
  const VITALS = [
    { key: 'cpu', label: 'CPU', val: (h) => pct(h.cpu), warn: (h) => h.cpu >= WARN_PCT },
    { key: 'ram', label: 'RAM', val: (h) => pct(h.ram?.pct), warn: (h) => h.ram?.pct >= WARN_PCT },
    { key: 'temp', label: 'Temperatura', val: (h) => (h.temps?.cpuC == null ? 'n/d' : `${Math.round(h.temps.cpuC)} °C`) },
    { key: 'net', label: 'Rete', val: (h) => (h.net ? `${num(h.net.downMBs)} MB/s` : 'n/d') },
    { key: 'containers', label: 'Container', drawer: 'cont', on: (h) => !!h.containers, val: (h) => (h.containers ? `${h.containers.running}/${h.containers.total}` : 'n/d') },
    { key: 'storage', label: 'Disco', drawer: 'stor', on: (h) => (h.disks || []).length > 0, val: (h) => pct(maxDisk(h)), warn: (h) => maxDisk(h) >= WARN_PCT },
  ];

  function Chevron({ closed, ...props }) {
    return <button className={`mini ${closed ? 'closed' : ''}`} aria-expanded={!closed} {...props}><Icons.chevDown size={16} /></button>;
  }

  function Station({ ctx, app, skey, selected, sortable, enter, leave, pick }) {
    const h = ctx.health[app.id];
    const st = stOf(h);
    const lat = latOf(h);
    return (
      <div className={`stn ${st} ${accessOf(app) === 'Tailscale' ? 'ts' : ''} ${selected ? 'sel' : ''}`}
        {...(sortable ? ctx.favSort.item(app.id) : {})}
        onMouseEnter={() => enter(skey)} onMouseLeave={leave} onFocus={() => pick(skey)}>
        <a className="stn-go" href={app.url || '#'} target={resolveTarget(app)} rel="noopener"
          aria-label={`${app.name}, ${WORD[st]}${st === 'up' ? `, ${lat}` : ''}`}>
          <span className="ln-ring"><BrandMark app={app} /></span>
          <span className="tx">
            <span className="nm" title={app.name}>{app.name}</span>
            <span className="lt num">{st === 'up' && <span className="w">{WORD.up} · </span>}{lat}</span>
          </span>
        </a>
        <span className="stn-tools">
          <span className="touch-only">
            <PluginTileActions app={app} discovery={ctx.discovery} plugins={ctx.plugins} />
            <PinButton app={app} onChanged={ctx.loadConfig} size={16} />
          </span>
          {sortable && <button {...ctx.favSort.grip(app.id, ctx.favIds)}><Icons.grip size={14} /></button>}
        </span>
      </div>
    );
  }

  function Line({ ctx, block, tone, list, selKey, ...handlers }) {
    const { sectionSort, sectionIds } = ctx;
    const closed = ctx.isClosed(block.key);
    const pinned = block.kind === 'pinned';
    const title = pinned ? 'Fissati' : block.title;
    const downs = list.filter(a => ctx.health[a.id]?.status === 'down').length;
    return (
      <section className="ln" style={{ '--lc': tone.color, '--li': tone.on }} {...sectionSort.item(block.key)}>
        <div className="lab">
          <span className="tag"><i aria-hidden="true">{tone.code}</i>{title}</span>
          <small className="num">
            {list.length} {list.length === 1 ? 'stazione' : 'stazioni'}
            {downs > 0 && <> · <b>{downs} {downs === 1 ? 'sospesa' : 'sospese'}</b></>}
          </small>
          <span className="tools">
            <button {...sectionSort.grip(block.key, sectionIds)}><Icons.grip size={14} /></button>
            <Chevron closed={closed} onClick={() => ctx.toggleClosed(block.key)} aria-label={`${closed ? 'Espandi' : 'Comprimi'} ${title}`} />
          </span>
        </div>
        <div className={`track ${closed ? 'closed' : ''}`}>
          {!closed && list.map(a => {
            const skey = `${block.key}:${a.id}`;
            return <Station key={a.id} ctx={ctx} app={a} skey={skey} selected={skey === selKey} sortable={pinned} {...handlers} />;
          })}
        </div>
      </section>
    );
  }

  function StationCard({ ctx, app, tone, lineTitle, localName }) {
    const h = ctx.health[app.id];
    const st = stOf(h);
    const access = accessOf(app);
    const hostName = ctx.appHost(app) === 'other' ? 'altro' : ctx.hostName(ctx.appHost(app));
    const why = st !== 'up' && st !== 'unknown' && [h?.httpCode && `HTTP ${h.httpCode}`, h?.reason].filter(Boolean).join(' · ');
    return (
      <div className="card stcard" style={{ '--lc': tone.color }}>
        <div className={`hd ${st}`}>
          <span className="ln-ring"><BrandMark app={app} /></span>
          <div className="tit"><b>{app.name}</b><span>{app.desc}</span></div>
          <span className={`ln-badge ${st}`} title={window.statusTitle(h)}>{WORD[st]}</span>
        </div>
        <div className="kvs">
          <div><small>Linea</small><b className="txt"><i className="ln-swatch" />{lineTitle}</b></div>
          <div><small>Latenza</small><b className="num">{latOf(h)}</b></div>
          <div><small>Accesso</small><b className="txt">{access || hostOf(app.url)}</b></div>
          <div><small>Host</small><b className="txt">{hostName}</b></div>
        </div>
        {why && <div className="ln-sub">Motivo: {why}</div>}
        <div className="acts">
          <a className="ln-pill sm" href={app.url || '#'} target={resolveTarget(app)} rel="noopener">Apri {app.name}</a>
          {/* The real PinButton stretches over the pill, so the Italian label is clickable too. */}
          <span className="ln-pill sm ln-pin">
            <PinButton app={app} onChanged={ctx.loadConfig} size={16} />
            <span>{app.fav ? 'Togli dai fissati' : 'Fissa'}</span>
          </span>
          <PluginTileActions app={app} discovery={ctx.discovery} plugins={ctx.plugins} />
        </div>
      </div>
    );
  }

  function Vitals({ ctx, block }) {
    const [drawer, setDrawer] = useState(null); // `${hostId}:stor|cont`
    const [open, setOpen] = useState({});
    const vis = ctx.prefs.statsVisible || {};
    const closed = ctx.isClosed(block.key);
    const cols = VITALS.filter(c => vis[c.key] !== false);
    return (
      <div className="card">
        <div className="hd ph">
          <h2>Vitali</h2><span className="c num">{ctx.hosts.filter(h => h.status !== 'down').length} online</span>
          <Chevron closed={closed} onClick={() => ctx.toggleClosed(block.key)} aria-label={`${closed ? 'Espandi' : 'Comprimi'} Vitali`} />
        </div>
        {!closed && !ctx.hosts.length && <div className="ln-sub">{ctx.statsLoaded ? 'Nessun host raggiungibile' : 'Carico i vitali…'}</div>}
        {!closed && ctx.hosts.map((h, i) => {
          const off = h.status === 'down';
          const isOpen = !off && (open[h.id] ?? i === 0);
          const openDrawer = drawer?.startsWith(h.id + ':') ? drawer.split(':')[1] : null;
          const up = vis.uptime !== false && h.uptimeSec ? upText(h.uptimeSec) : null;
          const sub = off ? 'offline' : (isOpen
            ? [h.cpuInfo?.cores && `${h.cpuInfo.cores} core`, up]
            : [vis.cpu !== false && h.cpu != null && `CPU ${pct(h.cpu)}`, vis.ram !== false && h.ram && `RAM ${pct(h.ram.pct)}`, up]
          ).filter(Boolean).join(' · ');
          return (
            <div className="host" key={h.id}>
              <button className={`hd hostbtn ${isOpen ? '' : 'shut'}`} disabled={off} aria-expanded={isOpen} onClick={() => setOpen({ ...open, [h.id]: !isOpen })}>
                <span className={`ln-ring ${h.isLocal ? 'hub' : 'small'}`} aria-hidden="true"><b>{h.isLocal ? h.name.slice(0, 2) : h.name[0].toUpperCase()}</b></span>
                <span className="tit"><b>{h.isLocal ? `Stazione centrale ${h.name}` : h.name}</b><span className="num">{sub}</span></span>
                {!off && <span className={`chev ${isOpen ? '' : 'closed'}`}><Icons.chevDown size={16} /></span>}
              </button>
              {isOpen && (
                <div className="kvs">
                  {cols.map(c => {
                    const warn = c.warn?.(h) ? 'warn' : '';
                    if (c.drawer && c.on(h)) return (
                      <button key={c.key} aria-expanded={openDrawer === c.drawer} aria-label={`${c.label} di ${h.name}: dettagli`}
                        onClick={() => setDrawer(openDrawer === c.drawer ? null : `${h.id}:${c.drawer}`)}>
                        <small>{c.label}</small><b className={`num ${warn}`}>{c.val(h)}</b>
                      </button>
                    );
                    return <div key={c.key}><small>{c.label}</small><b className={`num ${warn}`}>{c.val(h)}</b></div>;
                  })}
                </div>
              )}
              {isOpen && openDrawer === 'stor' && (
                <div className="ln-sub">
                  {h.disks.map(d => (
                    <React.Fragment key={d.id || d.label}>
                      <span className="num">{d.label} · {formatBytes(d.usedBytes)} / {formatBytes(d.totalBytes)}</span>
                      <span className="trk"><i className={d.pct >= WARN_PCT ? 'warn' : ''} style={{ width: `${Math.min(100, d.pct)}%` }} /></span>
                    </React.Fragment>
                  ))}
                </div>
              )}
              {isOpen && openDrawer === 'cont' && (
                <div className="ln-sub ctrs" tabIndex={0} aria-label={`Container di ${h.name}`}>
                  {(h.containers.items || []).map(c => (
                    <span className="ctr" key={c.name} title={c.image || ''}>
                      <i className={`ln-dot ${c.state === 'running' ? '' : 'idle'}`} /><span>{c.name}</span>
                      {c.state !== 'running' && <em>{c.state}</em>}
                    </span>
                  ))}
                  {!(h.containers.items || []).length && <span>Nessun container</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  function Plugins({ ctx }) {
    const closed = ctx.isClosed('plugins');
    return (
      <div className="card">
        <div className="hd ph">
          <h2>Plugin</h2><span className="c num">{ctx.pluginList.length} attivi</span>
          <button className="ln-pill xs" onClick={ctx.openStore}>Plugin store</button>
          <Chevron closed={closed} onClick={() => ctx.toggleClosed('plugins')} aria-label={`${closed ? 'Espandi' : 'Comprimi'} Plugin`} />
        </div>
        {!closed && ctx.pluginList.length > 0 && (
          <div className="plugs">
            <PluginBand list={ctx.pluginList} manifests={ctx.manifests} onOpen={ctx.openPlugin}
              order={ctx.prefs.pluginOrder} onOrder={(o) => ctx.setPrefs(p => ({ ...p, pluginOrder: o }))}
              collapsed={ctx.prefs.pluginCollapsed}
              onCollapse={(id, v) => ctx.setPrefs(p => ({ ...p, pluginCollapsed: { ...p.pluginCollapsed, [id]: v } }))} />
          </div>
        )}
      </div>
    );
  }

  function Linee({ ctx }) {
    const [now, setNow] = useState(new Date());
    const [picked, setPicked] = useState(null); // `${lineKey}:${appId}`: a pinned service sits on two lines
    const hover = useRef();
    useEffect(() => { const id = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(id); }, []);
    const { branding, features, sectionSort, sectionIds, blockByKey, favSort, favIds, favById, mode, setMode } = ctx;

    const shown = sectionSort.sorted(sectionIds).map(k => blockByKey[k]).filter(b => b?.on);
    const lines = shown.filter(b => b.kind === 'pinned' || b.kind === 'apps');
    const tones = lineTones(ctx.blocks);
    const listOf = (b) => (b.kind === 'pinned' ? favSort.sorted(favIds).map(id => favById[id]) : b.list);
    const stations = lines.flatMap(b => listOf(b).map(app => ({ key: `${b.key}:${app.id}`, app, block: b })));
    const sel = stations.find(s => s.key === picked) || stations.find(s => ctx.health[s.app.id]?.status === 'down') || stations[0];
    const localName = ctx.hosts.find(h => h.isLocal)?.name || ctx.cfg.stats?.localName || branding.subtitle || 'local';

    // Hover intent: crossing stations on the way to the panel must not steal the selection.
    const enter = (key) => { clearTimeout(hover.current); hover.current = setTimeout(() => setPicked(key), 130); };
    const leave = () => clearTimeout(hover.current);
    const pick = (key) => { clearTimeout(hover.current); setPicked(key); };

    return (
      <div className={`ln-root ${ctx.density === 'compact' ? 'dense' : ''}`}>
        <header className="top">
          <div className="brand">
            <div className="m" aria-hidden="true">{branding.monogram || 'L'}</div>
            <div>
              <b>Rete di casa</b>
              <span>{features.showGreeting !== false ? `${greetIt(now)}, ${branding.user || 'Guest'}` : (branding.title || 'lgboard')} · {dateIt(now)}</span>
            </div>
          </div>
          {features.showCommandPalette !== false && (
            <button className="where" onClick={ctx.openSearch}>
              <Icons.search size={18} /><span>Dove vuoi andare?</span><kbd>⌘K</kbd>
            </button>
          )}
          {ctx.show('showQuickActions') && (
            <div className="qa">
              {ctx.quickActions.map(a => {
                const I = Icons[a.icon] || Icons.dot;
                const iconOnly = a.action === 'url';
                return (
                  <button key={a.id} className={`ln-pill ${a.primary ? 'red' : ''} ${iconOnly ? 'sq' : ''}`} onClick={() => ctx.invokeAction(a)}
                    aria-label={iconOnly ? a.label : undefined} title={iconOnly ? a.label : undefined}>
                    <I size={18} />{!iconOnly && a.label}
                  </button>
                );
              })}
            </div>
          )}
          <div className="modes">
            <button className="ln-pill sq" onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')} aria-label="Cambia tema chiaro o scuro">
              {mode === 'dark' ? <Icons.sun size={18} /> : <Icons.moon size={18} />}
            </button>
            <button className={`ln-pill sq ${ctx.tweaksOpen ? 'on' : ''}`} onClick={() => ctx.toggleTweaks()} aria-label="Tweaks" aria-expanded={ctx.tweaksOpen}>
              <Icons.sliders size={18} />
            </button>
          </div>
        </header>

        <div className="layout">
          <div className="map">
            <div className="trunk" aria-hidden="true"><b>{localName}</b><span>stazione centrale</span></div>
            <div className="lines">
              {lines.map(b => (
                <Line key={b.key} ctx={ctx} block={b} tone={tones[b.key]} list={listOf(b)} selKey={sel?.key} enter={enter} leave={leave} pick={pick} />
              ))}
            </div>
          </div>

          <aside className="side" aria-label="Dettagli">
            {sel && (
              <StationCard ctx={ctx} app={sel.app} tone={tones[sel.block.key]} localName={localName}
                lineTitle={sel.block.kind === 'pinned' ? 'Fissati' : sel.block.title} />
            )}
            {shown.some(b => b.kind === 'stats') && <Vitals ctx={ctx} block={blockByKey.stats} />}
            <Plugins ctx={ctx} />
          </aside>
        </div>

        {features.showFooter !== false && (
          <footer className="ln-foot">
            <span>{branding.title || 'lgboard'}</span>
            <a href={branding.repoUrl || 'https://github.com/lglot/lgboard'} target="_blank" rel="noopener">github.com/lglot/lgboard</a>
            <span>Icone: dashboard-icons e favicon dei progetti</span>
          </footer>
        )}
      </div>
    );
  }

  window.__lgboardLayouts.linee = Linee;
})();
