// lgboard — theme system
// A "theme" is richer than an accent: it bundles accent color(s), an optional
// forced light/dark mode, an optional surface palette, and author/source metadata
// so predefined AND community-created themes share one shape.
// Exports on window: THEMES, COMMUNITY_THEMES, resolveTheme, applyThemeVars,
// themeColors, ThemePreview, ThemeGalleryModal.

const { useState: useTState, useEffect: useTEffect } = React;

/* ---- Theme shape ----
{ id, label, author, source: 'core'|'community'|'custom',
  forceMode?: 'light'|'dark',            // locks the mode while active
  accent: 'oklch(...)' | { light, dark },
  surfaces?: { light?: {bg,bgElev,ink,line}, dark?: {bg,bgElev,ink,line} } }
*/

// Core accent identities — each defines a light AND a dark accent. Every
// identity is expanded into TWO mode-locked themes (a Light one and a Dark one)
// so a theme never silently morphs when the mode flips: picking a theme sets the
// mode, and toggling the mode restores the last theme used in that mode.
const ACCENT_BASES = [
  { id: 'ink',      label: 'Ink',      accent: { light: 'oklch(45% 0.14 250)',  dark: 'oklch(72% 0.13 250)' } },
  { id: 'emerald',  label: 'Emerald',  accent: { light: 'oklch(52% 0.14 162)',  dark: 'oklch(75% 0.15 162)' } },
  { id: 'amber',    label: 'Amber',    accent: { light: 'oklch(60% 0.14 70)',   dark: 'oklch(80% 0.14 70)'  } },
  { id: 'rose',     label: 'Rose',     accent: { light: 'oklch(55% 0.16 15)',   dark: 'oklch(75% 0.15 15)'  } },
  { id: 'violet',   label: 'Violet',   accent: { light: 'oklch(50% 0.18 300)',  dark: 'oklch(75% 0.15 300)' } },
  { id: 'graphite', label: 'Graphite', accent: { light: 'oklch(32% 0.012 260)', dark: 'oklch(85% 0.008 260)' } },
];

// Dark variant keeps array priority (so THEMES[0] is a dark default); each gets
// an explicit '-light' / '-dark' id suffix and a forced mode.
const ACCENT_THEMES = ACCENT_BASES.flatMap(b => [
  { id: `${b.id}-dark`,  label: b.label, author: 'lgboard', source: 'core', forceMode: 'dark',  accent: { dark:  b.accent.dark  } },
  { id: `${b.id}-light`, label: b.label, author: 'lgboard', source: 'core', forceMode: 'light', accent: { light: b.accent.light } },
]);

// Bare identity ids ('ink') are legacy/stored values; map them onto a concrete
// '<id>-<mode>' theme using the active mode.
const ACCENT_BASE_IDS = new Set(ACCENT_BASES.map(b => b.id));
function normalizeThemeId(id, mode) {
  const m = mode === 'light' ? 'light' : 'dark';
  if (!id) return `ink-${m}`;
  if (ACCENT_BASE_IDS.has(id)) return `${id}-${m}`;
  return id;
}

// Full "system" themes — force a mode and retint the surfaces. Nods to well-known
// open-source color schemes. These show ONLY in the Theme Gallery (not the quick
// Tweaks grid, which keeps just the accent identities).
const FULL_THEMES = [
  { id: 'nord', label: 'Nord', author: 'arcticicestudio', source: 'core', forceMode: 'dark',
    accent: { dark: 'oklch(74% 0.09 230)' },
    surfaces: { dark: { bg: 'oklch(27% 0.02 255)', bgElev: 'oklch(31% 0.02 255)', ink: 'oklch(93% 0.01 250)', line: 'oklch(38% 0.02 255)' } } },
  { id: 'dracula', label: 'Dracula', author: 'dracula-theme', source: 'core', forceMode: 'dark',
    accent: { dark: 'oklch(76% 0.15 312)' },
    surfaces: { dark: { bg: 'oklch(25% 0.03 290)', bgElev: 'oklch(30% 0.03 290)', ink: 'oklch(95% 0.02 300)', line: 'oklch(36% 0.03 290)' } } },
  { id: 'gruvbox', label: 'Gruvbox', author: 'morhetz', source: 'core', forceMode: 'dark',
    accent: { dark: 'oklch(80% 0.13 75)' },
    surfaces: { dark: { bg: 'oklch(25% 0.012 80)', bgElev: 'oklch(29% 0.018 80)', ink: 'oklch(91% 0.03 90)', line: 'oklch(35% 0.02 80)' } } },
  { id: 'tokyonight', label: 'Tokyo Night', author: 'enkia', source: 'core', forceMode: 'dark',
    accent: { dark: 'oklch(74% 0.12 268)' },
    surfaces: { dark: { bg: 'oklch(23% 0.03 270)', bgElev: 'oklch(27% 0.03 270)', ink: 'oklch(90% 0.02 270)', line: 'oklch(33% 0.03 270)' } } },
  { id: 'rosepine', label: 'Rosé Pine', author: 'rose-pine', source: 'core', forceMode: 'dark',
    accent: { dark: 'oklch(80% 0.07 5)' },
    surfaces: { dark: { bg: 'oklch(24% 0.02 320)', bgElev: 'oklch(28% 0.02 320)', ink: 'oklch(92% 0.02 330)', line: 'oklch(34% 0.02 320)' } } },
  { id: 'everforest', label: 'Everforest', author: 'sainnhe', source: 'core', forceMode: 'dark',
    accent: { dark: 'oklch(80% 0.10 140)' },
    surfaces: { dark: { bg: 'oklch(27% 0.018 150)', bgElev: 'oklch(31% 0.02 150)', ink: 'oklch(91% 0.02 130)', line: 'oklch(37% 0.02 150)' } } },
  { id: 'mocha', label: 'Catppuccin Mocha', author: 'catppuccin', source: 'core', forceMode: 'dark',
    accent: { dark: 'oklch(80% 0.10 300)' },
    surfaces: { dark: { bg: 'oklch(22% 0.02 290)', bgElev: 'oklch(26% 0.02 290)', ink: 'oklch(92% 0.02 290)', line: 'oklch(32% 0.02 290)' } } },
  { id: 'onedark', label: 'One Dark', author: 'atom', source: 'core', forceMode: 'dark',
    accent: { dark: 'oklch(70% 0.12 230)' },
    surfaces: { dark: { bg: 'oklch(28% 0.015 250)', bgElev: 'oklch(32% 0.015 250)', ink: 'oklch(90% 0.01 250)', line: 'oklch(38% 0.015 250)' } } },
  { id: 'monokai', label: 'Monokai', author: 'monokai', source: 'core', forceMode: 'dark',
    accent: { dark: 'oklch(78% 0.17 350)' },
    surfaces: { dark: { bg: 'oklch(27% 0.012 100)', bgElev: 'oklch(31% 0.014 100)', ink: 'oklch(93% 0.02 95)', line: 'oklch(37% 0.014 100)' } } },
  { id: 'solarized', label: 'Solarized Light', author: 'altercation', source: 'core', forceMode: 'light',
    accent: { light: 'oklch(56% 0.10 200)' },
    surfaces: { light: { bg: 'oklch(96% 0.025 90)', bgElev: 'oklch(98.5% 0.02 90)', ink: 'oklch(42% 0.02 200)', line: 'oklch(88% 0.025 90)' } } },
  { id: 'latte', label: 'Catppuccin Latte', author: 'catppuccin', source: 'core', forceMode: 'light',
    accent: { light: 'oklch(52% 0.16 295)' },
    surfaces: { light: { bg: 'oklch(95% 0.012 280)', bgElev: 'oklch(98% 0.01 280)', ink: 'oklch(38% 0.03 285)', line: 'oklch(88% 0.015 285)' } } },
  { id: 'github-light', label: 'GitHub Light', author: 'github', source: 'core', forceMode: 'light',
    accent: { light: 'oklch(52% 0.17 250)' },
    surfaces: { light: { bg: 'oklch(99% 0 0)', bgElev: 'oklch(100% 0 0)', ink: 'oklch(28% 0.02 260)', line: 'oklch(90% 0.005 260)' } } },
  { id: 'mono', label: 'Monochrome', author: 'lgboard', source: 'core', forceMode: 'light',
    accent: { light: 'oklch(30% 0 0)' },
    surfaces: { light: { bg: 'oklch(97% 0 0)', bgElev: 'oklch(100% 0 0)', ink: 'oklch(20% 0 0)', line: 'oklch(89% 0 0)' } } },
];

const THEMES = [...ACCENT_THEMES, ...FULL_THEMES];

// Community gallery — empty by default (no seeded community themes). The
// Community tab shows the "publish a PR" empty state until entries are added.
const COMMUNITY_THEMES = [];

function pickAccent(theme, mode) {
  const a = theme && theme.accent;
  if (!a) return null;
  if (typeof a === 'string') return a;
  return a[mode] || a.dark || a.light || null;
}

function resolveTheme(id, customThemes = []) {
  const all = [...THEMES, ...COMMUNITY_THEMES, ...customThemes];
  // Legacy bare ids with no mode context fall back to the dark variant.
  const wanted = ACCENT_BASE_IDS.has(id) ? `${id}-dark` : id;
  return all.find(t => t.id === wanted) || all.find(t => t.id === id) || THEMES[0];
}

const SURFACE_PROPS = ['--bg', '--bg-elev', '--ink', '--ink-mid', '--ink-soft', '--line', '--line-2'];

// Apply a theme's accent + surfaces as inline custom properties on :root.
// Inline props win over the stylesheet's data-mode tokens; clearing them lets
// the neutral light/dark palette take back over.
function applyThemeVars(root, theme, mode) {
  const acc = pickAccent(theme, mode);
  if (acc) root.style.setProperty('--accent', acc); else root.style.removeProperty('--accent');

  const s = theme && theme.surfaces && theme.surfaces[mode];
  if (s) {
    const line = s.line || `color-mix(in oklab, ${s.ink} 16%, ${s.bg})`;
    root.style.setProperty('--bg', s.bg);
    root.style.setProperty('--bg-elev', s.bgElev || `color-mix(in oklab, ${s.ink} 6%, ${s.bg})`);
    root.style.setProperty('--ink', s.ink);
    root.style.setProperty('--line', line);
    root.style.setProperty('--ink-mid', `color-mix(in oklab, ${s.ink} 62%, ${s.bg})`);
    root.style.setProperty('--ink-soft', `color-mix(in oklab, ${s.ink} 40%, ${s.bg})`);
    root.style.setProperty('--line-2', `color-mix(in oklab, ${line} 50%, ${s.bg})`);
  } else {
    SURFACE_PROPS.forEach(p => root.style.removeProperty(p));
  }
}

// Colors for a static preview chip in the given mode.
function themeColors(theme, mode) {
  const s = theme.surfaces && theme.surfaces[mode];
  const bg   = s ? s.bg   : (mode === 'dark' ? 'oklch(18% 0.012 260)'  : 'oklch(98.5% 0.004 80)');
  const ink  = s ? s.ink  : (mode === 'dark' ? 'oklch(92% 0.005 80)'   : 'oklch(25% 0.012 260)');
  const line = s ? (s.line || ink) : (mode === 'dark' ? 'oklch(32% 0.012 260)' : 'oklch(90% 0.006 260)');
  const accent = pickAccent(theme, mode) || ink;
  return { bg, ink, line, accent };
}

function ThemePreview({ theme, mode }) {
  const m = theme.forceMode || mode || 'dark';
  const c = themeColors(theme, m);
  return (
    <span className="theme-prev" style={{ background: c.bg, borderColor: c.line }}>
      <span className="theme-prev-bar" style={{ background: c.accent }} />
      <span className="theme-prev-dots">
        <i style={{ background: c.accent }} />
        <i style={{ background: c.ink, opacity: 0.85 }} />
        <i style={{ background: c.line }} />
      </span>
      <span className="theme-prev-mode" style={{ color: c.ink }}>{m === 'dark' ? '◐' : '◑'}</span>
    </span>
  );
}

function ThemeCard({ theme, mode, selected, onPick }) {
  return (
    <button className={`theme-card ${selected ? 'on' : ''}`} onClick={() => onPick(theme.id)}>
      <ThemePreview theme={theme} mode={mode} />
      <span className="theme-card-meta">
        <span className="theme-card-name">{theme.label}</span>
        <span className="theme-card-author">
          {theme.source === 'custom' ? 'you' : theme.author}
          {theme.source !== 'core' && <em className={`tbadge ${theme.source}`}>{theme.source}</em>}
        </span>
      </span>
    </button>
  );
}

/* ---- Theme builder presets ---- */
const BUILDER_ACCENTS = [
  'oklch(72% 0.13 250)', 'oklch(75% 0.15 162)', 'oklch(80% 0.14 70)', 'oklch(75% 0.15 15)',
  'oklch(75% 0.15 300)', 'oklch(74% 0.10 200)', 'oklch(78% 0.13 340)', 'oklch(85% 0.008 260)',
];
const TINT_PRESETS = {
  dark: [
    { id: 'neutral', label: 'Neutral', surfaces: null },
    { id: 'slate',   label: 'Slate',  surfaces: { bg: 'oklch(22% 0.02 260)', bgElev: 'oklch(26% 0.02 260)', ink: 'oklch(93% 0.01 250)', line: 'oklch(32% 0.02 260)' } },
    { id: 'warm',    label: 'Warm',   surfaces: { bg: 'oklch(23% 0.015 60)', bgElev: 'oklch(27% 0.02 60)',  ink: 'oklch(92% 0.02 80)',  line: 'oklch(33% 0.02 60)' } },
    { id: 'plum',    label: 'Plum',   surfaces: { bg: 'oklch(23% 0.03 300)', bgElev: 'oklch(27% 0.03 300)', ink: 'oklch(94% 0.02 310)', line: 'oklch(33% 0.03 300)' } },
  ],
  light: [
    { id: 'neutral', label: 'Neutral', surfaces: null },
    { id: 'paper',   label: 'Paper',  surfaces: { bg: 'oklch(97% 0.015 90)',  bgElev: 'oklch(99% 0.01 90)',    ink: 'oklch(35% 0.02 80)',  line: 'oklch(89% 0.02 90)' } },
    { id: 'cool',    label: 'Cool',   surfaces: { bg: 'oklch(97% 0.012 230)', bgElev: 'oklch(99.5% 0.008 230)', ink: 'oklch(32% 0.02 250)', line: 'oklch(90% 0.015 230)' } },
  ],
};
const slugify = (s) => (s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function ThemeBuilder({ author, onApply }) {
  const [form, setForm] = useTState({ name: '', author: author || 'you', mode: 'dark', accent: BUILDER_ACCENTS[0], tint: 'neutral' });
  const [imp, setImp] = useTState('');
  const [copied, setCopied] = useTState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const tintDef = (TINT_PRESETS[form.mode] || []).find(t => t.id === form.tint) || TINT_PRESETS[form.mode][0];
  const def = {
    id: slugify(form.name) || 'custom-' + form.mode,
    label: form.name || 'My Theme',
    author: form.author || 'you',
    source: 'custom',
    forceMode: form.mode,
    accent: { [form.mode]: form.accent },
    ...(tintDef.surfaces ? { surfaces: { [form.mode]: tintDef.surfaces } } : {}),
  };
  const snippet = JSON.stringify(def, null, 2);

  const doCopy = async () => { try { await navigator.clipboard.writeText(snippet); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch {} };
  const doApply = () => {
    let final = def;
    if (imp.trim()) { try { final = { ...JSON.parse(imp), source: 'custom' }; } catch { return; } }
    onApply(final);
  };

  return (
    <div className="builder">
      <div className="builder-grid">
        <div className="builder-fields">
          <div className="field"><label>Name</label>
            <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Midnight" /></div>
          <div className="field"><label>Author</label>
            <input value={form.author} onChange={e => set('author', e.target.value)} placeholder="your handle" /></div>
          <div className="field"><label>Base</label>
            <div className="tw-segment">
              {['light', 'dark'].map(m => (
                <button key={m} className={form.mode === m ? 'on' : ''}
                  onClick={() => set('tint', 'neutral') || set('mode', m)}>{m}</button>
              ))}
            </div>
          </div>
          <div className="field"><label>Accent</label>
            <div className="accent-swatches">
              {BUILDER_ACCENTS.map(a => (
                <button key={a} className={`acc ${form.accent === a ? 'on' : ''}`} style={{ background: a }}
                  onClick={() => set('accent', a)} aria-label={a} />
              ))}
            </div>
            <input className="hex" value={form.accent} onChange={e => set('accent', e.target.value)}
              placeholder="oklch(...) o #hex" />
          </div>
          <div className="field"><label>Background</label>
            <div className="tw-segment wrap">
              {(TINT_PRESETS[form.mode] || []).map(t => (
                <button key={t.id} className={form.tint === t.id ? 'on' : ''} onClick={() => set('tint', t.id)}>{t.label}</button>
              ))}
            </div>
          </div>
        </div>

        <div className="builder-preview">
          <div className="builder-prev-label">Preview</div>
          <ThemePreview theme={def} mode={form.mode} />
          <div className="theme-card-name" style={{ marginTop: 8 }}>{def.label}</div>
          <div className="theme-card-author">by {def.author}</div>
        </div>
      </div>

      <div className="field" style={{ marginTop: 4 }}>
        <label>Import JSON <span className="mono" style={{ color: 'var(--ink-soft)' }}>(optional — paste a shared theme)</span></label>
        <textarea rows="2" value={imp} onChange={e => setImp(e.target.value)} placeholder='{ "id": "...", "label": "...", "accent": { "dark": "oklch(...)" } }' />
      </div>

      <div className="field">
        <label>Theme manifest <span className="mono" style={{ color: 'var(--ink-soft)' }}>(share it with the community)</span></label>
        <pre className="snippet">{imp.trim() || snippet}</pre>
      </div>

      <div className="modal-actions" style={{ borderTop: 'none', paddingTop: 0 }}>
        <button className="qa-btn" onClick={doCopy}>
          {copied ? <Icons.check size={14} /> : <Icons.copy size={14} />}
          <span>{copied ? 'Copied' : 'Copy manifest'}</span>
        </button>
        <button className="qa-btn primary" onClick={doApply} disabled={!imp.trim() && !form.name}>
          <Icons.check size={14} /><span>Apply and save</span>
        </button>
      </div>
    </div>
  );
}

/* Split themes into light/dark buckets. Mode-agnostic accents (no forceMode)
   follow the current mode, so they live in whichever bucket matches it. */
function themeTone(theme, mode) { return theme.forceMode || mode; }
function ThemeGroupedGrid({ themes, mode, current, onPick, compact }) {
  const light = themes.filter(t => themeTone(t, mode) === 'light');
  const dark  = themes.filter(t => themeTone(t, mode) === 'dark');
  const Group = ({ id, label, items }) => items.length ? (
    <div className="theme-tone">
      <div className="theme-tone-h">
        {id === 'light' ? <Icons.sun size={12} /> : <Icons.moon size={12} />}
        <span>{label}</span><em>{items.length}</em>
      </div>
      <div className={`theme-grid ${compact ? 'compact' : ''}`}>
        {items.map(t => <ThemeCard key={t.id} theme={t} mode={mode} selected={current === t.id} onPick={onPick} />)}
      </div>
    </div>
  ) : null;
  // Fixed order — Light bucket first, then Dark — regardless of the active mode,
  // so the groups never swap places when you toggle light/dark.
  const groups = [['light', 'Light', light], ['dark', 'Dark', dark]];
  return <>{groups.map(([id, label, items]) => <Group key={id} id={id} label={label} items={items} />)}</>;
}

function ThemeGalleryModal({ open, onClose, mode, current, customThemes, onPick, onSaveCustom, author }) {
  const [tab, setTab] = useTState('installed');
  useTEffect(() => { if (open) setTab('installed'); }, [open]);
  if (!open) return null;

  const installed = [...THEMES, ...customThemes];
  const tabs = [['installed', 'Installed'], ['community', 'Community'], ['create', 'Create']];

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal modal-store" onClick={e => e.stopPropagation()}>
        <h3>Theme gallery</h3>
        <div className="sub">Pick a predefined theme, browse community ones, or create your own to share.</div>

        <div className="store-tabs">
          {tabs.map(([id, label]) => (
            <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>

        {tab === 'installed' && (
          <ThemeGroupedGrid themes={installed} mode={mode} current={current} onPick={onPick} />
        )}

        {tab === 'community' && (
          <>
            <ThemeGroupedGrid themes={COMMUNITY_THEMES} mode={mode} current={current} onPick={onPick} />
            <div className="store-empty" style={{ marginTop: 8 }}>
              Publish your theme with a PR to <span className="mono">themes/</span> to see it here.
            </div>
          </>
        )}

        {tab === 'create' && (
          <ThemeBuilder author={author} onApply={(def) => { onSaveCustom(def); }} />
        )}

        <div className="modal-actions">
          <button className="qa-btn" onClick={onClose}><span>Close</span></button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, {
  THEMES, ACCENT_THEMES, COMMUNITY_THEMES, resolveTheme, normalizeThemeId, applyThemeVars, pickAccent,
  themeColors, ThemePreview, ThemeCard, ThemeGroupedGrid, ThemeGalleryModal,
});
