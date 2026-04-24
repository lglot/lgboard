// lgboard — dashboard components
// Zero bundler, runs from /vendor React + Babel-standalone.

const { useState, useEffect, useRef, useMemo, useCallback } = React;

/* ---------------- ICONS ---------------- */
const Ico = ({ d, children, size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {d ? <path d={d} /> : children}
  </svg>
);

const Icons = {
  jellyfin: (p) => <Ico {...p}><path d="M12 3L4 18h16L12 3z"/><path d="M12 9L8.5 15h7L12 9z"/></Ico>,
  telegram: (p) => <Ico {...p}><path d="M21 4L2.5 11.5l6 2.5 2 6L21 4z"/><path d="M8.5 14l12.5-10-9 11"/></Ico>,
  lidarr:   (p) => <Ico {...p}><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="0.5" fill="currentColor"/></Ico>,
  sonarr:   (p) => <Ico {...p}><path d="M12 2l2.5 4.5L19 4l-1 5 5 1-4.5 2.5L22 17l-5-1-1 5-2.5-4.5L9 20l1-5-5-1 4.5-2.5L6 7l5 1 1-5z"/></Ico>,
  radarr:   (p) => <Ico {...p}><path d="M5 3l14 9-14 9V3z"/></Ico>,
  bazarr:   (p) => <Ico {...p}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 13h3M7 16h5M14 13h3M12 16h5"/></Ico>,
  prowlarr: (p) => <Ico {...p}><circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/></Ico>,
  gotify:   (p) => <Ico {...p}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M10 21a2 2 0 0 0 4 0"/></Ico>,
  adguard:  (p) => <Ico {...p}><path d="M12 2L4 5v7c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V5l-8-3z"/><path d="m9 12 2 2 4-4"/></Ico>,
  qbittorrent: (p) => <Ico {...p}><circle cx="12" cy="12" r="9"/><path d="M12 7v10M8 13l4 4 4-4"/></Ico>,
  jackett:  (p) => <Ico {...p}><rect x="4" y="3" width="16" height="18" rx="1"/><path d="M8 3v18M16 3v18M4 9h16M4 15h16"/></Ico>,
  home:     (p) => <Ico {...p}><path d="M3 10l9-7 9 7v10a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1V10z"/></Ico>,
  portainer:(p) => <Ico {...p}><path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 12l9 4 9-4M3 17l9 4 9-4"/></Ico>,
  adminer:  (p) => <Ico {...p}><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.5 3.5 3 8 3s8-1.5 8-3V5"/><path d="M4 11v6c0 1.5 3.5 3 8 3s8-1.5 8-3v-6"/></Ico>,
  dozzle:   (p) => <Ico {...p}><rect x="3" y="4" width="18" height="16" rx="1"/><path d="M7 9l3 3-3 3M13 15h4"/></Ico>,
  cockpit:  (p) => <Ico {...p}><path d="M12 2L3 7l9 5 9-5-9-5z"/><path d="M3 12l9 5 9-5M3 17l9 5 9-5"/></Ico>,
  router:   (p) => <Ico {...p}><rect x="3" y="13" width="18" height="7" rx="1"/><path d="M7 17h.01M11 17h.01M6 13V9a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v4"/></Ico>,
  router2:  (p) => <Ico {...p}><rect x="3" y="13" width="18" height="7" rx="1"/><path d="M7 17h.01M11 17h.01M15 17h.01M9 13V3M12 13V5M15 13V3"/></Ico>,
  printer:  (p) => <Ico {...p}><path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="1"/><rect x="6" y="14" width="12" height="7"/></Ico>,
  cloud:    (p) => <Ico {...p}><path d="M17.5 19a4.5 4.5 0 1 0-1-8.9 6 6 0 0 0-11.5 2.4A4 4 0 0 0 6 19h11.5z"/></Ico>,
  database: (p) => <Ico {...p}><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.5 3.5 3 8 3s8-1.5 8-3V5"/><path d="M4 11v6c0 1.5 3.5 3 8 3s8-1.5 8-3v-6"/></Ico>,
  shield:   (p) => <Ico {...p}><path d="M12 2l8 3v7c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V5l8-3z"/></Ico>,
  file:     (p) => <Ico {...p}><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M13 2v7h7"/></Ico>,
  terminal: (p) => <Ico {...p}><path d="M4 17l6-6-6-6M12 19h8"/></Ico>,
  activity: (p) => <Ico {...p}><path d="M22 12h-4l-3 9-6-18-3 9H2"/></Ico>,
  camera:   (p) => <Ico {...p}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></Ico>,
  music:    (p) => <Ico {...p}><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></Ico>,
  book:     (p) => <Ico {...p}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></Ico>,
  git:      (p) => <Ico {...p}><circle cx="5" cy="6" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="12" r="2"/><path d="M5 8v8M7 12h10M17 12a4 4 0 0 0-4-4H5"/></Ico>,
  calendar: (p) => <Ico {...p}><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></Ico>,
  media:    (p) => <Ico {...p}><path d="M3 18v-1a9 9 0 0 1 18 0v1"/><rect x="2" y="13" width="5" height="7" rx="1"/><rect x="17" y="13" width="5" height="7" rx="1"/></Ico>,
  tools:    (p) => <Ico {...p}><path d="M14 4l6 6-4 4-6-6 4-4zM10 10l-7 7v4h4l7-7"/></Ico>,
  server:   (p) => <Ico {...p}><rect x="3" y="4" width="18" height="7" rx="1"/><rect x="3" y="13" width="18" height="7" rx="1"/><path d="M7 7.5h.01M7 16.5h.01"/></Ico>,
  devices:  (p) => <Ico {...p}><rect x="3" y="4" width="13" height="10" rx="1"/><rect x="14" y="9" width="7" height="11" rx="1"/><path d="M8 20h4"/></Ico>,
  star:     (p) => <Ico {...p}><path d="M12 2l3 7 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1 3-7z"/></Ico>,
  search:   (p) => <Ico {...p}><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></Ico>,
  sun:      (p) => <Ico {...p}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/></Ico>,
  moon:     (p) => <Ico {...p}><path d="M20 14A8 8 0 1 1 10 4a7 7 0 0 0 10 10z"/></Ico>,
  sliders:  (p) => <Ico {...p}><path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h14M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="8" cy="12" r="2"/></Ico>,
  power:    (p) => <Ico {...p}><path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/></Ico>,
  refresh:  (p) => <Ico {...p}><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></Ico>,
  close:    (p) => <Ico {...p}><path d="M6 6l12 12M18 6L6 18"/></Ico>,
  arrowReturn: (p) => <Ico {...p}><path d="M9 14l-4-4 4-4M5 10h10a4 4 0 0 1 4 4v3"/></Ico>,
  plus:     (p) => <Ico {...p}><path d="M12 5v14M5 12h14"/></Ico>,
  copy:     (p) => <Ico {...p}><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></Ico>,
  check:    (p) => <Ico {...p}><path d="M5 12l5 5 9-11"/></Ico>,
  dot:      (p) => <Ico {...p}><circle cx="12" cy="12" r="2" fill="currentColor"/></Ico>,
  link:     (p) => <Ico {...p}><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></Ico>,
};

/* ---------------- FALLBACK MONOGRAM ---------------- */
function Monogram({ name, size = 22 }) {
  const initials = (name || '?').split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  const fs = size <= 20 ? 11 : size <= 28 ? 14 : 18;
  return (
    <span style={{
      width: size, height: size,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'var(--ff-display)', fontWeight: 600,
      fontSize: fs, letterSpacing: '-0.02em', color: 'currentColor',
    }}>{initials}</span>
  );
}

function AppIcon({ app, size = 22 }) {
  if (app.iconSvgPath) return <Ico d={app.iconSvgPath} size={size} />;
  const key = app.icon || app.id;
  if (key && Icons[key]) { const I = Icons[key]; return <I size={size} />; }
  return <Monogram name={app.name} size={size} />;
}

/* ---------------- HELPERS ---------------- */
const greeting = (d = new Date()) => {
  const h = d.getHours();
  if (h < 5)  return 'Buonanotte';
  if (h < 12) return 'Buongiorno';
  if (h < 18) return 'Buon pomeriggio';
  return 'Buonasera';
};
const fmtClock = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtDate  = (d) => d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

const fmtUptime = (sec) => {
  if (!sec || !isFinite(sec)) return null;
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  return `${d}d ${h}h`;
};

const resolveTarget = (app) => {
  if (app.target === '_self' || app.target === '_blank') return app.target;
  return /^https?:\/\//i.test(app.url || '') ? '_blank' : '_self';
};

/* ---------------- SERVER STATS (real via /api/stats) ---------------- */
function useServerStats(interval = 3000) {
  const [stats, setStats]   = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [history, setHistory] = useState(() => Array.from({ length: 32 }, () => 0));

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch('/api/stats', { cache: 'no-store' });
        if (!r.ok) throw new Error('http ' + r.status);
        const j = await r.json();
        if (cancelled) return;
        setStats(j);
        setLoaded(true);
        const down = j?.net?.downMBs ?? 0;
        setHistory(h => [...h.slice(1), down]);
      } catch (e) {
        if (!cancelled) setLoaded(true); // stop skeleton, show "n/a"
      }
    };
    tick();
    const id = setInterval(tick, interval);
    return () => { cancelled = true; clearInterval(id); };
  }, [interval]);

  return { stats, loaded, netHistory: history };
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
function Header({ branding, onOpenSearch, onOpenTweaks, mode, setMode, showGreeting, showCommandPalette }) {
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
          <button className="searchbtn" onClick={onOpenSearch} aria-label="Apri command palette">
            <Icons.search size={16} />
            <span>Cerca app, esegui comandi…</span>
            <kbd>{isMac ? '⌘' : 'Ctrl'}</kbd><kbd>K</kbd>
          </button>
        )}
        <button className="iconbtn" onClick={() => setMode(dark ? 'light' : 'dark')} aria-label="Toggle tema">
          {dark ? <Icons.sun size={18} /> : <Icons.moon size={18} />}
        </button>
        <button className="iconbtn" onClick={onOpenTweaks} aria-label="Impostazioni">
          <Icons.sliders size={18} />
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

function StatsStrip({ hidden }) {
  const { stats, loaded, netHistory } = useServerStats(3000);
  if (hidden) return null;

  const cpu = stats?.cpu;
  const mem = stats?.ram;
  const disk = stats?.disk;
  const up = stats?.uptimeSec;
  const cpuInfo = stats?.cpuInfo;
  const net = stats?.net;
  const containers = stats?.containers;

  return (
    <section className="stats">
      <Stat
        label="CPU"
        value={cpu == null ? <Skel w={40}/> : Math.round(cpu)}
        suffix={cpu == null ? '' : '%'}
        sub={cpuInfo ? `${cpuInfo.cores || '?'} core${cpuInfo.ghz ? ` · ${cpuInfo.ghz} GHz` : ''}` : (loaded ? 'n/a' : <Skel w={80}/>)}
        ring={cpu ?? 0}
      />
      <Stat
        label="Memoria"
        value={mem ? mem.usedGb : <Skel w={40}/>}
        suffix={mem ? ' GB' : ''}
        sub={mem ? `${mem.pct}% di ${mem.totalGb} GB` : (loaded ? 'n/a' : <Skel w={100}/>)}
        ring={mem?.pct ?? 0}
      />
      <Stat
        label="Storage"
        value={disk ? Math.round(disk.pct) : <Skel w={40}/>}
        suffix={disk ? '%' : ''}
        sub={disk ? `${disk.usedTb} TB di ${disk.totalTb} TB` : (loaded ? 'n/a' : <Skel w={100}/>)}
        ring={disk?.pct ?? 0}
      />
      <div className="stat stat-wide">
        <div className="stat-head">
          <span className="stat-label">Network</span>
          <span className="stat-sub">
            {net ? <>↓ {net.downMBs} <em>MB/s</em> &nbsp; ↑ {net.upMBs} <em>MB/s</em></> : <Skel w={120}/>}
          </span>
        </div>
        <Sparkline data={netHistory.length ? netHistory : [0,0]} />
      </div>
      {containers && (
        <div className="stat">
          <div className="stat-head"><span className="stat-label">Container</span></div>
          <div className="stat-big">{containers.running}<span className="stat-of">/{containers.total}</span></div>
          <div className="stat-sub">running</div>
        </div>
      )}
      <div className="stat">
        <div className="stat-head"><span className="stat-label">Uptime</span></div>
        <div className="stat-big stat-mono">{fmtUptime(up) ?? <Skel w={60}/>}</div>
        <div className="stat-sub">host</div>
      </div>
    </section>
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
function dotClass(status) {
  if (status === 'up')   return 'dot-up';
  if (status === 'down') return 'dot-down';
  if (status === 'idle') return 'dot-idle';
  return 'dot-unknown';
}

function FavCard({ app, health }) {
  const status = health?.[app.id]?.status;
  return (
    <a className="fav" href={app.url || '#'} target={resolveTarget(app)} rel="noopener">
      <div className="fav-icon"><AppIcon app={app} size={28} /></div>
      <div className="fav-body">
        <div className="fav-name">{app.name}</div>
        <div className="fav-desc">{app.desc}</div>
      </div>
      <div className="fav-meta">
        <span className={`dot ${dotClass(status)}`} title={health?.[app.id] ? `${status}${health[app.id].httpCode ? ' · HTTP '+health[app.id].httpCode : ''}` : 'unknown'} />
      </div>
    </a>
  );
}

function Tile({ app, health }) {
  const status = health?.[app.id]?.status;
  return (
    <a className="tile" href={app.url || '#'} target={resolveTarget(app)} rel="noopener">
      <div className="tile-icon"><AppIcon app={app} size={20} /></div>
      <div className="tile-body">
        <div className="tile-name">{app.name}</div>
        <div className="tile-desc">{app.desc}</div>
      </div>
      <span className={`dot ${dotClass(status)}`} title={health?.[app.id] ? `${status}${health[app.id].httpCode ? ' · HTTP '+health[app.id].httpCode : ''}` : 'unknown'} />
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
            placeholder="Salta a un'app, esegui un comando…" />
          <kbd>esc</kbd>
        </div>
        <div className="cmd-list">
          {results.length === 0 && <div className="cmd-empty">Nessun risultato.</div>}
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
                <span className="cmd-kind">{isApp ? 'Apri' : 'Esegui'}</span>
              </div>
            );
          })}
        </div>
        <div className="cmd-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> naviga</span>
          <span><kbd>↵</kbd> seleziona</span>
          <span><kbd>esc</kbd> chiudi</span>
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
        <h3>Aggiungi servizio</h3>
        <div className="sub">
          Salva su <span className="mono">config.json</span> tramite l'API, oppure copia lo snippet
          e aggiungilo a mano alla chiave <span className="mono">apps</span>.
        </div>

        <div className="field-row">
          <div className="field">
            <label>Nome</label>
            <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Es. Portainer" />
          </div>
          <div className="field">
            <label>Categoria</label>
            <select value={form.cat} onChange={e => setForm({...form, cat: e.target.value})}>
              {categories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
        </div>

        <div className="field">
          <label>Descrizione</label>
          <input value={form.desc} onChange={e => setForm({...form, desc: e.target.value})} placeholder="Container manager" />
        </div>

        <div className="field-row">
          <div className="field">
            <label>URL</label>
            <input value={form.url} onChange={e => setForm({...form, url: e.target.value})} placeholder="https://portainer.example.com  o  /portainer/" />
          </div>
          <div className="field">
            <label>Target</label>
            <select value={form.target} onChange={e => setForm({...form, target: e.target.value})}>
              <option value="auto">auto (sub-domain → tab, subfolder → stessa)</option>
              <option value="_blank">_blank (nuova tab)</option>
              <option value="_self">_self (stessa tab)</option>
            </select>
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label>Icona built-in</label>
            <select value={form.icon} onChange={e => setForm({...form, icon: e.target.value})}>
              <option value="">(auto — monogram iniziali)</option>
              {iconKeys.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Pin come favorito</label>
            <label className="tw-toggle" style={{padding: '9px 0 0 0'}}>
              <input type="checkbox" checked={form.fav} onChange={e => setForm({...form, fav: e.target.checked})} />
              <span>Mostra tra i Pinned</span>
            </label>
          </div>
        </div>

        <div className="field">
          <label>SVG path custom (opzionale)</label>
          <textarea rows="2" value={form.iconSvgPath}
            onChange={e => setForm({...form, iconSvgPath: e.target.value})}
            placeholder='M12 2L4 18h16L12 3z  (attributo d di <path>, viewBox 24x24)' />
        </div>

        <div className="field">
          <label>Anteprima snippet <span className="mono" style={{color:'var(--ink-soft)'}}>(push into apps[])</span></label>
          <pre className="snippet">{snippet}</pre>
        </div>

        <div className="modal-actions">
          <button className="qa-btn" onClick={onClose}><Icons.close size={14}/><span>Annulla</span></button>
          <button className="qa-btn" onClick={doCopy}>
            {copied ? <Icons.check size={14}/> : <Icons.copy size={14}/>}
            <span>{copied ? 'Copiato' : 'Copia snippet'}</span>
          </button>
          <button className="qa-btn primary" onClick={doSave} disabled={saveStatus==='saving' || !form.name}>
            <Icons.plus size={14}/>
            <span>{saveStatus==='saving' ? 'Salvo…' : saveStatus==='saved' ? 'Salvato' : saveStatus==='nobackend' ? 'Backend off — usa Copia' : 'Salva su config.json'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- TWEAKS PANEL ---------------- */
function TweaksPanel({ open, onClose, themeCfg, features, prefs, setPrefs }) {
  if (!open) return null;
  const set = (k, v) => setPrefs(s => ({ ...s, [k]: v }));
  const themes = themeCfg?.availableThemes || [];
  return (
    <div className="tweaks-scrim" onClick={onClose}>
      <aside className="tweaks" onClick={e => e.stopPropagation()}>
        <header>
          <h3>Tweaks</h3>
          <button className="iconbtn" onClick={onClose}><Icons.close size={18}/></button>
        </header>

        {themes.length > 0 && (
          <div className="tw-group">
            <div className="tw-label">Accent</div>
            <div className="tw-swatches">
              {themes.map(t => (
                <button key={t.id}
                  className={`swatch ${prefs.theme === t.id ? 'on' : ''}`}
                  style={{ '--sw': t.color }}
                  onClick={() => set('theme', t.id)}
                  aria-label={t.label}>
                  <span /><em>{t.label}</em>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="tw-group">
          <div className="tw-label">Densità</div>
          <div className="tw-segment">
            {['comfortable','compact'].map(d => (
              <button key={d} className={prefs.density === d ? 'on' : ''} onClick={() => set('density', d)}>{d}</button>
            ))}
          </div>
        </div>

        <div className="tw-group">
          <div className="tw-label">Tema</div>
          <div className="tw-segment">
            {['light','dark'].map(d => (
              <button key={d} className={prefs.mode === d ? 'on' : ''} onClick={() => set('mode', d)}>{d}</button>
            ))}
          </div>
        </div>

        <div className="tw-group">
          <label className="tw-toggle">
            <input type="checkbox" checked={prefs.showStats ?? features.showStats}
              onChange={e => set('showStats', e.target.checked)} />
            <span>Mostra live stats</span>
          </label>
          <label className="tw-toggle">
            <input type="checkbox" checked={prefs.showFavs ?? features.showFavs}
              onChange={e => set('showFavs', e.target.checked)} />
            <span>Mostra riga Pinned</span>
          </label>
          <label className="tw-toggle">
            <input type="checkbox" checked={prefs.showQuickActions ?? features.showQuickActions}
              onChange={e => set('showQuickActions', e.target.checked)} />
            <span>Mostra Quick Actions</span>
          </label>
        </div>
      </aside>
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

/* ---------------- APP SHELL ---------------- */
function Dashboard({ clientPrefs }) {
  const [cfg, setCfg]   = useState(null);
  const [err, setErr]   = useState(null);
  const [prefs, setPrefs] = useState(clientPrefs || {});
  const [cmdOpen, setCmdOpen]     = useState(false);
  const [tweaksOpen, setTweaksOpen] = useState(false);
  const [addOpen, setAddOpen]       = useState(false);
  const [toast, setToast]           = useState(null);
  const health = useHealthStatus(30_000);

  const loadConfig = useCallback(async () => {
    try {
      const r = await fetch('/config.json?t=' + Date.now());
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      setCfg(j);
    } catch (e) { setErr(String(e)); }
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  // apply theme + persist prefs
  useEffect(() => {
    if (!cfg) return;
    const theme = cfg.theme || {};
    const effective = {
      theme:    prefs.theme    ?? theme.accent    ?? 'ink',
      mode:     prefs.mode     ?? theme.mode      ?? 'dark',
      density:  prefs.density  ?? theme.density   ?? 'comfortable',
    };
    const root = document.documentElement;
    root.dataset.theme   = effective.theme;
    root.dataset.mode    = effective.mode;
    root.dataset.density = effective.density;
    if (theme.customAccentHex && effective.theme === 'custom') {
      root.style.setProperty('--accent', theme.customAccentHex);
    } else {
      root.style.removeProperty('--accent');
    }
    applyFonts(theme);
    document.title = cfg.branding?.title || 'lgboard';
    localStorage.setItem('lgboard.prefs', JSON.stringify(prefs));
  }, [cfg, prefs]);

  // ⌘K
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); setCmdOpen(v => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1600);
  };

  const invokeAction = useCallback((a) => {
    if (!a || !a.action) return;
    if (a.action === 'url') {
      if (!a.payload) return;
      if (/^https?:\/\//i.test(a.payload)) window.open(a.payload, '_blank', 'noopener');
      else window.location.href = a.payload;
    } else if (a.action === 'copy') {
      navigator.clipboard.writeText(a.payload || '').then(
        () => showToast(`Copiato: ${a.payload}`),
        () => showToast('Impossibile copiare'),
      );
    } else if (a.action === 'modal:add-service') {
      setAddOpen(true);
    }
  }, []);

  if (err) return <div style={{padding: 40}}>Errore caricamento <code>config.json</code>: {err}</div>;
  if (!cfg) return <div style={{padding: 40, color: 'var(--ink-soft)'}}>Caricamento…</div>;

  const features = cfg.features || {};
  const show = (k) => prefs[k] ?? features[k] ?? true;
  const apps = cfg.apps || [];
  const categories = cfg.categories || [];
  const favs = apps.filter(a => a.fav);
  const mode = prefs.mode ?? cfg.theme?.mode ?? 'dark';

  return (
    <div className="shell">
      <Header
        branding={cfg.branding || {}}
        onOpenSearch={() => setCmdOpen(true)}
        onOpenTweaks={() => setTweaksOpen(true)}
        mode={mode}
        setMode={(m) => setPrefs(p => ({ ...p, mode: m }))}
        showGreeting={features.showGreeting !== false}
        showCommandPalette={features.showCommandPalette !== false}
      />

      {show('showQuickActions') && (
        <div className="row-ops">
          <QuickActions actions={cfg.quickActions || []} onInvoke={invokeAction} />
          <div className="row-ops-right">
            <span className="ops-note">
              <span className={`dot inline ${Object.values(health).some(h => h.status === 'down') ? 'dot-down' : 'dot-up'}`} />
              {Object.values(health).some(h => h.status === 'down') ? 'Qualche servizio down' : 'Tutti i sistemi operativi'}
            </span>
          </div>
        </div>
      )}

      <StatsStrip hidden={!show('showStats')} />

      {show('showFavs') && favs.length > 0 && (
        <section className="section">
          <div className="sect-head">
            <Icons.star size={16} />
            <h2>Pinned</h2>
            <span className="count">{favs.length}</span>
          </div>
          <div className="fav-grid">
            {favs.map(a => <FavCard key={a.id} app={a} health={health} />)}
          </div>
        </section>
      )}

      {categories.map(cat => {
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
            <div className="tile-grid">
              {list.map(a => <Tile key={a.id} app={a} health={health} />)}
            </div>
          </section>
        );
      })}

      {features.showFooter !== false && (
        <footer className="foot">
          <div>{cfg.branding?.title || 'lgboard'} · <span className="mono">{cfg.branding?.subtitle || ''}</span></div>
          <div>
            {cfg.branding?.footerText && <span style={{marginRight:12}}>{cfg.branding.footerText}</span>}
            {features.showCommandPalette !== false && <><kbd>⌘K</kbd> per cercare</>}
          </div>
        </footer>
      )}

      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} apps={apps}
        actions={cfg.quickActions || []} onInvoke={invokeAction} />
      <TweaksPanel open={tweaksOpen} onClose={() => setTweaksOpen(false)}
        themeCfg={cfg.theme || {}} features={features} prefs={prefs} setPrefs={setPrefs} />
      <AddServiceModal open={addOpen} onClose={() => setAddOpen(false)}
        categories={categories} onAdded={loadConfig} />
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

window.Dashboard = Dashboard;
