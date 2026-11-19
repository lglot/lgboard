// Design "Riquadri": a bento grid of tiles with category chips and a floating dock.
// Gets everything through ctx (see layoutCtx in components.jsx). Registers on
// window.__lgboardLayouts, loaded on demand when a riquadri-* theme is active.
(function () {
  const { useState, useEffect } = React;
  const { Icons, BrandMark, PinButton, PluginTileActions, PluginBand, formatBytes, resolveTarget } = window;

  const WARN_PCT = 80;
  const greetIt = (d) => {
    const h = d.getHours();
    return h < 5 ? 'Buonanotte' : h < 13 ? 'Buongiorno' : h < 18 ? 'Buon pomeriggio' : 'Buonasera';
  };
  const dateIt = (d) => new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Rome' }).format(d);
  const num = (v) => Number(v).toLocaleString('it-IT', { maximumFractionDigits: 2 });
  const noReply = (n) => (n === 1 ? '1 non risponde' : `${n} non rispondono`);
  const downCount = (list, health) => list.filter(a => health[a.id]?.status === 'down').length;

  const statusIt = (h) => {
    if (!h || h.status === 'unknown') return 'Nessun controllo';
    if (h.status === 'up') return h.latencyMs != null ? `Attivo · ${Math.round(h.latencyMs)} ms` : 'Attivo';
    return { down: 'Non risponde', stale: 'Dato vecchio', idle: 'Inattivo' }[h.status] || h.status;
  };
  const uptimeShort = (s) => (s >= 86400 ? `${Math.floor(s / 86400)} g` : `${Math.floor(s / 3600)} h`);
  const uptimeLong = (s) => {
    const d = Math.floor(s / 86400), h = Math.floor(s / 3600);
    return d ? `su da ${d} ${d === 1 ? 'giorno' : 'giorni'}` : `su da ${h} ${h === 1 ? 'ora' : 'ore'}`;
  };

  // Each vital appears only if this host reports it (a Mac agent has no temperature).
  const VITALS = [
    { key: 'cpu', label: 'CPU', pct: (h) => h.cpu, text: (v) => `${Math.round(v)}%` },
    { key: 'ram', label: 'RAM', pct: (h) => h.ram?.pct, text: (v) => `${Math.round(v)}%` },
    { key: 'temp', label: 'Temperatura', pct: (h) => h.temps?.cpuC, text: (v) => `${Math.round(v)}°` },
    { key: 'containers', label: 'Container', drawer: 'cont', calm: true,
      pct: (h) => (h.containers?.total ? (h.containers.running / h.containers.total) * 100 : null),
      text: (v, h) => `${h.containers.running}/${h.containers.total}` },
    { key: 'storage', label: 'Disco', drawer: 'stor',
      pct: (h) => ((h.disks || []).length ? Math.max(...h.disks.map(d => d.pct || 0)) : null), text: (v) => `${Math.round(v)}%` },
    // Narrow tiles already say the uptime in their subtitle.
    { key: 'uptime', label: 'Uptime', wideOnly: true, value: (h) => h.uptimeSec, text: (v) => uptimeShort(v) },
  ];

  const hostSpans = (n, qa) => (n <= 1 ? [qa ? 9 : 12] : n === 2 ? (qa ? [6, 3] : [8, 4]) : Array(n).fill(4));
  // The quick-actions tile takes what is left of the hosts' last row.
  const qaSpan = (n) => (n <= 2 ? 3 : 12 - ((n * 4) % 12));

  function Track({ pct, warn }) {
    return <span className="rq-trk"><i className={warn ? 'warn' : ''} style={{ width: `${Math.min(100, pct)}%` }} /></span>;
  }

  function HostDetails({ host, kind }) {
    if (kind === 'stor') return (
      <div className="rq-drawer">
        <h3>Dischi di {host.name}</h3>
        {(host.disks || []).map(d => (
          <span className="rq-disk num" key={d.id || d.label}>
            {d.label} · {formatBytes(d.usedBytes)} / {formatBytes(d.totalBytes)}
            <Track pct={d.pct} warn={d.pct >= WARN_PCT} />
          </span>
        ))}
      </div>
    );
    // Polling can drop the data while this stays open (host went offline).
    const { running = 0, total = 0, items = [] } = host.containers || {};
    const sorted = [...items].sort((a, b) => (a.state === 'running') - (b.state === 'running'));
    return (
      <div className="rq-drawer">
        <h3>Container di {host.name}: {running} in esecuzione, {total - running} fermi</h3>
        {sorted.map(c => (
          <span className="rq-ctr" key={c.name} title={c.image || ''}>
            <span>{c.name}</span>{c.state !== 'running' && <em>{c.state}</em>}
          </span>
        ))}
      </div>
    );
  }

  function HostTile({ host, span, vis, open, onToggle }) {
    const off = host.status === 'down';
    const I = host.isLocal ? Icons.server : Icons.devices;
    const list = off ? [] : VITALS.filter(v => vis[v.key] !== false && !(v.wideOnly && span < 6)
      && (v.pct ? v.pct(host) : v.value(host)) != null);
    const colsSm = list.length === 2 || list.length === 4 ? 2 : 3; // no orphan in a second row
    const cols = span >= 9 ? Math.max(list.length, 1) : span === 3 ? 2 : colsSm;
    const sub = off ? ['offline'] : [
      host.isLocal ? `${host.cpuInfo?.cores ?? '?'} core` : 'agente nativo',
      vis.uptime !== false && host.uptimeSec ? uptimeLong(host.uptimeSec) : null,
      vis.net !== false && host.net ? `${num(host.net.downMBs)} MB/s` : null,
    ].filter(Boolean);
    return (
      <div className={`rq-tile rq-host ${off ? 'off' : ''}`} style={{ '--span': span }}>
        <h3><I size={18} />{host.name}</h3>
        <div className="rq-sub num">{sub.join(' · ')}</div>
        <div className="rq-vit" style={{ '--cols': cols, '--cols-sm': colsSm }}>
          {list.map(v => {
            const val = v.pct ? v.pct(host) : v.value(host);
            const warn = !v.calm && v.pct && val >= WARN_PCT;
            const body = (
              <>
                <small>{v.label}</small>
                <b className={`num ${warn ? 'warn' : ''}`}>{v.text(val, host)}</b>
                {v.pct && <Track pct={val} warn={warn} />}
              </>
            );
            return v.drawer ? (
              <button key={v.key} onClick={() => onToggle(v.drawer)} aria-expanded={open === v.drawer}
                aria-label={`${v.label} di ${host.name}: dettagli`}>{body}</button>
            ) : <div key={v.key}>{body}</div>;
          })}
        </div>
      </div>
    );
  }

  function QuickActions({ ctx, span, row }) {
    return (
      <div className={`rq-tile rq-qa ${row ? 'row' : ''}`} style={{ '--span': span }}>
        <h3>Azioni rapide</h3>
        {ctx.quickActions.map(a => {
          const I = Icons[a.icon] || Icons.dot;
          return (
            <button key={a.id} className={a.primary ? 'pri' : ''} onClick={() => ctx.invokeAction(a)}>
              <I size={18} />{a.label}{a.action === 'copy' && <code>{a.payload}</code>}
            </button>
          );
        })}
      </div>
    );
  }

  function Hosts({ ctx, showQa }) {
    const [drawer, setDrawer] = useState(null); // `${hostId}:stor|cont`
    const n = ctx.hosts.length;
    const spans = hostSpans(n, showQa);
    const qa = qaSpan(n);
    return (
      <div className="rq-grid">
        {!n && <div className="rq-tile rq-host rq-sub" style={{ '--span': spans[0] }}>{ctx.statsLoaded ? 'Nessun host raggiungibile' : 'Carico i vitali…'}</div>}
        {ctx.hosts.map((h, i) => {
          const open = drawer?.startsWith(h.id + ':') ? drawer.split(':')[1] : null;
          return (
            <React.Fragment key={h.id}>
              <HostTile host={h} span={spans[i]} vis={ctx.prefs.statsVisible || {}} open={open}
                onToggle={(kind) => setDrawer(open === kind ? null : `${h.id}:${kind}`)} />
              {/* Right after its host for phones; the dense grid lets later tiles fill back in on desktop. */}
              {open && <HostDetails host={h} kind={open} />}
            </React.Fragment>
          );
        })}
        {showQa && <QuickActions ctx={ctx} span={qa} row={qa === 12} />}
      </div>
    );
  }

  function AppTile({ ctx, app, sortItem, tools }) {
    const h = ctx.health[app.id];
    return (
      <a className={`rq-tile rq-app ${sortItem ? 'big' : 'small'} ${h?.status === 'down' ? 'is-down' : ''}`}
        href={app.url || '#'} target={resolveTarget(app)} rel="noopener" title={app.desc} {...sortItem}>
        <span className="rq-plate"><BrandMark app={app} /></span>
        <span className="rq-tx">
          <span className="rq-nm">{app.name}</span>
          <span className="rq-stt num">{statusIt(h)}</span>
        </span>
        <span className="rq-tools">
          <PluginTileActions app={app} discovery={ctx.discovery} plugins={ctx.plugins} />
          {tools}
          <PinButton app={app} onChanged={ctx.loadConfig} size={15} />
        </span>
      </a>
    );
  }

  const TITLES = { stats: 'Host', pinned: 'Fissati', plugins: 'Plugin' };

  function Block({ ctx, block, showQa }) {
    const { sectionSort, sectionIds, isClosed, toggleClosed, favSort, favIds, favById } = ctx;
    const closed = isClosed(block.key);
    const title = TITLES[block.kind] || block.title;
    const downs = block.kind === 'apps' ? downCount(block.list, ctx.health) : 0;
    const count = block.kind === 'stats' ? `${ctx.hosts.filter(h => h.status !== 'down').length} online`
      : block.kind === 'plugins' ? `${block.count} attivi` : block.count;
    return (
      <section className="rq-sec" {...sectionSort.item(block.key)}>
        <div className="rq-sh">
          <h2>{title}</h2><span className="rq-c num">{count}</span>
          {downs > 0 && <span className="rq-c bad num">{noReply(downs)}</span>}
          <div className="rq-sh-tools">
            {block.kind === 'plugins' && <button className="rq-btn" onClick={ctx.openStore}>Plugin store</button>}
            <button {...sectionSort.grip(block.key, sectionIds)}><Icons.grip size={14} /></button>
            <button className={`rq-mini ${closed ? 'closed' : ''}`} onClick={() => toggleClosed(block.key)}
              aria-expanded={!closed} aria-label={`${closed ? 'Espandi' : 'Comprimi'} ${title}`}>
              <Icons.chevDown size={18} />
            </button>
          </div>
        </div>
        {!closed && (
          block.kind === 'stats' ? <Hosts ctx={ctx} showQa={showQa} />
          : block.kind === 'pinned' ? (
            <div className="rq-grid">
              {favSort.sorted(favIds).map(id => (
                <AppTile key={id} ctx={ctx} app={favById[id]} sortItem={favSort.item(id)}
                  tools={<button {...favSort.grip(id, favIds)}><Icons.grip size={14} /></button>} />
              ))}
            </div>
          )
          : block.kind === 'plugins' ? (
            <PluginBand list={ctx.pluginList} manifests={ctx.manifests} onOpen={ctx.openPlugin}
              order={ctx.prefs.pluginOrder} onOrder={(o) => ctx.setPrefs(p => ({ ...p, pluginOrder: o }))}
              collapsed={ctx.prefs.pluginCollapsed}
              onCollapse={(id, v) => ctx.setPrefs(p => ({ ...p, pluginCollapsed: { ...p.pluginCollapsed, [id]: v } }))} />
          )
          : <div className="rq-grid">{block.list.map(a => <AppTile key={a.id} ctx={ctx} app={a} />)}</div>
        )}
      </section>
    );
  }

  function Chips({ ctx, groups, filter, setFilter }) {
    const all = groups.flatMap(b => b.list);
    const downs = downCount(all, ctx.health);
    const ups = all.filter(a => ctx.health[a.id]?.status === 'up').length;
    const chips = [
      { key: 'all', label: 'Tutto', sub: ups || downs ? `${ups} attivi${downs ? `, ${downs} giù` : ''}` : `${all.length} servizi` },
      ...groups.map(b => {
        const d = downCount(b.list, ctx.health);
        return { key: b.key, label: b.title, sub: d ? noReply(d) : `${b.count} servizi`, bad: d > 0 };
      }),
    ];
    return (
      <nav className="rq-chips" aria-label="Filtra per sezione">
        {chips.map(c => (
          <button key={c.key} className={`rq-chip ${filter === c.key ? 'on' : ''}`} aria-pressed={filter === c.key} onClick={() => setFilter(c.key)}>
            <b>{c.label}</b><span className={`num ${c.bad ? 'bad' : ''}`}>{c.sub}</span>
          </button>
        ))}
      </nav>
    );
  }

  function Riquadri({ ctx }) {
    const [now, setNow] = useState(new Date());
    useEffect(() => { const id = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(id); }, []);
    const [chip, setChip] = useState('all');
    const { branding, features, sectionSort, sectionIds, blockByKey, mode, setMode } = ctx;

    const on = sectionIds.map(k => blockByKey[k]).filter(b => b?.on);
    const groups = on.filter(b => b.kind === 'apps');
    // A chip can vanish under us (group-by switched, section emptied by hide-down).
    const filter = groups.some(b => b.key === chip) ? chip : 'all';
    const everything = filter === 'all';
    const shown = sectionSort.sorted(sectionIds).map(k => blockByKey[k]).filter(b => b?.on && (everything || b.key === filter));
    const qaOn = ctx.show('showQuickActions') && ctx.quickActions.length > 0;
    const statsOpen = on.some(b => b.kind === 'stats') && !ctx.isClosed('stats');
    const search = features.showCommandPalette !== false;
    const addService = ctx.quickActions.find(a => a.action === 'modal:add-service');

    return (
      <div className={`rq-wrap ${ctx.density === 'compact' ? 'dense' : ''}`}>
        <header className="rq-top">
          <h1>
            {features.showGreeting !== false ? `${greetIt(now)}, ${branding.user || 'Guest'}` : (branding.title || 'lgboard')}
            <small>{dateIt(now)}{branding.title ? ` · ${branding.title}` : ''}</small>
          </h1>
          {search && (
            <button className="rq-find" onClick={ctx.openSearch}>
              <Icons.search size={18} /><span>Cerca</span><kbd>⌘K</kbd>
            </button>
          )}
          <button className="rq-cb" onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')} aria-label="Cambia tema chiaro o scuro">
            {mode === 'dark' ? <Icons.sun size={18} /> : <Icons.moon size={18} />}
          </button>
          <button className={`rq-cb ${ctx.tweaksOpen ? 'on' : ''}`} onClick={() => ctx.toggleTweaks()} aria-label="Tweaks" aria-expanded={ctx.tweaksOpen}>
            <Icons.sliders size={18} />
          </button>
        </header>

        {groups.length > 0 && <Chips ctx={ctx} groups={groups} filter={filter} setFilter={setChip} />}

        {everything && qaOn && !statsOpen && <div className="rq-grid"><QuickActions ctx={ctx} span={12} row /></div>}
        {shown.map(b => <Block key={b.key} ctx={ctx} block={b} showQa={qaOn} />)}

        {features.showFooter !== false && (
          <footer className="rq-foot">
            <span>{branding.title || 'lgboard'}</span>
            <a href={branding.repoUrl || 'https://github.com/lglot/lgboard'} target="_blank" rel="noopener">github.com/lglot/lgboard</a>
            <span>Icone: dashboard-icons e favicon dei progetti</span>
          </footer>
        )}

        {/* Sticky and last in flow: it can never cover the footer, and it centers in
            the wrap, which already excludes the tweaks drawer. */}
        <nav className="rq-dock" aria-label="Barra rapida">
          <button className={everything ? 'on' : ''} onClick={() => { setChip('all'); window.scrollTo(0, 0); }}>
            <Icons.home size={18} />Home
          </button>
          {search && <button onClick={ctx.openSearch}><Icons.search size={18} />Cerca</button>}
          {addService && <button onClick={() => ctx.invokeAction(addService)} aria-label="Aggiungi servizio"><Icons.plus size={18} /></button>}
          <button className={ctx.tweaksOpen ? 'on' : ''} onClick={() => ctx.toggleTweaks()} aria-label="Tweaks" aria-expanded={ctx.tweaksOpen}>
            <Icons.sliders size={18} />
          </button>
        </nav>
      </div>
    );
  }

  window.__lgboardLayouts.riquadri = Riquadri;
})();
