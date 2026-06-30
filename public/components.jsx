// lgboard — dashboard components
// Zero bundler, runs from /vendor React + Babel-standalone.
// Icons/AppIcon/Monogram come from icons.jsx; the theme system (THEMES,
// resolveTheme, applyThemeVars, ThemeGroupedGrid, ThemeGalleryModal, …) from
// themes.jsx. Both are loaded first and exported on window.

const { useState, useEffect, useRef, useMemo, useCallback } = React;

/* ---------------- HELPERS ---------------- */
const greeting = (d = new Date()) => {
  const h = d.getHours();
  if (h < 5)  return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
};
const fmtClock = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtDate  = (d) => d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

const fmtUptime = (sec) => {
  if (!sec || !isFinite(sec)) return null;
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  return `${d}d ${h}h`;
};

// Picks the smallest unit that keeps the value >= 1 (or B for tiny).
function formatBytes(n) {
  if (n == null || !isFinite(n)) return null;
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  const decimals = v < 10 ? 1 : 0;
  return `${v.toFixed(decimals)} ${units[i]}`;
}

const resolveTarget = (app) => {
  if (app.target === '_self' || app.target === '_blank') return app.target;
  return /^https?:\/\//i.test(app.url || '') ? '_blank' : '_self';
};

function dotClass(status) {
  if (status === 'up')    return 'dot-up';
  if (status === 'down')  return 'dot-down';
  if (status === 'idle')  return 'dot-idle';
  if (status === 'stale') return 'dot-stale';
  return 'dot-unknown';
}

/* ---------------- SERVER STATS (real via /api/stats) ---------------- */
function useServerStats(interval = 3000) {
  const [hosts, setHosts]   = useState([]);
  const [aggregate, setAgg] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [history, setHistory] = useState(() =>
    Array.from({ length: 32 }, (_, i) => 1 + Math.sin(i / 3) * 0.4 + Math.cos(i / 5) * 0.2)
  );

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch('/api/stats?all=true', { cache: 'no-store' });
        if (!r.ok) throw new Error('http ' + r.status);
        const j = await r.json();
        if (cancelled) return;
        let hs, agg;
        if (j && j.allMode && Array.isArray(j.hosts)) {
          hs = j.hosts;
          agg = j.stats || null;
        } else {
          // backward-compat: old single-host payload
          hs = [{ id: 'local', name: 'local', isLocal: true, status: 'up', ...j }];
          agg = null;
        }
        setHosts(hs);
        setAgg(agg);
        setLoaded(true);
        const down = hs[0]?.net?.downMBs ?? 0;
        setHistory(h => [...h.slice(1), down]);
      } catch (e) {
        if (!cancelled) setLoaded(true); // stop skeleton, show "n/a"
      }
    };
    tick();
    const id = setInterval(tick, interval);
    return () => { cancelled = true; clearInterval(id); };
  }, [interval]);

  return { hosts, aggregate, loaded, netHistory: history };
}

/* ---------------- DOCKER DISCOVERY ---------------- */
function useDiscovery(interval = 60_000) {
  const [map, setMap] = useState({});
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch('/api/discovery', { cache: 'no-store' });
        if (!r.ok) return;
        const j = await r.json();
        if (!cancelled) setMap(j || {});
      } catch (e) { /* keep previous */ }
    };
    tick();
    const id = setInterval(tick, interval);
    return () => { cancelled = true; clearInterval(id); };
  }, [interval]);
  return map;
}

/* ---------------- PLUGINS REGISTRY ---------------- */
async function loadPluginScript(manifest) {
  if (!manifest.ui?.module) return;
  const url = `/_p/${manifest.id}/${manifest.ui.module}?v=${manifest.version || ''}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('fetch failed: ' + res.status);
    const src = await res.text();
    // Compile JSX → JS via Babel-standalone, then inject as a normal script.
    const compiled = window.Babel.transform(src, { presets: ['react'] }).code;
    const tag = document.createElement('script');
    tag.dataset.plugin = manifest.id;
    tag.textContent = compiled;
    document.head.appendChild(tag);
  } catch (e) {
    console.error('[plugin]', manifest.id, 'load failed', e);
  }
}

function usePlugins() {
  const [manifests, setManifests] = useState([]);
  const [registry, setRegistry] = useState({});
  useEffect(() => {
    let cancelled = false;
    fetch('/api/plugins').then(r => r.json()).then(async list => {
      if (cancelled || !Array.isArray(list)) return;
      setManifests(list);
      for (const m of list) {
        // already loaded? (e.g. hot reload)
        if (window.__lgboardPlugins?.[m.id]) continue;
        await loadPluginScript(m);
      }
      if (!cancelled) setRegistry({ ...(window.__lgboardPlugins || {}) });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return { manifests, registry };
}

/* ---------------- HEALTH STATUS ---------------- */
function useHealthStatus(interval = 30_000) {
  const [map, setMap] = useState({});
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch('/api/health', { cache: 'no-store' });
        if (!r.ok) return;
        const j = await r.json();
        if (!cancelled) setMap(j || {});
      } catch (e) { /* keep previous */ }
    };
    tick();
    const id = setInterval(tick, interval);
    return () => { cancelled = true; clearInterval(id); };
  }, [interval]);
  return map;
}

/* ---------------- HEADER ---------------- */
function Header({ branding, onOpenSearch, onToggleTweaks, tweaksOpen, mode, setMode, showGreeting, showCommandPalette }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  const isMac = /Mac/.test(navigator.platform);
  const dark = mode === 'dark';

  return (
    <header className="hdr">
      <div className="hdr-left">
        <div className="monogram">
          <span>{branding.monogram || 'L'}</span>
          <em />
        </div>
        <div className="hdr-title">
          <div className="eyebrow">{fmtDate(now)} · {fmtClock(now)}</div>
          {showGreeting !== false ? (
            <h1>
              <span className="greet">{greeting(now)},</span>{' '}
              <span className="name">{branding.user || 'Guest'}.</span>
            </h1>
          ) : (
            <h1><span className="name">{branding.title || 'Dashboard'}.</span></h1>
          )}
        </div>
      </div>

      <div className="hdr-right">
        {showCommandPalette !== false && (
          <button className="searchbtn" onClick={onOpenSearch} aria-label="Open command palette">
            <Icons.search size={16} />
            <span>Search apps, run commands…</span>
            <kbd>{isMac ? '⌘' : 'Ctrl'}</kbd><kbd>K</kbd>
          </button>
        )}
        <button className="iconbtn" onClick={() => setMode(dark ? 'light' : 'dark')} aria-label="Toggle theme">
          {dark ? <Icons.sun size={18} /> : <Icons.moon size={18} />}
        </button>
        <button className={`iconbtn ${tweaksOpen ? 'on' : ''}`} onClick={onToggleTweaks}
          aria-label={tweaksOpen ? 'Close settings' : 'Open settings'} aria-pressed={tweaksOpen}
          title={tweaksOpen ? 'Close Tweaks' : 'Open Tweaks'}>
          {tweaksOpen ? <Icons.panelCloseRight size={18} /> : <Icons.panelOpenRight size={18} />}
        </button>
      </div>
    </header>
  );
}

/* ---------------- SPARKLINE ---------------- */
function Sparkline({ data, accent = 'var(--accent)' }) {
  const w = 140, h = 34;
  const min = Math.min(...data), max = Math.max(...data);
  const range = Math.max(0.01, max - min);
  const step = w / Math.max(1, data.length - 1);
  const pts = data.map((v, i) => `${i * step},${h - ((v - min) / range) * h}`).join(' ');
  const area = `M0,${h} L${pts.split(' ').join(' L')} L${w},${h} Z`;
  return (
    <svg width={w} height={h} className="spark">
      <defs>
        <linearGradient id="sparkgrad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={accent} stopOpacity="0.18"/>
          <stop offset="100%" stopColor={accent} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <path d={area} fill="url(#sparkgrad)" />
      <polyline points={pts} fill="none" stroke={accent} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

/* ---------------- STATS STRIP ---------------- */
function Skel({ w = 60 }) { return <span className="skeleton" style={{ width: w }}>—</span>; }

const STAT_KEYS = ['cpu','ram','net','temp','containers','uptime','storage'];
const STAT_LABELS = {
  cpu: 'CPU', ram: 'Memory', net: 'Network',
  temp: 'Temperature', containers: 'Containers', uptime: 'Uptime', storage: 'Storage',
};
const HERO_KEYS = ['cpu','ram','net'];
const PILL_KEYS = ['temp','containers','uptime','storage'];

function DiskBar({ disk }) {
  const warn = disk.pct >= 85;
  return (
    <div className={`disk ${warn ? 'warn' : ''}`}>
      <div className="disk-head">
        <span className="disk-name">{disk.label}</span>
        <span className="disk-figs">
          <span className="mono">{formatBytes(disk.usedBytes)}</span>
          <span className="disk-of"> of {formatBytes(disk.totalBytes)}</span>
        </span>
        <span className="disk-pct mono">{Math.round(disk.pct)}%</span>
      </div>
      <div className="disk-track">
        <div className="disk-fill" style={{ width: `${disk.pct}%` }} />
      </div>
    </div>
  );
}

function StatsStrip({ hidden, visible, storageOpen, setStorageOpen, hosts, loaded, netHistory }) {
  const [hostIdx, setHostIdx] = useState(0);
  const [containersOpen, setContainersOpen] = useState(false);
  const [cFilter, setCFilter] = useState('all');
  if (hidden) return null;

  const multi = hosts.length > 1;
  const idx = Math.min(hostIdx, Math.max(0, hosts.length - 1));
  const host = hosts[idx] || {};

  const cpu = host.cpu;
  const mem = host.ram;
  const disks = host.disks || (host.disk ? [host.disk] : []);
  const up = host.uptimeSec;
  const cpuInfo = host.cpuInfo;
  const net = host.net;
  const containers = host.containers;
  const cpuTemp = host.temps?.cpuC;

  const totalDiskUsed = disks.reduce((a, d) => a + (d.usedBytes || 0), 0);
  const totalDiskTotal = disks.reduce((a, d) => a + (d.totalBytes || 0), 0);
  const totalDiskPct = totalDiskTotal ? Math.round((totalDiskUsed / totalDiskTotal) * 100) : 0;

  const heroShown = HERO_KEYS.filter(k => visible[k] !== false);
  const pillShown = PILL_KEYS.filter(k => visible[k] !== false);

  const pillContent = (k) => {
    if (k === 'temp') return <><em>TEMP</em><b>{cpuTemp == null ? (loaded ? 'n/a' : '—') : `${Math.round(cpuTemp)}°C`}</b></>;
    if (k === 'containers') return containers
      ? <><em>CONTAINERS</em><b>{containers.running}<span className="of">/{containers.total}</span></b></>
      : <><em>CONTAINERS</em><b>{loaded ? 'n/a' : '—'}</b></>;
    if (k === 'uptime') return <><em>UP</em><b>{fmtUptime(up) ?? (loaded ? 'n/a' : '—')}</b></>;
    if (k === 'storage') return <><em>STORAGE</em><b>{disks.length ? totalDiskPct : 0}%<span className="of"> · {disks.length} vol</span></b></>;
  };
  const containersShown = visible.containers !== false;
  const cHosts = hosts.filter(h => cFilter === 'all' || h.id === cFilter);

  return (
    <div className="stats-wrap" style={{ '--hero-cols': heroShown.length || 1 }}>
      {multi && (
        <div className="host-tabs" role="tablist" aria-label="Host">
          {hosts.map((h, i) => (
            <button
              key={h.id}
              role="tab"
              aria-selected={i === idx}
              className={`host-tab ${i === idx ? 'on' : ''}`}
              onClick={() => setHostIdx(i)}
              title={`${h.name}${h.status ? ' · ' + h.status : ''}`}
            >
              <span className={`dot ${dotClass(h.status)}`} aria-hidden />
              <span className="host-tab-name">{h.name}</span>
              <span className="host-tab-meta">{h.cpu == null ? '—' : Math.round(h.cpu) + '%'}</span>
            </button>
          ))}
        </div>
      )}
      {heroShown.length > 0 && (
        <section className="stats stats-hero">
          {visible.cpu !== false && (
            <Stat
              label="CPU"
              value={cpu == null ? <Skel w={40}/> : Math.round(cpu)}
              suffix={cpu == null ? '' : '%'}
              sub={cpuInfo ? `${cpuInfo.cores || '?'} core${cpuInfo.ghz ? ` · ${cpuInfo.ghz} GHz` : ''}` : (loaded ? 'n/a' : <Skel w={80}/>)}
              ring={cpu ?? 0}
            />
          )}
          {visible.ram !== false && (
            <Stat
              label="Memory"
              value={mem ? formatBytes(mem.usedBytes) : <Skel w={40}/>}
              suffix=""
              sub={mem ? `${mem.pct}% of ${formatBytes(mem.totalBytes)}` : (loaded ? 'n/a' : <Skel w={100}/>)}
              ring={mem?.pct ?? 0}
            />
          )}
          {visible.net !== false && (
            <div className="stat stat-wide">
              <div className="stat-head">
                <span className="stat-label">Network</span>
                <span className="stat-sub">
                  {net ? <>↓ {net.downMBs} <em>MB/s</em> &nbsp; ↑ {net.upMBs} <em>MB/s</em></> : <Skel w={120}/>}
                </span>
              </div>
              <Sparkline data={netHistory.length ? netHistory : [0,0]} />
            </div>
          )}
        </section>
      )}

      {pillShown.length > 0 && (
        <div className="pills">
          {pillShown.map((k, i) => (
            <React.Fragment key={k}>
              {i > 0 && <span className="pill-sep" aria-hidden>·</span>}
              {k === 'storage' && disks.length > 0 ? (
                <button
                  className={`pill pill-btn ${storageOpen ? 'on' : ''}`}
                  onClick={() => setStorageOpen(!storageOpen)}
                  aria-expanded={storageOpen}
                >
                  {pillContent(k)}
                  <Icons.chevDown size={12} />
                </button>
              ) : k === 'containers' && containers ? (
                <button
                  className={`pill pill-btn ${containersOpen ? 'on' : ''}`}
                  onClick={() => setContainersOpen(!containersOpen)}
                  aria-expanded={containersOpen}
                >
                  {pillContent(k)}
                  <Icons.chevDown size={12} />
                </button>
              ) : (
                <span className="pill">{pillContent(k)}</span>
              )}
            </React.Fragment>
          ))}
        </div>
      )}

      {storageOpen && disks.length > 0 && (
        <section className="storage-drawer">
          <div className="storage-head">
            <Icons.hdd size={14} />
            <span className="stat-label">Storage volumes</span>
            <span className="storage-sum">
              {formatBytes(totalDiskUsed)} used of {formatBytes(totalDiskTotal)}
            </span>
          </div>
          <div className="storage-list">
            {disks.map(d => <DiskBar key={d.id || d.label} disk={d} />)}
          </div>
        </section>
      )}

      {containersOpen && containersShown && (
        <section className="containers-drawer">
          <div className="containers-head">
            <Icons.server size={14} />
            <span className="stat-label">Containers</span>
            {multi && (
              <div className="cfilter" role="tablist">
                <button className={cFilter === 'all' ? 'on' : ''} onClick={() => setCFilter('all')}>All</button>
                {hosts.map(h => (
                  <button key={h.id} className={cFilter === h.id ? 'on' : ''} onClick={() => setCFilter(h.id)}>{h.name}</button>
                ))}
              </div>
            )}
          </div>
          <div className="containers-groups">
            {cHosts.map(h => {
              const items = h.containers?.items || [];
              return (
                <div className="chost" key={h.id}>
                  {multi && (
                    <div className="chost-head">
                      <span className={`dot ${dotClass(h.status)}`} aria-hidden />
                      <span>{h.name}</span>
                      <span className="of">{h.containers?.running ?? 0}/{h.containers?.total ?? 0}</span>
                    </div>
                  )}
                  <div className="clist">
                    {items.length ? items.map(c => (
                      <div className="crow" key={c.name} title={c.image || ''}>
                        <span className={`dot ${c.state === 'running' ? 'dot-up' : 'dot-idle'}`} aria-hidden />
                        <span className="cname">{c.name}</span>
                        <span className="cstate">{c.state}</span>
                      </div>
                    )) : <div className="cempty">no containers</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, suffix = '', sub, ring }) {
  const r = 18, c = 2 * Math.PI * r;
  const pct = Math.min(100, Math.max(0, ring || 0));
  const dash = (pct / 100) * c;
  return (
    <div className="stat">
      <div className="stat-head"><span className="stat-label">{label}</span></div>
      <div className="stat-row">
        <svg width="48" height="48" viewBox="0 0 48 48" className="ring">
          <circle cx="24" cy="24" r={r} stroke="var(--line)" strokeWidth="3" fill="none"/>
          <circle cx="24" cy="24" r={r} stroke="var(--accent)" strokeWidth="3" fill="none"
            strokeDasharray={`${dash} ${c}`} strokeLinecap="round"
            transform="rotate(-90 24 24)"/>
        </svg>
        <div>
          <div className="stat-big">{value}<span className="stat-of">{suffix}</span></div>
          {sub && <div className="stat-sub">{sub}</div>}
        </div>
      </div>
    </div>
  );
}

/* ---------------- QUICK ACTIONS (config-driven) ---------------- */
function QuickActions({ actions, onInvoke }) {
  if (!actions?.length) return null;
  return (
    <div className="qa">
      {actions.map(a => {
        const I = Icons[a.icon] || Icons.dot;
        const cls = `qa-btn ${a.primary ? 'primary' : ''} ${a.danger ? 'danger' : ''}`;
        return (
          <button key={a.id} className={cls} onClick={() => onInvoke(a)}>
            <I size={16} /><span>{a.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- FAVORITE / TILE CARDS ---------------- */
async function patchApp(id, patch) {
  const r = await fetch('/api/apps/' + encodeURIComponent(id), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error('PATCH failed: ' + r.status);
  return r.json();
}

function PinButton({ app, onChanged, size = 18, className = '' }) {
  const [busy, setBusy] = useState(false);
  const isFav = !!app.fav;
  const click = async (e) => {
    e.preventDefault(); e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      await patchApp(app.id, { fav: !isFav });
      onChanged && onChanged();
    } catch (err) {
      console.error('pin toggle failed', err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      className={`pin-btn ${isFav ? 'on' : ''} ${className}`}
      onClick={click}
      aria-pressed={isFav}
      aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'}
      title={isFav ? 'Remove from favorites' : 'Add to favorites'}
    >
      <Icons.star size={size} />
    </button>
  );
}

function PluginTileActions({ app, discovery, plugins }) {
  if (!plugins) return null;
  const elements = [];
  Object.values(plugins).forEach(p => {
    if (!p?.TileAction) return;
    if (typeof p.match === 'function' && !p.match(app, discovery)) return;
    const Comp = p.TileAction;
    elements.push(<Comp key={p.id} app={app} discovery={discovery} />);
  });
  return elements.length > 0 ? <div className="tile-actions">{elements}</div> : null;
}

// Status badge — one cohesive pill (dot + latency/state), decoupled from the pin.
function statusText(h) {
  if (h && h.latencyMs != null) return `${Math.round(h.latencyMs)} ms`;
  if (h?.status === 'down')  return 'down';
  if (h?.status === 'stale') return 'stale';
  if (h?.status === 'idle')  return 'idle';
  return 'n/a';
}
function statusPillClass(status) {
  if (status === 'down')  return 'is-down';
  if (status === 'up')    return 'is-up';
  if (status === 'stale') return 'is-stale';
  return 'is-unknown';
}
function statusTitle(h) {
  if (!h) return 'unknown · healthcheck off';
  return `${h.status}${h.httpCode ? ' · HTTP ' + h.httpCode : ''}`;
}
function StatusBadge({ h }) {
  return (
    <span className={`status-pill ${statusPillClass(h?.status)}`} title={statusTitle(h)}>
      <span className={`dot ${dotClass(h?.status)}`} aria-hidden />
      <span className="status-lat">{statusText(h)}</span>
    </span>
  );
}

function FavCard({ app, health, discovery, plugins, onAppsChanged }) {
  const h = health?.[app.id];
  return (
    <a className="fav" href={app.url || '#'} target={resolveTarget(app)} rel="noopener">
      <div className="fav-icon"><AppIcon app={app} size={28} /></div>
      <div className="fav-body">
        <div className="fav-name">{app.name}</div>
        <div className="fav-desc">{app.desc}</div>
      </div>
      <div className="fav-meta">
        <StatusBadge h={h} />
        <PluginTileActions app={app} discovery={discovery} plugins={plugins} />
        <PinButton app={app} onChanged={onAppsChanged} />
      </div>
    </a>
  );
}

function Tile({ app, health, discovery, plugins, onAppsChanged }) {
  const h = health?.[app.id];
  return (
    <a className="tile" href={app.url || '#'} target={resolveTarget(app)} rel="noopener">
      <div className="tile-icon"><AppIcon app={app} size={20} /></div>
      <div className="tile-body">
        <div className="tile-name">{app.name}</div>
        <div className="tile-desc">{app.desc}</div>
      </div>
      <div className="tile-meta">
        <span className={`dot ${dotClass(h?.status)}`} title={statusTitle(h)} />
        <PluginTileActions app={app} discovery={discovery} plugins={plugins} />
        <PinButton app={app} onChanged={onAppsChanged} className="tile-pin" />
      </div>
    </a>
  );
}

/* ---------------- COMMAND PALETTE ---------------- */
function CommandPalette({ open, onClose, apps, actions, onInvoke }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) { setQ(''); setSel(0); setTimeout(() => inputRef.current?.focus(), 50); }
  }, [open]);

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    const appItems = apps.map(a => ({ kind: 'app', ...a }));
    const actionItems = (actions || []).map(a => ({ kind: 'action', ...a }));
    const all = [...appItems, ...actionItems];
    if (!query) return all.slice(0, 12);
    return all.filter(x =>
      (x.name || x.label || '').toLowerCase().includes(query) ||
      (x.desc  || '').toLowerCase().includes(query)
    ).slice(0, 12);
  }, [q, apps, actions]);

  useEffect(() => { setSel(0); }, [q]);

  const pick = (r) => {
    if (r?.kind === 'app' && r.url) {
      const tgt = resolveTarget(r);
      if (tgt === '_blank') window.open(r.url, '_blank', 'noopener');
      else window.location.href = r.url;
    } else if (r?.kind === 'action') {
      onInvoke(r);
    }
    onClose();
  };

  const onKey = (e) => {
    if (e.key === 'Escape') onClose();
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, results.length - 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setSel(s => Math.max(0, s - 1)); }
    if (e.key === 'Enter')     { pick(results[sel]); }
  };

  if (!open) return null;
  return (
    <div className="cmd-scrim" onClick={onClose}>
      <div className="cmd" onClick={e => e.stopPropagation()}>
        <div className="cmd-input">
          <Icons.search size={18} />
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey}
            placeholder="Jump to an app, run a command…" />
          <kbd>esc</kbd>
        </div>
        <div className="cmd-list">
          {results.length === 0 && <div className="cmd-empty">No results.</div>}
          {results.map((r, i) => {
            const isApp = r.kind === 'app';
            const I = isApp
              ? null
              : (Icons[r.icon] || Icons.dot);
            return (
              <div key={r.kind + (r.id || r.label)} className={`cmd-row ${i === sel ? 'on' : ''}`}
                onMouseEnter={() => setSel(i)} onClick={() => pick(r)}>
                <div className="cmd-icn">
                  {isApp ? <AppIcon app={r} size={18} /> : <I size={18} />}
                </div>
                <div className="cmd-txt">
                  <div className="cmd-name">{isApp ? r.name : r.label}</div>
                  <div className="cmd-desc">{isApp ? r.desc : (r.payload || r.action)}</div>
                </div>
                <span className="cmd-kind">{isApp ? 'Open' : 'Run'}</span>
              </div>
            );
          })}
        </div>
        <div className="cmd-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> select</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}

/* ---------------- ADD SERVICE MODAL ---------------- */
function AddServiceModal({ open, onClose, categories, onAdded }) {
  const [form, setForm] = useState({
    name: '', desc: '', url: '', cat: categories[0]?.id || '',
    icon: '', iconSvgPath: '', fav: false, target: 'auto',
  });
  const [copied, setCopied] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);

  useEffect(() => {
    if (open) {
      setForm({ name: '', desc: '', url: '', cat: categories[0]?.id || '', icon: '', iconSvgPath: '', fav: false, target: 'auto' });
      setCopied(false); setSaveStatus(null);
    }
  }, [open, categories]);

  if (!open) return null;

  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const entry = {
    id: slug(form.name) || 'new-service',
    name: form.name || 'New Service',
    desc: form.desc || '',
    cat: form.cat,
    url: form.url || '#',
    ...(form.icon ? { icon: form.icon } : {}),
    ...(form.iconSvgPath ? { iconSvgPath: form.iconSvgPath } : {}),
    ...(form.fav ? { fav: true } : {}),
    ...(form.target && form.target !== 'auto' ? { target: form.target } : {}),
  };

  const snippet = JSON.stringify(entry, null, 2);
  const iconKeys = Object.keys(Icons).sort();

  const doCopy = async () => {
    try { await navigator.clipboard.writeText(snippet); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch {}
  };

  const doSave = async () => {
    setSaveStatus('saving');
    try {
      const res = await fetch('/api/apps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      });
      if (res.ok) { setSaveStatus('saved'); onAdded && onAdded(); setTimeout(onClose, 800); }
      else { setSaveStatus('nobackend'); }
    } catch { setSaveStatus('nobackend'); }
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>Add service</h3>
        <div className="sub">
          Save to <span className="mono">config.json</span> via the API, or copy the snippet
          and add it manually to the <span className="mono">apps</span> key.
        </div>

        <div className="field-row">
          <div className="field">
            <label>Name</label>
            <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="e.g. Portainer" />
          </div>
          <div className="field">
            <label>Category</label>
            <select value={form.cat} onChange={e => setForm({...form, cat: e.target.value})}>
              {categories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
        </div>

        <div className="field">
          <label>Description</label>
          <input value={form.desc} onChange={e => setForm({...form, desc: e.target.value})} placeholder="Container manager" />
        </div>

        <div className="field-row">
          <div className="field">
            <label>URL</label>
            <input value={form.url} onChange={e => setForm({...form, url: e.target.value})} placeholder="https://portainer.example.com  or  /portainer/" />
          </div>
          <div className="field">
            <label>Target</label>
            <select value={form.target} onChange={e => setForm({...form, target: e.target.value})}>
              <option value="auto">auto (sub-domain → tab, subfolder → same)</option>
              <option value="_blank">_blank (new tab)</option>
              <option value="_self">_self (same tab)</option>
            </select>
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label>Built-in icon</label>
            <select value={form.icon} onChange={e => setForm({...form, icon: e.target.value})}>
              <option value="">(auto — initials monogram)</option>
              {iconKeys.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Pin as favorite</label>
            <label className="tw-toggle" style={{padding: '9px 0 0 0'}}>
              <input type="checkbox" checked={form.fav} onChange={e => setForm({...form, fav: e.target.checked})} />
              <span>Show among Pinned</span>
            </label>
          </div>
        </div>

        <div className="field">
          <label>Custom SVG path (optional)</label>
          <textarea rows="2" value={form.iconSvgPath}
            onChange={e => setForm({...form, iconSvgPath: e.target.value})}
            placeholder='M12 2L4 18h16L12 3z  (d attribute of <path>, viewBox 24x24)' />
        </div>

        <div className="field">
          <label>Snippet preview <span className="mono" style={{color:'var(--ink-soft)'}}>(push into apps[])</span></label>
          <pre className="snippet">{snippet}</pre>
        </div>

        <div className="modal-actions">
          <button className="qa-btn" onClick={onClose}><Icons.close size={14}/><span>Cancel</span></button>
          <button className="qa-btn" onClick={doCopy}>
            {copied ? <Icons.check size={14}/> : <Icons.copy size={14}/>}
            <span>{copied ? 'Copied' : 'Copy snippet'}</span>
          </button>
          <button className="qa-btn primary" onClick={doSave} disabled={saveStatus==='saving' || !form.name}>
            <Icons.plus size={14}/>
            <span>{saveStatus==='saving' ? 'Saving…' : saveStatus==='saved' ? 'Saved' : saveStatus==='nobackend' ? 'Backend off — use Copy' : 'Save to config.json'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- PLUGIN STORE ---------------- */
function PluginStoreModal({ open, onClose, installed }) {
  const [registry, setRegistry] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    fetch('/api/plugins/registry')
      .then(r => r.json())
      .then(j => {
        if (j.error) setError(j.error);
        setRegistry(j.items || j || []);
      })
      .catch(e => setError(String(e)));
  }, [open]);

  if (!open) return null;
  const installedIds = new Set(installed.map(p => p.id));
  const list = Array.isArray(registry) ? registry : [];

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal modal-store" onClick={e => e.stopPropagation()}>
        <h3>Plugin Store</h3>
        <div className="sub">
          Optional extensions. Core plugins are already installed and marked with the badge.
        </div>

        <div className="store-section">
          <div className="store-h">Installed</div>
          {installed.length === 0 && <div className="store-empty">No plugins loaded.</div>}
          {installed.map(p => (
            <div className="store-row" key={p.id}>
              <div className="store-row-body">
                <div className="store-name">{p.name} <span className="badge">{p.source}</span></div>
                <div className="store-desc">{p.description || ''}</div>
                <div className="store-meta mono">v{p.version} · perms: {(p.permissions||[]).join(', ') || '—'}</div>
              </div>
              {p.homepage && <a className="qa-btn" href={p.homepage} target="_blank" rel="noopener"><span>Repo</span></a>}
            </div>
          ))}
        </div>

        <div className="store-section">
          <div className="store-h">Community</div>
          {error && <div className="shell-error">Registry: {error}</div>}
          {list.length === 0 && !error && <div className="store-empty">Registry empty or unreachable.</div>}
          {list.map(p => {
            const have = installedIds.has(p.id);
            return (
              <div className="store-row" key={p.id}>
                <div className="store-row-body">
                  <div className="store-name">{p.name} {have && <span className="badge">installed</span>}</div>
                  <div className="store-desc">{p.description || ''}</div>
                  <div className="store-meta mono">v{p.version} · {p.tags?.join(' · ') || ''}</div>
                </div>
                {p.homepage && <a className="qa-btn" href={p.homepage} target="_blank" rel="noopener"><span>Repo</span></a>}
              </div>
            );
          })}
        </div>

        <div className="modal-actions">
          <button className="qa-btn" onClick={onClose}><span>Close</span></button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- FONT LOADER ---------------- */
function applyFonts(theme) {
  const linkCss = document.getElementById('lg-fonts-css');
  if (!linkCss) return;
  if (theme.fontsOffline) {
    linkCss.remove();
    return;
  }
  const display = encodeURIComponent(theme.fontDisplay || 'Space Grotesk');
  const mono    = encodeURIComponent(theme.fontMono || 'JetBrains Mono');
  linkCss.href = `https://fonts.googleapis.com/css2?family=${display}:wght@300;400;500;600;700&family=${mono}:wght@400;500&display=swap`;
  document.documentElement.style.setProperty('--ff-display', `'${theme.fontDisplay || 'Space Grotesk'}', system-ui, sans-serif`);
  document.documentElement.style.setProperty('--ff-ui',      `'${theme.fontDisplay || 'Space Grotesk'}', system-ui, sans-serif`);
  document.documentElement.style.setProperty('--ff-mono',    `'${theme.fontMono || 'JetBrains Mono'}', ui-monospace, monospace`);
}

/* ---------------- TWEAKS PANEL (non-modal drawer) ---------------- */
function TweaksPanel({ open, onClose, themeCfg, features, prefs, setPrefs, onOpenStore, onOpenGallery, mode, currentTheme, onPickTheme, onSetMode }) {
  const [render, setRender] = useState(open);
  const [closing, setClosing] = useState(false);
  // Keep the drawer mounted through the close animation, then unmount.
  useEffect(() => {
    if (open) { setRender(true); setClosing(false); return; }
    if (!render) return;
    setClosing(true);
    const t = setTimeout(() => { setRender(false); setClosing(false); }, 300);
    return () => clearTimeout(t);
  }, [open]);
  if (!render) return null;
  const set = (k, v) => setPrefs(s => ({ ...s, [k]: v }));
  const show = (k) => prefs[k] ?? features[k] ?? true;
  const customThemes = prefs.customThemes || [];
  const curId = currentTheme ?? resolveTheme(prefs.theme ?? themeCfg.accent ?? 'ink', customThemes).id;
  // Quick grid shows only the accent identities; full "system" themes live in the
  // Theme Gallery. The active theme is appended if it isn't an accent one.
  let pickerThemes = [...ACCENT_THEMES, ...customThemes];
  if (!pickerThemes.some(t => t.id === curId)) pickerThemes = [...pickerThemes, resolveTheme(curId, customThemes)];
  return (
    <aside className={`tweaks ${closing ? 'closing' : ''}`} aria-label="Tweaks panel">
        <header>
          <h3>Tweaks</h3>
          <button className="tw-close" onClick={onClose} aria-label="Close Tweaks" title="Close · Esc">
            <Icons.close size={15} />
          </button>
        </header>

        <div className="tw-group">
          <div className="tw-label">Theme</div>
          <ThemeGroupedGrid themes={pickerThemes} mode={mode} current={curId} onPick={onPickTheme} compact />
          <button className="qa-btn" style={{ width: '100%', justifyContent: 'center', marginTop: 10 }} onClick={onOpenGallery}>
            <Icons.star size={14} /><span>Theme gallery</span>
          </button>
        </div>

        <div className="tw-group">
          <div className="tw-label">Density</div>
          <div className="tw-segment">
            {['comfortable','compact'].map(d => (
              <button key={d} className={(prefs.density ?? themeCfg.density) === d ? 'on' : ''} onClick={() => set('density', d)}>{d}</button>
            ))}
          </div>
        </div>

        <div className="tw-group">
          <div className="tw-label">Appearance</div>
          <div className="tw-segment">
            {['light','dark'].map(d => (
              <button key={d} className={mode === d ? 'on' : ''}
                onClick={() => onSetMode(d)}>{d}</button>
            ))}
          </div>
        </div>

        <div className="tw-group">
          <div className="tw-label">Group by</div>
          <div className="tw-segment">
            {[['category','Category'],['host','Host']].map(([g, label]) => (
              <button key={g} className={(prefs.groupBy ?? 'category') === g ? 'on' : ''} onClick={() => set('groupBy', g)}>{label}</button>
            ))}
          </div>
        </div>

        <div className="tw-group">
          <label className="tw-toggle">
            <input type="checkbox" checked={show('showStats')} onChange={e => set('showStats', e.target.checked)} />
            <span>Show live stats</span>
          </label>
          <label className="tw-toggle">
            <input type="checkbox" checked={show('showFavs')} onChange={e => set('showFavs', e.target.checked)} />
            <span>Show Pinned row</span>
          </label>
          <label className="tw-toggle">
            <input type="checkbox" checked={show('showQuickActions')} onChange={e => set('showQuickActions', e.target.checked)} />
            <span>Show Quick Actions</span>
          </label>
        </div>

        {show('showStats') && (
          <div className="tw-group">
            <div className="tw-label">Stats — visible</div>
            {STAT_KEYS.map(k => (
              <label key={k} className="tw-toggle">
                <input type="checkbox" checked={(prefs.statsVisible || {})[k] !== false}
                  onChange={e => setPrefs(s => ({ ...s, statsVisible: { ...(s.statsVisible || {}), [k]: e.target.checked } }))} />
                <span>{STAT_LABELS[k]}</span>
              </label>
            ))}
          </div>
        )}

        <div className="tw-group">
          <button className="qa-btn primary" style={{ width: '100%', justifyContent: 'center' }} onClick={onOpenStore}>
            <Icons.plus size={14}/><span>Plugin store</span>
          </button>
        </div>
    </aside>
  );
}

/* ---------------- APP SHELL ---------------- */
function Dashboard({ clientPrefs }) {
  const [cfg, setCfg]   = useState(null);
  const [err, setErr]   = useState(null);
  const [prefs, setPrefs] = useState(clientPrefs || {});
  const [cmdOpen, setCmdOpen]     = useState(false);
  const [tweaksOpen, setTweaksOpen] = useState(!!(clientPrefs && clientPrefs.panelOpen));
  const [addOpen, setAddOpen]       = useState(false);
  const [storeOpen, setStoreOpen]   = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [toast, setToast]           = useState(null);
  const health = useHealthStatus(30_000);
  const discovery = useDiscovery(60_000);
  const { manifests: pluginManifests, registry: pluginRegistry } = usePlugins();
  const { hosts: statHosts, loaded: statsLoaded, netHistory } = useServerStats(3000);

  const loadConfig = useCallback(async () => {
    try {
      const r = await fetch('/config.json?t=' + Date.now());
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      setCfg(j);
    } catch (e) { setErr(String(e)); }
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  // Single toggle for the (non-modal) drawer.
  const toggleTweaks = useCallback((v) => {
    setTweaksOpen(prev => (typeof v === 'boolean' ? v : !prev));
  }, []);

  // Persist open state (so it can stay open across reloads) + push the home
  // aside to make room — both react to tweaksOpen, no nested state updates.
  useEffect(() => {
    document.body.classList.toggle('tweaks-open', tweaksOpen);
    setPrefs(p => (p.panelOpen === tweaksOpen ? p : { ...p, panelOpen: tweaksOpen }));
  }, [tweaksOpen]);

  // Apply theme/mode/density to <html> + persist prefs to localStorage.
  useEffect(() => {
    if (!cfg) return;
    const t = cfg.theme || {};
    const root = document.documentElement;
    const themeId = normalizeThemeId(prefs.theme ?? t.accent ?? 'ink', prefs.mode ?? t.mode ?? 'dark');
    const theme = resolveTheme(themeId, prefs.customThemes || []);
    const mode = theme.forceMode ?? prefs.mode ?? t.mode ?? 'dark';
    // Suppress transitions while swapping accent/surface vars. Without this,
    // properties that resolve through var(--accent) AND have a transition don't
    // repaint when only the custom prop changes (a Chromium quirk) — e.g. pinned
    // stars / primary buttons would stay stuck on the previous accent.
    root.classList.add('theme-switching');
    root.dataset.theme   = themeId;
    root.dataset.mode    = mode;
    root.dataset.density = prefs.density ?? t.density ?? 'comfortable';
    applyThemeVars(root, theme, mode);
    void root.offsetWidth; // forced reflow commits the new vars with transitions OFF
    root.classList.remove('theme-switching');
    applyFonts(t);
    document.title = cfg.branding?.title || 'lgboard';
    localStorage.setItem('lgboard.prefs', JSON.stringify(prefs));
  }, [cfg, prefs]);

  // ⌘K
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCmdOpen(v => !v); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Esc dismisses the top-most layer (open modal first, then the Tweaks drawer).
  // The command palette handles its own Esc, so we step aside when it's open.
  useEffect(() => {
    const onEsc = (e) => {
      if (e.key !== 'Escape') return;
      if (cmdOpen) return;
      if (addOpen) { setAddOpen(false); return; }
      if (storeOpen) { setStoreOpen(false); return; }
      if (galleryOpen) { setGalleryOpen(false); return; }
      if (tweaksOpen) { toggleTweaks(false); return; }
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [cmdOpen, addOpen, storeOpen, galleryOpen, tweaksOpen, toggleTweaks]);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 1600); };

  const invokeAction = useCallback((a) => {
    if (!a || !a.action) return;
    if (a.action === 'url') {
      if (!a.payload) return;
      if (/^https?:\/\//i.test(a.payload)) window.open(a.payload, '_blank', 'noopener');
      else window.location.href = a.payload;
    } else if (a.action === 'copy') {
      navigator.clipboard.writeText(a.payload || '').then(
        () => showToast(`Copied: ${a.payload}`),
        () => showToast('Could not copy'),
      );
    } else if (a.action === 'modal:add-service') {
      setAddOpen(true);
    }
  }, []);

  // Save a custom theme + select it. Custom themes live in prefs (persisted to
  // localStorage with the rest of the prefs).
  const saveCustomTheme = (def) => setPrefs(p => {
    const others = (p.customThemes || []).filter(t => t.id !== def.id);
    const m = def.forceMode || p.mode || 'dark';
    return { ...p, customThemes: [...others, def], theme: def.id, mode: m,
      [m === 'light' ? 'lastLightTheme' : 'lastDarkTheme']: def.id };
  });
  // Pick a theme. Every theme is mode-locked now, so this also sets the mode and
  // remembers the pick as the last theme used in that mode.
  const pickTheme = (id) => setPrefs(p => {
    const th = resolveTheme(id, p.customThemes || []);
    const m = th.forceMode || p.mode || 'dark';
    return { ...p, theme: id, mode: m,
      [m === 'light' ? 'lastLightTheme' : 'lastDarkTheme']: id };
  });
  // Toggle light/dark. Remember the theme we're leaving, then restore the last
  // theme used in the target mode (default to that mode's Ink accent).
  const switchMode = (m) => setPrefs(p => {
    const curMode = p.mode || cfg?.theme?.mode || 'dark';
    const curId = normalizeThemeId(p.theme ?? cfg?.theme?.accent ?? 'ink', curMode);
    const leaving = curMode === 'light' ? 'lastLightTheme' : 'lastDarkTheme';
    const memo = { ...p, [leaving]: curId };
    let target = (m === 'light' ? memo.lastLightTheme : memo.lastDarkTheme) || `ink-${m}`;
    if ((resolveTheme(target, p.customThemes || []).forceMode || m) !== m) target = `ink-${m}`;
    return { ...memo, mode: m, theme: target };
  });

  if (err) return <div style={{padding: 40}}>Error loading <code>config.json</code>: {err}</div>;
  if (!cfg) return <div style={{padding: 40, color: 'var(--ink-soft)'}}>Loading…</div>;

  const features = cfg.features || {};
  const show = (k) => prefs[k] ?? features[k] ?? true;
  const apps = cfg.apps || [];
  const categories = cfg.categories || [];
  const favs = apps.filter(a => a.fav);
  const themeId = normalizeThemeId(prefs.theme ?? cfg.theme?.accent ?? 'ink', prefs.mode ?? cfg.theme?.mode ?? 'dark');
  const selectedTheme = resolveTheme(themeId, prefs.customThemes || []);
  const mode = selectedTheme.forceMode ?? prefs.mode ?? cfg.theme?.mode ?? 'dark';
  const groupBy = prefs.groupBy ?? 'category';

  // Group-by-host: an app's host is resolved from (1) an explicit `host` field,
  // (2) which host actually runs its container — matched against the live
  // per-host container lists from /api/stats, else (3) 'other' (shown last) so
  // apps we can't place aren't silently dumped onto the local host.
  const statsCfg = cfg.stats || {};
  const remoteHosts = statsCfg.remoteHosts || [];
  const hostName = (id) =>
    id === 'local' ? (statsCfg.localName || cfg.branding?.subtitle || 'local') :
    id === 'other' ? 'Other' :
    (remoteHosts.find(h => h.id === id)?.name || statHosts.find(h => h.id === id)?.name || id);
  // container name (lowercased) → host id, from the live stats payload (first
  // host wins on duplicate names, so local takes precedence over remotes).
  const containerHost = {};
  for (const h of statHosts) {
    for (const c of (h.containers?.items || [])) {
      const k = c.name && String(c.name).toLowerCase();
      if (k && !(k in containerHost)) containerHost[k] = h.id;
    }
  }
  const matchHost = (app) => {
    const keys = [app.containerName, app.id, (app.name || '').replace(/\s+/g, '-'), app.icon]
      .filter(Boolean).map(s => String(s).toLowerCase());
    for (const [cname, hid] of Object.entries(containerHost)) {
      if (keys.some(k => cname === k || cname.startsWith(k + '-'))) return hid;
    }
    return null;
  };
  const appHost = (app) => app.host || matchHost(app) || 'other';
  const hostOrder = ['local', ...remoteHosts.map(h => h.id)];
  const hostRank = (id) => id === 'other' ? 9999 : (hostOrder.indexOf(id) === -1 ? 999 : hostOrder.indexOf(id));
  const hostGroups = [...new Set(apps.map(appHost))]
    .sort((a, b) => hostRank(a) - hostRank(b))
    .map(id => ({ id, name: hostName(id) }));

  const renderApps = (list) => (
    <div className="tile-grid">
      {list.map(a => <Tile key={a.id} app={a} health={health} discovery={discovery} plugins={pluginRegistry} onAppsChanged={loadConfig} />)}
    </div>
  );

  return (
    <div className="shell">
      <Header
        branding={cfg.branding || {}}
        onOpenSearch={() => setCmdOpen(true)}
        onToggleTweaks={() => toggleTweaks()}
        tweaksOpen={tweaksOpen}
        mode={mode}
        setMode={switchMode}
        showGreeting={features.showGreeting !== false}
        showCommandPalette={features.showCommandPalette !== false}
      />

      {show('showQuickActions') && (
        <div className="row-ops">
          <QuickActions actions={cfg.quickActions || []} onInvoke={invokeAction} />
        </div>
      )}

      <StatsStrip
        hidden={!show('showStats')}
        visible={prefs.statsVisible || {}}
        storageOpen={!!prefs.storageOpen}
        setStorageOpen={(v) => setPrefs(p => ({ ...p, storageOpen: v }))}
        hosts={statHosts}
        loaded={statsLoaded}
        netHistory={netHistory}
      />

      {show('showFavs') && favs.length > 0 && (
        <section className="section">
          <div className="sect-head">
            <Icons.star size={16} />
            <h2>Pinned</h2>
            <span className="count">{favs.length}</span>
          </div>
          <div className="fav-grid">
            {favs.map(a => <FavCard key={a.id} app={a} health={health} discovery={discovery} plugins={pluginRegistry} onAppsChanged={loadConfig} />)}
          </div>
        </section>
      )}

      {groupBy === 'host' ? (
        hostGroups.map(host => {
          const list = apps.filter(a => appHost(a) === host.id);
          if (!list.length) return null;
          return (
            <section className="section" key={host.id}>
              <div className="sect-head">
                <Icons.server size={16} />
                <h2>{host.name}</h2>
                <span className="count">{list.length}</span>
              </div>
              {renderApps(list)}
            </section>
          );
        })
      ) : (
        categories.map(cat => {
          const list = apps.filter(a => a.cat === cat.id);
          if (!list.length) return null;
          const I = Icons[cat.icon] || Icons.server;
          return (
            <section className="section" key={cat.id}>
              <div className="sect-head">
                <I size={16} />
                <h2>{cat.label}</h2>
                <span className="count">{list.length}</span>
              </div>
              {renderApps(list)}
            </section>
          );
        })
      )}

      {features.showFooter !== false && (
        <footer className="foot">
          <div>{cfg.branding?.title || 'lgboard'} · <span className="mono">{cfg.branding?.subtitle || ''}</span></div>
          <div className="foot-right">
            {cfg.branding?.footerText && <span className="foot-text">{cfg.branding.footerText}</span>}
            {features.showCommandPalette !== false && <span className="foot-kbd"><kbd>⌘K</kbd> to search</span>}
            <a className="foot-link"
               href={cfg.branding?.repoUrl || 'https://github.com/lglot/lgboard'}
               target="_blank" rel="noopener" aria-label="Repository">
              <Icons.github size={14} />
              <span>Source</span>
            </a>
          </div>
        </footer>
      )}

      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} apps={apps}
        actions={cfg.quickActions || []} onInvoke={invokeAction} />
      <TweaksPanel open={tweaksOpen} onClose={() => toggleTweaks(false)}
        themeCfg={cfg.theme || {}} features={features} prefs={prefs} setPrefs={setPrefs} mode={mode}
        currentTheme={themeId} onPickTheme={pickTheme} onSetMode={switchMode}
        onOpenStore={() => setStoreOpen(true)}
        onOpenGallery={() => setGalleryOpen(true)} />
      <ThemeGalleryModal open={galleryOpen} onClose={() => setGalleryOpen(false)}
        mode={mode} current={themeId}
        customThemes={prefs.customThemes || []} author={cfg.branding?.user}
        onPick={pickTheme}
        onSaveCustom={saveCustomTheme} />
      <AddServiceModal open={addOpen} onClose={() => setAddOpen(false)}
        categories={categories} onAdded={loadConfig} />
      <PluginStoreModal open={storeOpen} onClose={() => setStoreOpen(false)}
        installed={pluginManifests} />
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

window.Dashboard = Dashboard;
