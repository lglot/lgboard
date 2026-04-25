// SSH plugin — UI integration.
//
// Exposes a TileAction (a "Shell" button rendered on Docker-backed tiles)
// that opens a modal hosting an iframe to the freshly-spawned ttyd session.
//
// The plugin is loaded by lgboard's frontend host via a `<script>` tag:
//   - the script must define `window.__lgboardPlugins.ssh = { ... }`
//   - the host then plugs each capability into the dashboard
//
// We deliberately avoid bundlers — runtime Babel + global React, same as the
// rest of lgboard.

(function () {
  const { useState, useEffect, useRef } = React;

  function pluginFetch(path, init = {}) {
    return fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
  }

  function ShellModal({ open, app, onClose }) {
    const [session, setSession] = useState(null);
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);
    const iframeRef = useRef(null);

    useEffect(() => {
      if (!open || !app?.containerName) return;
      let cancelled = false;
      setBusy(true);
      setError(null);
      pluginFetch('/api/_p/ssh/sessions', {
        method: 'POST',
        body: JSON.stringify({ container: app.containerName }),
      })
        .then(r => r.json().then(j => ({ ok: r.ok, j })))
        .then(({ ok, j }) => {
          if (cancelled) return;
          if (!ok) { setError(j.error || 'errore creazione sessione'); return; }
          setSession(j);
        })
        .catch(e => { if (!cancelled) setError(String(e)); })
        .finally(() => { if (!cancelled) setBusy(false); });

      return () => { cancelled = true; };
    }, [open, app?.containerName]);

    useEffect(() => {
      if (!open) return;
      return () => {
        if (session?.sid) {
          fetch(`/api/_p/ssh/sessions/${session.sid}`, { method: 'DELETE' })
            .catch(() => {});
        }
      };
    }, [open, session?.sid]);

    if (!open) return null;

    return (
      <div className="modal-scrim" onClick={onClose}>
        <div className="modal modal-shell" onClick={e => e.stopPropagation()}>
          <header className="shell-head">
            <div>
              <h3>SSH · <span className="mono">{app?.containerName || app?.name}</span></h3>
              <div className="sub">
                {session
                  ? <>Sessione <span className="mono">{session.sid}</span> · scade tra ~10 min</>
                  : (busy ? 'Avvio sessione…' : (error ? null : 'Pronto.'))}
              </div>
            </div>
            <button className="iconbtn" onClick={onClose} aria-label="Chiudi">
              <span style={{display: 'inline-flex'}}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 6l12 12M18 6L6 18"/>
                </svg>
              </span>
            </button>
          </header>
          {error && <div className="shell-error">{error}</div>}
          {session && !error && (
            <iframe
              ref={iframeRef}
              className="shell-iframe"
              src={session.url}
              title={`shell-${session.sid}`}
              allow="clipboard-read; clipboard-write"
            />
          )}
        </div>
      </div>
    );
  }

  function TileAction({ app, discovery }) {
    const [open, setOpen] = useState(false);
    const isDocker = !!discovery?.[app.id]?.isDocker;
    const containerName = discovery?.[app.id]?.container;
    if (!isDocker || !containerName) return null;

    const click = (e) => {
      e.preventDefault();
      e.stopPropagation();
      setOpen(true);
    };

    return (
      <>
        <button
          className="tile-action shell-btn"
          onClick={click}
          aria-label={`Apri shell in ${containerName}`}
          title={`Shell in ${containerName}`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 17l6-6-6-6M12 19h8"/>
          </svg>
        </button>
        <ShellModal
          open={open}
          app={{ ...app, containerName }}
          onClose={() => setOpen(false)}
        />
      </>
    );
  }

  function match(app, discovery) {
    return !!discovery?.[app.id]?.isDocker;
  }

  window.__lgboardPlugins = window.__lgboardPlugins || {};
  window.__lgboardPlugins.ssh = {
    id: 'ssh',
    TileAction,
    match,
  };
})();
