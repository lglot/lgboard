// lgboard — icon set + app icon resolver
// Lucide-style inline SVGs, 1.5 stroke, currentColor (inherit accent via parent).
// Exports on window: Ico, Icons, Monogram, AppIcon — used by themes.jsx + components.jsx.

const Ico = ({ d, children, size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {d ? <path d={d} /> : children}
  </svg>
);

const Icons = {
  // Services
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
  camera:   (p) => <Ico {...p}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></Ico>,
  music:    (p) => <Ico {...p}><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></Ico>,
  book:     (p) => <Ico {...p}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></Ico>,

  // Extra service/section icons kept for config.json compatibility (used by some apps).
  users:    (p) => <Ico {...p}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></Ico>,
  activity: (p) => <Ico {...p}><path d="M22 12h-4l-3 9-6-18-3 9H2"/></Ico>,
  git:      (p) => <Ico {...p}><circle cx="5" cy="6" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="12" r="2"/><path d="M5 8v8M7 12h10M17 12a4 4 0 0 0-4-4H5"/></Ico>,
  calendar: (p) => <Ico {...p}><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></Ico>,

  // Section icons
  media:    (p) => <Ico {...p}><path d="M3 18v-1a9 9 0 0 1 18 0v1"/><rect x="2" y="13" width="5" height="7" rx="1"/><rect x="17" y="13" width="5" height="7" rx="1"/></Ico>,
  tools:    (p) => <Ico {...p}><path d="M14 4l6 6-4 4-6-6 4-4zM10 10l-7 7v4h4l7-7"/></Ico>,
  server:   (p) => <Ico {...p}><rect x="3" y="4" width="18" height="7" rx="1"/><rect x="3" y="13" width="18" height="7" rx="1"/><path d="M7 7.5h.01M7 16.5h.01"/></Ico>,
  devices:  (p) => <Ico {...p}><rect x="3" y="4" width="13" height="10" rx="1"/><rect x="14" y="9" width="7" height="11" rx="1"/><path d="M8 20h4"/></Ico>,
  star:     (p) => <Ico {...p}><path d="M12 2l3 7 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1 3-7z"/></Ico>,

  // UI
  search:   (p) => <Ico {...p}><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></Ico>,
  sun:      (p) => <Ico {...p}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/></Ico>,
  moon:     (p) => <Ico {...p}><path d="M20 14A8 8 0 1 1 10 4a7 7 0 0 0 10 10z"/></Ico>,
  sliders:  (p) => <Ico {...p}><path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h14M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="8" cy="12" r="2"/></Ico>,
  // right-drawer affordances: chevron-into-frame = open, chevron-out = close
  panelOpenRight:  (p) => <Ico {...p}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/><path d="M11 9l-3 3 3 3"/></Ico>,
  panelCloseRight: (p) => <Ico {...p}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/><path d="M8 9l3 3-3 3"/></Ico>,
  power:    (p) => <Ico {...p}><path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/></Ico>,
  refresh:  (p) => <Ico {...p}><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></Ico>,
  close:    (p) => <Ico {...p}><path d="M6 6l12 12M18 6L6 18"/></Ico>,
  arrowReturn: (p) => <Ico {...p}><path d="M9 14l-4-4 4-4M5 10h10a4 4 0 0 1 4 4v3"/></Ico>,
  plus:     (p) => <Ico {...p}><path d="M12 5v14M5 12h14"/></Ico>,
  copy:     (p) => <Ico {...p}><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></Ico>,
  check:    (p) => <Ico {...p}><path d="M5 12l5 5 9-11"/></Ico>,
  dot:      (p) => <Ico {...p}><circle cx="12" cy="12" r="2" fill="currentColor"/></Ico>,
  link:     (p) => <Ico {...p}><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></Ico>,
  chevDown: (p) => <Ico {...p}><path d="M6 9l6 6 6-6"/></Ico>,
  thermo:   (p) => <Ico {...p}><path d="M14 14.76V3a2 2 0 1 0-4 0v11.76a4 4 0 1 0 4 0z"/></Ico>,
  hdd:      (p) => <Ico {...p}><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 12h18M7 16h.01M11 16h.01"/></Ico>,
  github:   (p) => <Ico {...p}><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></Ico>,
};

/* Fallback monogram when an app has no built-in icon (initials). */
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

Object.assign(window, { Ico, Icons, Monogram, AppIcon });
