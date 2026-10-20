'use strict';
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const enc = new TextEncoder();
  const isTouch = matchMedia('(hover: none) and (pointer: coarse)').matches;
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let csrf = null, appState = {}, profiles = [];

  // ---------------------------------------------------------------- API
  async function api(method, url, body) {
    const res = await fetch(url, {
      method, credentials: 'same-origin',
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(csrf ? { 'X-CSRF': csrf } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let data = null; try { data = await res.json(); } catch {}
    if (res.status === 401 && csrf && !url.includes('/login')) { location.reload(); throw new Error('Session expired'); }
    if (!res.ok) throw new Error((data && data.error) || `Error ${res.status}`);
    return data;
  }

  // ---------------------------------------------------------------- Settings
  const THEMES = {
    classic: { name: 'Classic (black/grey)', t: { background: '#000000', foreground: '#c0c0c0', cursor: '#c0c0c0', selectionBackground: '#4a6fa5', black: '#000000', red: '#aa0000', green: '#00aa00', yellow: '#aa5500', blue: '#0000aa', magenta: '#aa00aa', cyan: '#00aaaa', white: '#aaaaaa', brightBlack: '#555555', brightRed: '#ff5555', brightGreen: '#55ff55', brightYellow: '#ffff55', brightBlue: '#5555ff', brightMagenta: '#ff55ff', brightCyan: '#55ffff', brightWhite: '#ffffff' } },
    phosphor: { name: 'Green phosphor', t: { background: '#001000', foreground: '#33ff33', cursor: '#33ff33', selectionBackground: '#146014', black: '#001000', red: '#1fa51f', green: '#33ff33', yellow: '#66ff66', blue: '#1fa51f', magenta: '#33cc33', cyan: '#66ff99', white: '#33ff33', brightBlack: '#1a5a1a', brightRed: '#55ff55', brightGreen: '#88ff88', brightYellow: '#aaffaa', brightBlue: '#55ff55', brightMagenta: '#77ff77', brightCyan: '#99ffbb', brightWhite: '#ccffcc' } },
    amber: { name: 'Amber', t: { background: '#140a00', foreground: '#ffb000', cursor: '#ffb000', selectionBackground: '#6a4600', black: '#140a00', red: '#cc6600', green: '#ffb000', yellow: '#ffcc33', blue: '#cc8800', magenta: '#ff9900', cyan: '#ffc266', white: '#ffb000', brightBlack: '#6a4600', brightRed: '#ff8800', brightGreen: '#ffc040', brightYellow: '#ffe080', brightBlue: '#ffaa33', brightMagenta: '#ffbb55', brightCyan: '#ffd9a0', brightWhite: '#fff0cc' } },
    dos: { name: 'Blue', t: { background: '#0000aa', foreground: '#c0c0c0', cursor: '#ffffff', selectionBackground: '#00aaaa', black: '#000000', red: '#aa0000', green: '#00aa00', yellow: '#aaaa00', blue: '#5555ff', magenta: '#aa00aa', cyan: '#00aaaa', white: '#aaaaaa', brightBlack: '#555555', brightRed: '#ff5555', brightGreen: '#55ff55', brightYellow: '#ffff55', brightBlue: '#8888ff', brightMagenta: '#ff55ff', brightCyan: '#55ffff', brightWhite: '#ffffff' } },
    paper: { name: 'White', t: { background: '#ffffff', foreground: '#000000', cursor: '#000000', selectionBackground: '#b5d5ff', black: '#000000', red: '#c00000', green: '#008000', yellow: '#806000', blue: '#0000c0', magenta: '#a000a0', cyan: '#008080', white: '#808080', brightBlack: '#505050', brightRed: '#ff0000', brightGreen: '#00a000', brightYellow: '#a08000', brightBlue: '#4040ff', brightMagenta: '#d000d0', brightCyan: '#00a0a0', brightWhite: '#303030' } },
    nord: { name: 'Nord', t: { background: '#2e3440', foreground: '#d8dee9', cursor: '#d8dee9', selectionBackground: '#434c5e', black: '#3b4252', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b', blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0', brightBlack: '#4c566a', brightRed: '#bf616a', brightGreen: '#a3be8c', brightYellow: '#ebcb8b', brightBlue: '#81a1c1', brightMagenta: '#b48ead', brightCyan: '#8fbcbb', brightWhite: '#eceff4' } },
    gruvbox: { name: 'Gruvbox dark', t: { background: '#282828', foreground: '#ebdbb2', cursor: '#ebdbb2', selectionBackground: '#504945', black: '#282828', red: '#cc241d', green: '#98971a', yellow: '#d79921', blue: '#458588', magenta: '#b16286', cyan: '#689d6a', white: '#a89984', brightBlack: '#928374', brightRed: '#fb4934', brightGreen: '#b8bb26', brightYellow: '#fabd2f', brightBlue: '#83a598', brightMagenta: '#d3869b', brightCyan: '#8ec07c', brightWhite: '#ebdbb2' } },
    tango: { name: 'Tango (light)', t: { background: '#fdf6e3', foreground: '#2e3436', cursor: '#2e3436', selectionBackground: '#cfe0f0', black: '#2e3436', red: '#cc0000', green: '#4e9a06', yellow: '#a07800', blue: '#3465a4', magenta: '#75507b', cyan: '#06989a', white: '#868a85', brightBlack: '#555753', brightRed: '#ef2929', brightGreen: '#4e9a06', brightYellow: '#8a6d00', brightBlue: '#3465a4', brightMagenta: '#75507b', brightCyan: '#06989a', brightWhite: '#2e3436' } },
    solar: { name: 'Solarized dark', t: { background: '#002b36', foreground: '#839496', cursor: '#93a1a1', selectionBackground: '#124b5a', black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900', blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5', brightBlack: '#586e75', brightRed: '#cb4b16', brightGreen: '#586e75', brightYellow: '#657b83', brightBlue: '#839496', brightMagenta: '#6c71c4', brightCyan: '#93a1a1', brightWhite: '#fdf6e3' } },
  };
  const FONTS = {
    mono: ['System monospace', '"Lucida Console", "DejaVu Sans Mono", Menlo, Consolas, "Liberation Mono", "Courier New", monospace'],
    courier: ['Courier New', '"Courier New", Courier, monospace'],
    lucida: ['Lucida Console', '"Lucida Console", Monaco, monospace'],
    consolas: ['Consolas / Menlo', 'Consolas, Menlo, monospace'],
    dejavu: ['DejaVu Sans Mono', '"DejaVu Sans Mono", "Liberation Mono", monospace'],
  };
  const DEFAULTS = { theme: 'classic', font: 'mono', size: isTouch ? 14 : 15, cursor: 'block', blink: true, webgl: true, scroll: 10000, autocopy: true, rclick: !isTouch, bell: false, optmeta: true, sftp: false, keys: isTouch, ui: 'auto', lh: 1, confirmpaste: true, sfHidden: false };
  let settings = { ...DEFAULTS };
  try { Object.assign(settings, JSON.parse(localStorage.getItem('wc-settings') || '{}')); } catch {}
  const applyUi = () => {
    if (settings.ui === 'light' || settings.ui === 'dark') document.documentElement.dataset.ui = settings.ui; else delete document.documentElement.dataset.ui;
    const bg = (THEMES[settings.theme] || THEMES.classic).t.background;
    for (const el of [$('#termwrap'), $('.workspace')]) if (el) el.style.background = bg;
  };
  applyUi();
  const saveSettings = () => { try { localStorage.setItem('wc-settings', JSON.stringify(settings)); } catch {} };

  // ---------------------------------------------------------------- Dialogs
  function openDlg(d) { if (!d.open) d.showModal(); }
  function ask({ title, text = '', value = null, ok = 'OK' }) {
    return new Promise((resolve) => {
      const d = $('#dlg-prompt'), inp = $('#pr-input');
      $('#pr-title').textContent = title; $('#pr-text').textContent = text;
      inp.hidden = value === null; inp.value = value || '';
      let result = null;
      const done = () => { d.removeEventListener('close', done); $('#prompt-form').onsubmit = null; $('#pr-cancel').onclick = null; resolve(result); };
      d.addEventListener('close', done);
      $('#prompt-form').onsubmit = (e) => { e.preventDefault(); result = value === null ? true : inp.value; d.close(); };
      $('#pr-cancel').onclick = () => { result = null; d.close(); };
      openDlg(d); if (value !== null) { inp.focus(); inp.select(); }
    });
  }
  const notice = (title, text) => ask({ title, text });

  // ---------------------------------------------------------------- Login
  const show = (id, on = true) => { $(id).hidden = !on; };
  const setErr = (id, m) => { $(id).textContent = m || ''; };

  async function boot() {
    try { appState = await (await fetch('/api/state', { credentials: 'same-origin' })).json(); }
    catch { show('#login-screen'); setErr('#l-err', 'Server not reachable.'); return; }
    if (appState.loggedIn) { csrf = appState.csrf; return startApp(); }
    show('#login-screen');
    if (appState.setup) {
      $('#login-title').textContent = 'SSH Console - Setup';
      show('#login-form', false); show('#setup-form'); $('#s-email').focus();
    } else {
      show('#l-totp-row', !!appState.needTotp);
      $('#l-geo').textContent = appState.needTotp
        ? 'You are logging in from outside Austria: the 2FA code is required.'
        : '';
      $('#l-email').focus();
    }
  }

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault(); setErr('#l-err', ''); $('#login-status').textContent = 'Logging in...';
    try {
      const r = await api('POST', '/api/login', { email: $('#l-email').value, password: $('#l-pass').value, totp: $('#l-totp').value });
      csrf = r.csrf; $('#l-pass').value = ''; $('#l-totp').value = '';
      show('#login-screen', false); startApp();
    } catch (err) { setErr('#l-err', err.message); $('#login-status').textContent = 'Failed'; }
  });

  let setupToken = null;
  $('#setup-form').addEventListener('submit', async (e) => {
    e.preventDefault(); setErr('#s-err', '');
    if ($('#s-pass').value !== $('#s-pass2').value) return setErr('#s-err', 'The passwords do not match.');
    try {
      const r = await api('POST', '/api/setup/start', { email: $('#s-email').value, code: $('#s-code').value, password: $('#s-pass').value });
      setupToken = r.token; $('#s-qr').src = r.qr; $('#s-secret').textContent = r.secret;
      show('#setup-form', false); show('#setup2-form'); $('#s-totp').focus();
    } catch (err) { setErr('#s-err', err.message); }
  });
  $('#setup2-form').addEventListener('submit', async (e) => {
    e.preventDefault(); setErr('#s2-err', '');
    try {
      const r = await api('POST', '/api/setup/finish', { token: setupToken, totp: $('#s-totp').value });
      csrf = r.csrf; $('#s-pass').value = $('#s-pass2').value = '';
      show('#login-screen', false); startApp();
    } catch (err) { setErr('#s2-err', err.message); }
  });

  async function doLogout() { try { await api('POST', '/api/logout', {}); } catch {} location.reload(); }

  // ---------------------------------------------------------------- Tabs and terminals
  const tabs = []; let active = null, tabSeq = 0, dragTab = null;
  const mods = { ctrl: false, alt: false };
  const termOptions = () => ({
    fontFamily: FONTS[settings.font]?.[1] || FONTS.mono[1], fontSize: settings.size, cursorBlink: settings.blink, cursorStyle: settings.cursor,
    scrollback: settings.scroll, lineHeight: settings.lh, theme: THEMES[settings.theme]?.t || THEMES.classic.t, macOptionIsMeta: settings.optmeta,
    allowProposedApi: true, allowTransparency: false, drawBoldTextInBrightColors: true, scrollSensitivity: 1, fastScrollSensitivity: 5,
    smoothScrollDuration: 0, minimumContrastRatio: 1, windowOptions: {}, rightClickSelectsWord: false, ignoreBracketedPasteMode: false,
  });

  class Tab {
    constructor(label) {
      this.id = ++tabSeq; this.label = label || 'New'; this.state = 'wait'; this.sid = null; this.ws = null;
      this.info = null; this.closing = false; this.retry = 0; this.retryTimer = null; this.pingTimer = null;
      this.pending = 0; this.flowPaused = false; this.lat = null; this.sf = { path: null, entries: [], sel: new Set(), last: null };
      this.el = document.createElement('div'); this.el.className = 'term'; $('#terms').appendChild(this.el);
      this.btn = document.createElement('div'); this.btn.className = 'tab wait'; this.btn.setAttribute('role', 'tab');
      this.btn.innerHTML = '<span class="st"></span><span class="tt"></span><button class="x" title="End session" aria-label="Close">x</button>';
      this.btn.draggable = true; this.connectedAt = null; this.custom = null;
      this.btn.addEventListener('dblclick', async (e) => { if (e.target.classList.contains('x')) return; const n = await ask({ title: 'Rename tab', text: 'Leave empty to use the default name.', value: this.custom || this.label }); if (n !== null) { this.custom = n.trim() || null; this.render(); updateStatus(); } });
      this.btn.addEventListener('dragstart', (e) => { dragTab = this; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', this.label); } catch {} });
      this.btn.addEventListener('dragover', (e) => { if (dragTab && dragTab !== this) { e.preventDefault(); this.btn.classList.add('dragover'); } });
      this.btn.addEventListener('dragleave', () => this.btn.classList.remove('dragover'));
      this.btn.addEventListener('dragend', () => { dragTab = null; $$('.tab.dragover').forEach(b => b.classList.remove('dragover')); });
      this.btn.addEventListener('drop', (e) => {
        e.preventDefault(); this.btn.classList.remove('dragover'); const d = dragTab; dragTab = null; if (!d || d === this) return;
        const from = tabs.indexOf(d), to = tabs.indexOf(this); tabs.splice(from, 1); tabs.splice(to, 0, d);
        $('#tabs').insertBefore(d.btn, from < to ? this.btn.nextSibling : this.btn);
      });
      $('#tabs').insertBefore(this.btn, $('.tab-new'));
      this.btn.addEventListener('mousedown', (e) => { if (e.button === 1) { e.preventDefault(); this.close(); } });
      this.btn.addEventListener('click', (e) => { if (e.target.classList.contains('x')) this.close(); else activate(this); });
      tabs.push(this); this.render();
    }
    render() {
      $('.tt', this.btn).textContent = this.custom || this.label;
      this.btn.classList.toggle('live', this.state === 'live'); this.btn.classList.toggle('wait', this.state === 'wait');
      this.btn.classList.toggle('dead', this.state === 'dead'); this.btn.title = this.info ? `${this.info.username}@${this.info.host}:${this.info.port}` : this.label;
    }
    initTerm() {
      const t = this.term = new Terminal(termOptions());
      this.fit = new FitAddon.FitAddon(); t.loadAddon(this.fit);
      this.search = new SearchAddon.SearchAddon(); t.loadAddon(this.search);
      try { t.loadAddon(new WebLinksAddon.WebLinksAddon((e, uri) => { const w = window.open(uri, '_blank', 'noopener,noreferrer'); })); } catch {}
      try { t.loadAddon(new ClipboardAddon.ClipboardAddon()); } catch {}
      try { const u = new Unicode11Addon.Unicode11Addon(); t.loadAddon(u); t.unicode.activeVersion = '11'; } catch {}
      try { t.loadAddon(new ImageAddon.ImageAddon()); } catch {}
      t.open(this.el);
      this.setWebgl(settings.webgl);
      t.onData((d) => this.input(d));
      t.onBinary((d) => { const b = new Uint8Array(d.length); for (let i = 0; i < d.length; i++) b[i] = d.charCodeAt(i) & 255; this.sendBytes(b); });
      t.onBell(() => { if (settings.bell) beep(); if (active !== this) this.btn.classList.add('activity'); });
      t.onTitleChange((title) => { this.remoteTitle = title; if (active === this) updateStatus(); });
      t.onResize(({ cols, rows }) => { this.sendJSON({ t: 'resize', cols, rows }); if (active === this) updateStatus(); });
      t.onSelectionChange(() => {});
      t.attachCustomKeyEventHandler((e) => keyHandler(e, this));
      this.el.addEventListener('paste', (e) => {
        const txt = e.clipboardData && e.clipboardData.getData('text'); if (!txt) return;
        if (settings.confirmpaste && /[\r\n]./.test(txt.replace(/\s+$/, ''))) { e.preventDefault(); e.stopImmediatePropagation(); safePaste(this, txt); }
      }, true);
      this.el.addEventListener('mouseup', () => { if (settings.autocopy && t.hasSelection()) copyText(t.getSelection()); });
      this.el.addEventListener('contextmenu', (e) => { if (settings.rclick) { e.preventDefault(); pasteInto(this); } });
      this.ro = new ResizeObserver(() => { if (active === this) this.refit(); });
      this.ro.observe(this.el);
    }
    setWebgl(on) {
      if (on && !this.gl) {
        try { const gl = new WebglAddon.WebglAddon(); gl.onContextLoss(() => { gl.dispose(); this.gl = null; }); this.term.loadAddon(gl); this.gl = gl; } catch { this.gl = null; }
      } else if (!on && this.gl) { try { this.gl.dispose(); } catch {} this.gl = null; }
    }
    refit() { try { if (this.el.offsetWidth > 0) this.fit.fit(); } catch {} }
    size() { return { cols: this.term.cols, rows: this.term.rows }; }

    // --- Network
    sendJSON(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
    sendBytes(b) { if (this.ws && this.ws.readyState === 1 && this.state === 'live') this.ws.send(b); }
    input(d) {
      if (mods.ctrl && d.length === 1) { const c = d.toUpperCase().charCodeAt(0); if (c >= 64 && c <= 95) d = String.fromCharCode(c - 64); else if (d === ' ') d = '\0'; }
      if (mods.alt) d = '\x1b' + d;
      if (mods.ctrl || mods.alt) { mods.ctrl = mods.alt = false; $$('.keybar .mod').forEach(b => b.classList.remove('on')); }
      this.sendBytes(enc.encode(d));
    }
    openWS(sid) {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${location.host}/ws${sid ? '?sid=' + encodeURIComponent(sid) : ''}`);
      ws.binaryType = 'arraybuffer'; this.ws = ws;
      ws.onmessage = (ev) => this.onMessage(ev);
      ws.onclose = (ev) => { if (this.ws === ws) this.onClose(ev); };
      return ws;
    }
    onMessage(ev) {
      if (typeof ev.data !== 'string') {
        const arr = new Uint8Array(ev.data); this.pending += arr.length;
        if (active !== this) this.btn.classList.add('activity');
        this.term.write(arr, () => { this.pending -= arr.length; if (this.flowPaused && this.pending < 512 * 1024) { this.flowPaused = false; this.sendJSON({ t: 'flow', pause: false }); } });
        if (!this.flowPaused && this.pending > 4 * 1024 * 1024) { this.flowPaused = true; this.sendJSON({ t: 'flow', pause: true }); }
        return;
      }
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      switch (m.t) {
        case 'status': this.onStatus && this.onStatus(m.msg); break;
        case 'hostkey': hostKeyPrompt(this, m); break;
        case 'kbd': kbdPrompt(this, m); break;
        case 'error': if (this.onError) this.onError(m.message); break;
        case 'ready':
          this.sid = m.sid; this.info = { host: m.host, port: m.port, username: m.username };
          this.state = 'live'; this.retry = 0; this.label = `${m.username}@${m.host}`; if (!this.connectedAt) this.connectedAt = Date.now(); this.render(); setOverlay(null);
          if (m.replay) this.term.reset();
          this.flowPaused = false; this.pending = 0;
          this.sendJSON({ t: 'resize', ...this.size() });
          this.startPing();
          if (this.onReady) { const f = this.onReady; this.onReady = null; f(); }
          if (active === this) { updateStatus(); this.term.focus(); }
          break;
        case 'pong': this.lat = Math.round(performance.now() - m.ts); if (active === this) updateStatus(); break;
        case 'exit': this.end('Session ended' + (m.reason ? ': ' + m.reason : '')); break;
        case 'gone': this.end('The session no longer exists on the server.'); break;
      }
    }
    onClose() {
      clearInterval(this.pingTimer);
      if (this.closing || this.state === 'dead') return;
      if (!this.sid) return;                         // still connecting: handled via onError
      this.state = 'wait'; this.render(); if (active === this) { setOverlay('Connection lost - reconnecting...'); updateStatus(); }
      const delay = Math.min(500 * 2 ** this.retry++, 5000);
      clearTimeout(this.retryTimer); this.retryTimer = setTimeout(() => this.reattach(), delay);
    }
    reattach() {
      if (this.closing || this.state === 'dead') return;
      if (this.ws && this.ws.readyState <= 1) return;
      this.openWS(this.sid);
    }
    startPing() { clearInterval(this.pingTimer); const p = () => this.sendJSON({ t: 'ping', ts: performance.now() }); p(); this.pingTimer = setInterval(p, 4000); }
    end(msg) {
      this.state = 'dead'; this.closing = true; clearInterval(this.pingTimer); clearTimeout(this.retryTimer);
      this.term && this.term.write(`\r\n\x1b[0m\x1b[7m ${msg} \x1b[0m\r\n`);
      this.render(); if (active === this) { setOverlay(null); updateStatus(); }
      try { this.ws.close(); } catch {}
    }
    close() {
      this.closing = true;
      if (this.sid && this.state !== 'dead') this.sendJSON({ t: 'close' });
      clearInterval(this.pingTimer); clearTimeout(this.retryTimer);
      try { this.ws && this.ws.close(); } catch {}
      try { this.ro && this.ro.disconnect(); this.term && this.term.dispose(); } catch {}
      this.el.remove(); this.btn.remove();
      const i = tabs.indexOf(this); if (i >= 0) tabs.splice(i, 1);
      if (active === this) { active = null; activate(tabs[Math.min(i, tabs.length - 1)] || null); }
    }
  }

  function activate(tab) {
    active = tab;
    if (tab) tab.btn.classList.remove('activity');
    for (const t of tabs) { t.el.classList.toggle('active', t === tab); t.btn.classList.toggle('active', t === tab); t.btn.setAttribute('aria-selected', t === tab); }
    show('#empty', !tab);
    setOverlay(tab && tab.state === 'wait' && tab.sid ? 'Connection lost - reconnecting...' : null);
    if (tab) { requestAnimationFrame(() => { tab.refit(); tab.term.focus(); }); tab.btn.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
    updateStatus(); sfRefreshForTab();
  }
  const fmtUp = (ms) => { const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h}h ${String(m).padStart(2, '0')}m` : m ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`; };
  setInterval(() => { if (active && active.connectedAt) updateStatus(); }, 1000);
  function setOverlay(msg) { const o = $('#overlay'); o.hidden = !msg; o.textContent = msg || ''; }
  function updateStatus() {
    const t = active;
    $('#st-state').textContent = !t ? 'No session' : t.state === 'live' ? 'Connected' : t.state === 'wait' ? 'Connecting...' : 'Disconnected';
    $('#st-host').textContent = t && t.info ? `${t.info.username}@${t.info.host}:${t.info.port}` : '';
    $('#st-size').textContent = t && t.term ? `${t.term.cols}x${t.term.rows}` : '';
    $('#st-up').textContent = t && t.connectedAt && t.state !== 'dead' ? fmtUp(Date.now() - t.connectedAt) : '';
    const l = $('#st-lat'); l.textContent = t && t.lat != null && t.state === 'live' ? `${t.lat} ms` : '- ms';
    l.className = t && t.lat != null && t.state === 'live' ? (t.lat >= 250 ? 'bad' : t.lat < 80 ? 'good' : '') : '';
    document.title = t && t.info ? `${t.custom || t.remoteTitle || t.label} - SSH Console` : 'SSH Console';
  }

  // ---------------------------------------------------------------- Keys, clipboard
  function beep() { try { const c = new (window.AudioContext || window.webkitAudioContext)(); const o = c.createOscillator(); const g = c.createGain(); o.frequency.value = 880; g.gain.value = .05; o.connect(g); g.connect(c.destination); o.start(); setTimeout(() => { o.stop(); c.close(); }, 80); } catch {} }
  async function copyText(text) { try { await navigator.clipboard.writeText(text); } catch { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = 0; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch {} ta.remove(); } }
  // Multi-line pastes can run commands the moment they arrive: optionally ask first.
  async function safePaste(tab, txt) {
    if (!txt) return;
    if (settings.confirmpaste && /[\r\n]./.test(txt.replace(/\s+$/, ''))) {
      const n = txt.replace(/\s+$/, '').split(/\r\n|\r|\n/).length;
      if (!await ask({ title: 'Paste multiple lines', text: `You are about to paste ${n} lines. Lines may run as commands immediately. Continue?` })) { tab.term.focus(); return; }
    }
    tab.term.paste(txt); tab.term.focus();
  }
  async function pasteInto(tab) {
    if (!tab) return;
    try { const txt = await navigator.clipboard.readText(); if (txt) await safePaste(tab, txt); }
    catch { notice('Paste', 'The browser denied clipboard access. Use Ctrl+Shift+V.'); }
    tab.term.focus();
  }
  // Everything except Ctrl+Shift+<app shortcut> is passed through to the remote program untouched.
  function keyHandler(e, tab) {
    if (e.type !== 'keydown') return true;
    const k = e.key;
    if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey) {
      if (k === 'C' || k === 'c') { e.preventDefault(); if (tab.term.hasSelection()) copyText(tab.term.getSelection()); return false; }
      if (k === 'V' || k === 'v') return false;                  // the native paste event does the rest
      if (k === 'F' || k === 'f') { e.preventDefault(); toggleSearch(true); return false; }
      if (k === 'N' || k === 'n') { e.preventDefault(); openConnect(); return false; }
      if (k === 'ArrowLeft' || k === 'ArrowRight') { const i = tabs.indexOf(tab) + (k === 'ArrowLeft' ? -1 : 1); e.preventDefault(); if (tabs[i]) activate(tabs[i]); return false; }
      if (k === '+' || k === '_' || k === ')') { e.preventDefault(); zoom(k === '+' ? 1 : k === '_' ? -1 : 0); return false; }
      // Other Ctrl+Shift+<letter>: classic terminals send the same control code as Ctrl+<letter>.
      if (/^[a-zA-Z]$/.test(k)) { e.preventDefault(); tab.sendBytes(Uint8Array.of(k.toUpperCase().charCodeAt(0) - 64)); return false; }
    }
    // Ctrl+- and Ctrl+/ are ^_ (0x1f, "undo" in emacs/readline); xterm.js does not emit it, and the browser would zoom.
    if (e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey && (k === '-' || k === '/')) { e.preventDefault(); tab.sendBytes(Uint8Array.of(0x1f)); return false; }
    if (e.ctrlKey && !e.altKey && !e.metaKey && (k === '=' || k === '+' || k === '0')) { e.preventDefault(); return false; }   // keep the browser from zooming the page
    return true;
  }
  function zoom(d) {
    settings.size = d === 0 ? DEFAULTS.size : Math.max(8, Math.min(40, settings.size + d)); saveSettings();
    for (const t of tabs) { t.term.options.fontSize = settings.size; } if (active) active.refit();
  }

  const CSI = { up: 'A', down: 'B', right: 'C', left: 'D' };
  function sendKey(name) {
    const t = active; if (!t) return;
    const app = t.term.modes.applicationCursorKeysMode;
    const map = { esc: '\x1b', tab: '\t', home: app ? '\x1bOH' : '\x1b[H', end: app ? '\x1bOF' : '\x1b[F', pgup: '\x1b[5~', pgdn: '\x1b[6~', del: '\x1b[3~', ins: '\x1b[2~', ctrlc: '\x03', ctrld: '\x04', ctrlz: '\x1a' };
    if (CSI[name]) t.input((app ? '\x1bO' : '\x1b[') + CSI[name]);
    else if (name in map) t.input(map[name]);
    else t.input(name);
    t.term.focus();
  }
  function buildFkeys() {
    const codes = ['\x1bOP', '\x1bOQ', '\x1bOR', '\x1bOS', '\x1b[15~', '\x1b[17~', '\x1b[18~', '\x1b[19~', '\x1b[20~', '\x1b[21~', '\x1b[23~', '\x1b[24~'];
    $('#fkeys').innerHTML = codes.map((c, i) => `<button data-f="${i}">F${i + 1}</button>`).join('');
    $('#fkeys').addEventListener('mousedown', e => e.preventDefault());
    $('#fkeys').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && active) { active.input(codes[+b.dataset.f]); active.term.focus(); } });
  }
  $('#keybar').addEventListener('mousedown', e => e.preventDefault());
  $('#keybar').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return; const k = b.dataset.k;
    if (k === 'ctrl' || k === 'alt') { mods[k] = !mods[k]; b.classList.toggle('on', mods[k]); active && active.term.focus(); return; }
    if (k === 'fkeys') { $('#fkeys').hidden = !$('#fkeys').hidden; refitSoon(); return; }
    if (k === 'paste') return pasteInto(active);
    sendKey(k);
  });

  // ---------------------------------------------------------------- Search
  function toggleSearch(on) {
    const bar = $('#searchbar'); bar.hidden = on === undefined ? !bar.hidden : !on;
    if (!bar.hidden) { $('#search-input').focus(); $('#search-input').select(); } else if (active) { active.search.clearDecorations(); active.term.focus(); }
  }
  function doSearch(dir) {
    if (!active) return; const q = $('#search-input').value; if (!q) return;
    const o = { caseSensitive: $('#search-case').checked, regex: $('#search-re').checked, decorations: { matchBackground: '#ffff0080', activeMatchBackground: '#ff8000', matchOverviewRuler: '#ffff00', activeMatchColorOverviewRuler: '#ff8000' } };
    dir > 0 ? active.search.findNext(q, o) : active.search.findPrevious(q, o);
  }
  $('#search-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSearch(e.shiftKey ? -1 : 1); } else if (e.key === 'Escape') toggleSearch(false); });
  $('#search-next').onclick = () => doSearch(1); $('#search-prev').onclick = () => doSearch(-1); $('#search-close').onclick = () => toggleSearch(false);

  // ---------------------------------------------------------------- Connect
  const LOCAL_PROFILE = { id: '_local', name: 'This server (benj@127.0.0.1)', host: '127.0.0.1', port: 22, username: 'benj', builtin: true };
  function fillProfileSelect(selectId) {
    const sel = $('#c-profile'); sel.innerHTML = '';
    const opt = (v, t) => { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); };
    opt('', '- New connection -'); opt(LOCAL_PROFILE.id, LOCAL_PROFILE.name);
    for (const p of profiles) opt(p.id, `${p.name} (${p.username}@${p.host}${p.port !== 22 ? ':' + p.port : ''})`);
    sel.value = selectId ?? LOCAL_PROFILE.id;
  }
  function applyProfile(id) {
    const p = id === LOCAL_PROFILE.id ? LOCAL_PROFILE : profiles.find(x => x.id === id);
    if (p) { $('#c-host').value = p.host; $('#c-port').value = p.port; $('#c-user').value = p.username; $('#c-legacy').checked = !!p.legacy; $('#c-startup').value = p.startup || ''; $('#c-name').value = p.name; $('#c-save').checked = false; $('#c-name-row').hidden = true; }
    $('#c-prof-del').disabled = !p || !!p.builtin;
  }
  async function openConnect(prefill) {
    try { profiles = await api('GET', '/api/profiles'); } catch {}
    fillProfileSelect(prefill ? '' : LOCAL_PROFILE.id);
    if (prefill) { $('#c-host').value = prefill.host; $('#c-port').value = prefill.port; $('#c-user').value = prefill.username; $('#c-startup').value = ''; $('#c-prof-del').disabled = true; } else applyProfile(LOCAL_PROFILE.id);
    $('#c-pass').value = ''; $('#c-key').value = ''; $('#c-pp').value = '';
    setErr('#c-err', ''); $('#c-status').textContent = ''; setConnectBusy(false);
    openDlg($('#dlg-connect'));
    ($('#c-pass').value === '' ? $('#c-pass') : $('#c-host')).focus();
  }
  function setConnectBusy(b) { $$('#connect-form input, #connect-form select, #connect-form textarea, #c-go, #c-prof-del, #c-key-file').forEach(x => x.disabled = b); }
  $('#c-profile').onchange = (e) => applyProfile(e.target.value);
  $('#c-prof-del').onclick = async () => { const id = $('#c-profile').value; if (!id || id === '_local') return; await api('DELETE', '/api/profiles/' + encodeURIComponent(id)); profiles = profiles.filter(p => p.id !== id); fillProfileSelect(''); $('#c-prof-del').disabled = true; };
  $$('input[name=auth]').forEach(r => r.addEventListener('change', () => { const key = $('input[name=auth]:checked').value === 'key'; show('#c-auth-pw', !key); show('#c-auth-key', key); }));
  $('#c-save').onchange = (e) => { $('#c-name-row').hidden = !e.target.checked; if (e.target.checked && !$('#c-name').value) $('#c-name').value = `${$('#c-user').value}@${$('#c-host').value}`; };
  $('#c-key-file').onclick = () => $('#c-key-input').click();
  $('#c-key-input').onchange = async (e) => { const f = e.target.files[0]; if (f && f.size < 100000) $('#c-key').value = await f.text(); e.target.value = ''; };

  let connecting = null;
  $('#connect-form').addEventListener('submit', (e) => {
    e.preventDefault(); if (connecting) return;
    const useKey = $('input[name=auth]:checked').value === 'key';
    const params = {
      t: 'connect', host: $('#c-host').value.trim(), port: +$('#c-port').value || 22, username: $('#c-user').value.trim(),
      password: useKey ? undefined : $('#c-pass').value, privateKey: useKey ? $('#c-key').value : undefined, passphrase: useKey ? $('#c-pp').value : undefined,
      legacy: $('#c-legacy').checked,
    };
    const startup = $('#c-startup').value;
    setErr('#c-err', ''); setConnectBusy(true);
    const tab = new Tab(`${params.username}@${params.host}`); activate(tab); tab.initTerm(); connecting = tab;
    $('#c-status').textContent = 'Connecting...';
    const cleanup = () => { connecting = null; setConnectBusy(false); };
    tab.onStatus = (m) => { $('#c-status').textContent = m; };
    tab.onError = (m) => { tab.sid = null; tab.close(); cleanup(); $('#c-status').textContent = ''; setErr('#c-err', m); $('#c-pass').select(); };
    tab.onReady = async () => {
      cleanup(); if (startup.trim()) setTimeout(() => tab.input(startup.trim() + '\r'), 350); $('#dlg-connect').close(); $('#c-pass').value = $('#c-key').value = $('#c-pp').value = '';
      if ($('#c-save').checked) { try { await api('POST', '/api/profiles', { name: $('#c-name').value, host: params.host, port: params.port, username: params.username, legacy: params.legacy, startup }); } catch {} }
    };
    tab.closing = false;
    const ws = tab.openWS(null);
    ws.onopen = () => ws.send(JSON.stringify({ ...params, ...tab.size() }));
    ws.addEventListener('close', () => { if (connecting === tab) tab.onError('Connection to the gateway was lost.'); });
  });
  const cancelConnect = () => {
    if (connecting) { const t = connecting; connecting = null; t.sendJSON({ t: 'abort' }); t.sid = null; t.close(); }
    setConnectBusy(false); $('#dlg-connect').close();
  };
  $('#c-cancel').onclick = cancelConnect;
  $('#dlg-connect').addEventListener('cancel', (e) => { e.preventDefault(); cancelConnect(); });

  function hostKeyPrompt(tab, m) {
    const d = $('#dlg-hostkey');
    $('#hk-title').textContent = m.changed ? 'WARNING: host key has changed!' : 'Unknown server';
    $('#hk-text').textContent = m.changed
      ? `The key of ${m.host}:${m.port} differs from the stored one. This may be an attack (man-in-the-middle) or the server was reinstalled. Only continue if you expect this.`
      : `This is the first connection to ${m.host}:${m.port}. Check the fingerprint if you know it.`;
    $('#hk-alg').textContent = m.alg; $('#hk-fp').textContent = m.fp;
    show('#hk-old', !!m.changed); show('#hk-oldfp', !!m.changed); $('#hk-oldfp').textContent = m.oldFp || '';
    $('#hk-remember').checked = true;
    const answer = (accept) => { d.onclose = null; if (d.open) d.close(); tab.sendJSON({ t: 'hostkey-answer', accept, remember: $('#hk-remember').checked }); };
    $('#hk-yes').onclick = () => answer(true); $('#hk-no').onclick = () => answer(false);
    d.oncancel = (e) => { e.preventDefault(); answer(false); };
    openDlg(d); $('#hk-no').focus();
  }
  function kbdPrompt(tab, m) {
    const d = $('#dlg-kbd'); $('#kbd-title').textContent = m.name || 'Additional authentication'; $('#kbd-instr').textContent = m.instructions || '';
    const box = $('#kbd-fields'); box.innerHTML = '';
    m.prompts.forEach((p) => { const l = document.createElement('label'); l.textContent = p.prompt; const i = document.createElement('input'); i.type = p.echo ? 'text' : 'password'; i.autocomplete = 'off'; l.appendChild(i); box.appendChild(l); });
    const send = (resp) => { d.close(); tab.sendJSON({ t: 'kbd-answer', responses: resp }); };
    $('#kbd-form').onsubmit = (e) => { e.preventDefault(); send($$('input', box).map(i => i.value)); };
    $('#kbd-cancel').onclick = () => send(null);
    d.oncancel = (e) => { e.preventDefault(); send(null); };
    openDlg(d); const f = $('input', box); f && f.focus();
  }

  // ---------------------------------------------------------------- Settings dialog
  function openSettings() {
    const sel = $('#o-theme'); sel.innerHTML = Object.entries(THEMES).map(([k, v]) => `<option value="${k}">${esc(v.name)}</option>`).join('');
    $('#o-font').innerHTML = Object.entries(FONTS).map(([k, v]) => `<option value="${k}">${esc(v[0])}</option>`).join('');
    $('#o-ui').value = settings.ui; $('#o-lh').value = settings.lh; $('#o-confirmpaste').checked = settings.confirmpaste; $('#o-theme').value = settings.theme; $('#o-font').value = settings.font; $('#o-size').value = settings.size; $('#o-cursor').value = settings.cursor;
    $('#o-blink').checked = settings.blink; $('#o-webgl').checked = settings.webgl; $('#o-scroll').value = settings.scroll;
    $('#o-autocopy').checked = settings.autocopy; $('#o-rclick').checked = settings.rclick; $('#o-bell').checked = settings.bell; $('#o-optmeta').checked = settings.optmeta;
    openDlg($('#dlg-settings'));
  }
  function applySettings() {
    for (const t of tabs) {
      const o = termOptions(); for (const k of ['fontFamily', 'lineHeight', 'fontSize', 'cursorBlink', 'cursorStyle', 'scrollback', 'theme', 'macOptionIsMeta']) t.term.options[k] = o[k];
      t.setWebgl(settings.webgl);
    }
    applyUi(); if (active) active.refit();
  }
  $('#o-ok').onclick = () => {
    Object.assign(settings, {
      theme: $('#o-theme').value, font: $('#o-font').value, size: Math.max(8, Math.min(40, +$('#o-size').value || 15)), cursor: $('#o-cursor').value,
      blink: $('#o-blink').checked, webgl: $('#o-webgl').checked, scroll: Math.max(500, Math.min(200000, +$('#o-scroll').value || 10000)),
      ui: $('#o-ui').value, lh: Math.max(1, Math.min(1.6, +$('#o-lh').value || 1)), confirmpaste: $('#o-confirmpaste').checked, autocopy: $('#o-autocopy').checked, rclick: $('#o-rclick').checked, bell: $('#o-bell').checked, optmeta: $('#o-optmeta').checked,
    });
    saveSettings(); applySettings();
  };
  $('#o-reset').onclick = () => { settings = { ...DEFAULTS, sftp: settings.sftp, keys: settings.keys }; saveSettings(); applySettings(); $('#dlg-settings').close(); };

  // ---------------------------------------------------------------- Account
  async function openAccount() {
    openDlg($('#dlg-account')); show('#pw-totp-row', !!appState.needTotp); $('#pw-msg').textContent = ''; $('#pw-msg').className = '';
    const when = (ts) => new Date(ts).toLocaleString('en-GB');
    try {
      const [ss, kh, au] = await Promise.all([api('GET', '/api/sessions'), api('GET', '/api/knownhosts'), api('GET', '/api/audit')]);
      $('#acc-sessions').innerHTML = ss.length ? `<table>${ss.map(s => `<tr><td>${esc(s.username)}@${esc(s.host)}:${s.port}</td><td>since ${when(s.created)}</td><td>${s.attached ? 'attached' : 'detached'}</td><td><button data-kill="${esc(s.id)}">End</button></td></tr>`).join('')}</table>` : '<div>No open sessions.</div>';
      const hk = Object.entries(kh);
      $('#acc-hosts').innerHTML = hk.length ? `<table>${hk.map(([h, v]) => `<tr><td>${esc(h)}</td><td>${esc(v.alg)}</td><td style="font-family:monospace">${esc(v.fp)}</td><td><button data-forget="${esc(h)}">Forget</button></td></tr>`).join('')}</table>` : '<div>No servers stored yet.</div>';
      $('#acc-audit').innerHTML = `<table>${au.map(a => `<tr><td>${when(a.ts)}</td><td>${esc(a.type)}</td><td>${esc(a.ip)}</td><td>${esc(a.detail)}</td></tr>`).join('')}</table>`;
    } catch (e) { $('#acc-sessions').textContent = e.message; }
  }
  $('#dlg-account').addEventListener('click', async (e) => {
    const k = e.target.closest('[data-kill]'), f = e.target.closest('[data-forget]');
    if (k) { await api('DELETE', '/api/sessions/' + k.dataset.kill); openAccount(); }
    if (f) { await api('DELETE', '/api/knownhosts', { host: f.dataset.forget }); openAccount(); }
  });
  $('#pw-form').addEventListener('submit', async (e) => {
    e.preventDefault(); const m = $('#pw-msg');
    try { await api('POST', '/api/password', { current: $('#pw-cur').value, next: $('#pw-new').value, totp: $('#pw-totp').value }); m.className = 'ok'; m.textContent = 'Password changed. Other browser sessions were logged out.'; $('#pw-cur').value = $('#pw-new').value = $('#pw-totp').value = ''; }
    catch (err) { m.className = 'err'; m.textContent = err.message; }
  });
  $('#acc-logout-all').onclick = async () => { if (await ask({ title: 'Log out everywhere', text: 'Log out all browser sessions and end all open SSH sessions?' })) { try { await api('POST', '/api/logout-all', {}); } catch {} location.reload(); } };
  $('#acc-close').onclick = () => $('#dlg-account').close();
  $('#help-close').onclick = () => $('#dlg-help').close();

  // ---------------------------------------------------------------- SFTP
  const fmtSize = (n) => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : n < 1073741824 ? (n / 1048576).toFixed(1) + ' MB' : (n / 1073741824).toFixed(2) + ' GB';
  const fmtDate = (s) => { const d = new Date(s * 1000); const p = (x) => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
  const modeStr = (m, type) => { const t = type === 'dir' ? 'd' : type === 'link' ? 'l' : '-'; let s = t; for (let i = 8; i >= 0; i--) s += (m >> i) & 1 ? 'rwx'[(8 - i) % 3] : '-'; return s; };
  const join = (dir, name) => (dir === '/' ? '' : dir.replace(/\/$/, '')) + '/' + name;
  const sfBase = () => `/api/sftp/${encodeURIComponent(active.sid)}`;
  const sfMsg = (m, err) => { const f = $('#sf-foot'); f.textContent = m; f.classList.toggle('err', !!err); f.title = m; };
  let sfSort = { key: 'name', dir: 1 };

  async function sfLoad(path) {
    if (!active || !active.sid || active.state === 'dead') return;
    const tab = active;
    try {
      sfMsg('Loading...');
      const r = await api('GET', `${sfBase()}/list?path=${encodeURIComponent(path || tab.sf.path || '.')}`);
      tab.sf.path = r.path; tab.sf.entries = r.entries; tab.sf.sel = new Set(); tab.sf.last = null;
      if (active === tab) { $('#sf-path').value = r.path; sfRender(); sfMsg(sfCount()); }
    } catch (e) { sfMsg(e.message, true); }
  }
  const sfCount = () => `${active.sf.rows ? active.sf.rows.length : active.sf.entries.length} of ${active.sf.entries.length} entries`;
  function sfRender() {
    const tab = active; if (!tab) return;
    const dirFirst = (e) => (e.type === 'dir' || e.target === 'dir') ? 0 : 1;
    const k = sfSort.key;
    const q = $('#sf-filter').value.trim().toLowerCase();
    const rows = tab.sf.entries.filter(e => (settings.sfHidden || !e.name.startsWith('.')) && (!q || e.name.toLowerCase().includes(q))).sort((a, b) => dirFirst(a) - dirFirst(b) || (k === 'name' ? a.name.localeCompare(b.name, 'en', { numeric: true }) : k === 'size' ? a.size - b.size : a.mtime - b.mtime) * sfSort.dir || a.name.localeCompare(b.name));
    tab.sf.rows = rows; if (active === tab && tab.sf.entries.length) sfMsg(sfCount());
    $('#sf-list').innerHTML = `<table><thead><tr><th data-sort="name">Name</th><th data-sort="size" class="r">Size</th><th data-sort="mtime">Modified</th><th>Mode</th></tr></thead><tbody>${rows.map((e, i) => {
      const isDir = e.type === 'dir' || e.target === 'dir';
      return `<tr data-i="${i}" class="${isDir ? 'dir' : ''}${tab.sf.sel.has(e.name) ? ' sel' : ''}"><td class="n" title="${esc(e.name)}">${esc(e.name)}${isDir ? '/' : e.type === 'link' ? ' @' : ''}</td><td class="r">${isDir ? '' : fmtSize(e.size)}</td><td>${fmtDate(e.mtime)}</td><td class="m">${modeStr(e.mode, e.type)}</td></tr>`;
    }).join('')}</tbody></table>`;
  }
  function sfRefreshForTab() {
    if ($('#sftp').hidden) return;
    $('#sf-hidden').checked = !!settings.sfHidden;
    if (!active || !active.sid) { $('#sf-list').innerHTML = ''; sfMsg('No session'); return; }
    if (active.sf.path) { $('#sf-path').value = active.sf.path; sfRender(); sfMsg(sfCount()); } else sfLoad('.');
  }
  function toggleSftp(on) {
    const p = $('#sftp'); p.hidden = on === undefined ? !p.hidden : !on; settings.sftp = !p.hidden; saveSettings();
    $('#tb-sftp').classList.toggle('on', !p.hidden);
    if (!p.hidden) sfRefreshForTab(); refitSoon();
  }
  const sfSelected = () => active ? active.sf.rows.filter(e => active.sf.sel.has(e.name)) : [];
  $('#sf-list').addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (th) { sfSort = { key: th.dataset.sort, dir: sfSort.key === th.dataset.sort ? -sfSort.dir : 1 }; return sfRender(); }
    const tr = e.target.closest('tr[data-i]'); const tab = active; if (!tr || !tab) return;
    const ent = tab.sf.rows[+tr.dataset.i];
    if (e.shiftKey && tab.sf.last != null) { const [a, b] = [tab.sf.last, +tr.dataset.i].sort((x, y) => x - y); tab.sf.sel = new Set(tab.sf.rows.slice(a, b + 1).map(x => x.name)); }
    else if (e.ctrlKey || e.metaKey) { tab.sf.sel.has(ent.name) ? tab.sf.sel.delete(ent.name) : tab.sf.sel.add(ent.name); tab.sf.last = +tr.dataset.i; }
    else { tab.sf.sel = new Set([ent.name]); tab.sf.last = +tr.dataset.i; }
    sfRender();
  });
  $('#sf-list').addEventListener('dblclick', (e) => {
    const tr = e.target.closest('tr[data-i]'); if (!tr || !active) return; const ent = active.sf.rows[+tr.dataset.i];
    if (ent.type === 'dir' || ent.target === 'dir') sfLoad(join(active.sf.path, ent.name)); else sfDownload([ent]);
  });
  $('#sf-filter').addEventListener('input', () => { if (active) sfRender(); });
  $('#sf-hidden').onchange = (e) => { settings.sfHidden = e.target.checked; saveSettings(); if (active) sfRender(); };
  $('#sf-home').onclick = () => sfLoad('.');
  $('#sf-copypath').onclick = () => { const s = sfSelected()[0]; if (active && active.sf.path) { copyText(s ? join(active.sf.path, s.name) : active.sf.path); sfMsg('Path copied'); } };
  $('#sf-newfile').onclick = async () => {
    if (!active || !active.sf.path) return; const n = await ask({ title: 'New file', text: 'Name:', value: '' }); if (!n) return;
    try { const r = await fetch(`${sfBase()}/upload?path=${encodeURIComponent(join(active.sf.path, n))}&offset=0`, { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF': csrf, 'Content-Type': 'application/octet-stream' }, body: new Blob([]) }); if (!r.ok) throw new Error((await r.json()).error); sfLoad(); } catch (e) { sfMsg(e.message, true); }
  };
  $('#sf-go').onclick = () => sfLoad($('#sf-path').value);
  $('#sf-path').addEventListener('keydown', (e) => { if (e.key === 'Enter') sfLoad($('#sf-path').value); });
  $('#sf-up').onclick = () => { if (active && active.sf.path) sfLoad(active.sf.path.replace(/\/[^/]*\/?$/, '') || '/'); };
  function sfDownload(list) {
    if (!active) return;
    list.forEach((ent, i) => setTimeout(() => {
      const isDir = ent.type === 'dir' || ent.target === 'dir';
      const a = document.createElement('a'); a.href = `${sfBase()}/download?path=${encodeURIComponent(join(active.sf.path, ent.name))}${isDir ? '&archive=1' : ''}`;
      a.download = ''; document.body.appendChild(a); a.click(); a.remove();
    }, i * 300));
  }
  $('#sf-download').onclick = () => { const s = sfSelected(); if (s.length) sfDownload(s); else sfMsg('Nothing selected', true); };
  $('#sf-mkdir').onclick = async () => { const n = await ask({ title: 'New folder', text: 'Name:', value: '' }); if (n) try { await api('POST', `${sfBase()}/op`, { op: 'mkdir', path: join(active.sf.path, n) }); sfLoad(); } catch (e) { sfMsg(e.message, true); } };
  $('#sf-rename').onclick = async () => { const s = sfSelected()[0]; if (!s) return sfMsg('Nothing selected', true); const n = await ask({ title: 'Rename', text: s.name, value: s.name }); if (n && n !== s.name) try { await api('POST', `${sfBase()}/op`, { op: 'rename', path: join(active.sf.path, s.name), to: n.startsWith('/') ? n : join(active.sf.path, n) }); sfLoad(); } catch (e) { sfMsg(e.message, true); } };
  $('#sf-chmod').onclick = async () => { const s = sfSelected()[0]; if (!s) return sfMsg('Nothing selected', true); const m = await ask({ title: 'Change permissions', text: `${s.name} (octal, e.g. 644 or 755)`, value: (s.mode & 0o7777).toString(8) }); if (m) try { await api('POST', `${sfBase()}/op`, { op: 'chmod', path: join(active.sf.path, s.name), mode: m }); sfLoad(); } catch (e) { sfMsg(e.message, true); } };
  $('#sf-delete').onclick = async () => {
    const s = sfSelected(); if (!s.length) return sfMsg('Nothing selected', true);
    if (!await ask({ title: 'Delete', text: `Permanently delete ${s.length === 1 ? '"' + s[0].name + '"' : s.length + ' entries'}? (folders including contents)` })) return;
    try { for (const e of s) await api('POST', `${sfBase()}/op`, { op: 'delete', path: join(active.sf.path, e.name) }); } catch (e) { sfMsg(e.message, true); }
    sfLoad();
  };
  // Text editor for small remote files
  let edit = null;
  async function sfEdit() {
    const ent = sfSelected()[0]; if (!ent) return sfMsg('Nothing selected', true);
    if (ent.type === 'dir' || ent.target === 'dir') return sfMsg('That is a folder', true);
    if (ent.size > 1024 * 1024) return sfMsg('File is larger than 1 MB', true);
    const path = join(active.sf.path, ent.name), base = sfBase();
    try {
      const res = await fetch(`${base}/download?path=${encodeURIComponent(path)}`, { credentials: 'same-origin' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Error ${res.status}`);
      const buf = await res.arrayBuffer();
      if (new Uint8Array(buf).includes(0)) return sfMsg('Binary file, not opened', true);
      const text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
      edit = { path, base, dirty: false };
      $('#ed-title').textContent = path; $('#ed-text').value = text; $('#ed-msg').textContent = ''; $('#ed-msg').className = 'muted';
      openDlg($('#dlg-edit')); $('#ed-text').focus();
    } catch (e) { sfMsg(e.message, true); }
  }
  async function edSave() {
    if (!edit) return; const m = $('#ed-msg');
    try {
      const res = await fetch(`${edit.base}/upload?path=${encodeURIComponent(edit.path)}&offset=0`, { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF': csrf, 'Content-Type': 'application/octet-stream' }, body: new Blob([$('#ed-text').value]) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Save failed');
      edit.dirty = false; m.className = 'ok'; m.textContent = 'Saved ' + new Date().toLocaleTimeString('en-GB');
    } catch (e) { m.className = 'err'; m.textContent = e.message; }
  }
  $('#sf-edit').onclick = sfEdit;
  $('#ed-save').onclick = edSave;
  $('#ed-text').addEventListener('input', () => { if (edit) { edit.dirty = true; $('#ed-msg').className = 'muted'; $('#ed-msg').textContent = 'Modified'; } });
  $('#ed-text').addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); edSave(); }
    else if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.shiftKey) { e.preventDefault(); document.execCommand('insertText', false, '\t'); }
  });
  const closeEditor = async () => { if (edit && edit.dirty && !await ask({ title: 'Discard changes', text: 'The file has unsaved changes. Close without saving?' })) return; edit = null; $('#dlg-edit').close(); sfLoad(); };
  $('#ed-close').onclick = closeEditor;
  $('#dlg-edit').addEventListener('cancel', (e) => { e.preventDefault(); closeEditor(); });
  $('#sf-cd').onclick = () => { if (active && active.sf.path) { active.input(`cd '${active.sf.path.replace(/'/g, `'\\''`)}'\n`); active.term.focus(); } };

  // Upload (in 4 MB chunks so large files pass the proxy)
  const CHUNK = 4 * 1024 * 1024;
  async function sfUpload(items) {
    const tab = active; if (!tab || !tab.sid || !items.length) return;
    const total = items.reduce((a, i) => a + i.file.size, 0); let done = 0;
    show('#sf-prog'); $('#sf-bar').value = 0;
    const made = new Set();
    try {
      for (const { file, rel } of items) {
        const target = join(tab.sf.path, rel);
        const dirs = rel.split('/').slice(0, -1); let cur = tab.sf.path;
        for (const d of dirs) { cur = join(cur, d); if (!made.has(cur)) { made.add(cur); try { await api('POST', `${sfBase()}/op`, { op: 'mkdir', path: cur }); } catch {} } }
        let off = 0;
        do {
          const blob = file.slice(off, off + CHUNK);
          const res = await fetch(`${sfBase()}/upload?path=${encodeURIComponent(target)}&offset=${off}`, { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF': csrf, 'Content-Type': 'application/octet-stream' }, body: blob });
          if (!res.ok) { let m = 'Upload failed'; try { m = (await res.json()).error || m; } catch {} throw new Error(`${rel}: ${m}`); }
          off += blob.size; done += blob.size;
          $('#sf-bar').value = total ? done / total * 100 : 100; $('#sf-prog-text').textContent = `${fmtSize(done)} / ${fmtSize(total)}`;
        } while (off < file.size);
      }
      sfMsg(`${items.length} file(s) uploaded`);
    } catch (e) { sfMsg(e.message, true); }
    setTimeout(() => show('#sf-prog', false), 1200); sfLoad();
  }
  $('#sf-upload').onclick = () => $('#sf-file').click();
  $('#sf-file').onchange = (e) => { sfUpload([...e.target.files].map(file => ({ file, rel: file.name }))); e.target.value = ''; };
  async function readEntries(entry, base = '') {
    if (entry.isFile) return [await new Promise((res, rej) => entry.file(res, rej))].map(file => ({ file, rel: base + entry.name }));
    const reader = entry.createReader(); const out = []; let batch;
    do { batch = await new Promise((res, rej) => reader.readEntries(res, rej)); for (const c of batch) out.push(...await readEntries(c, base + entry.name + '/')); } while (batch.length);
    return out;
  }
  const sf = $('#sftp');
  ['dragenter', 'dragover'].forEach(n => sf.addEventListener(n, (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); sf.classList.add('drag'); } }));
  ['dragleave', 'drop'].forEach(n => sf.addEventListener(n, (e) => { if (n === 'dragleave' && sf.contains(e.relatedTarget)) return; sf.classList.remove('drag'); }));
  sf.addEventListener('drop', async (e) => {
    e.preventDefault(); const items = [...e.dataTransfer.items].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
    let list = []; if (items.length) { for (const en of items) list.push(...await readEntries(en)); } else list = [...e.dataTransfer.files].map(file => ({ file, rel: file.name }));
    sfUpload(list);
  });
  // ---------------------------------------------------------------- Snippets
  let snippets = [], snSel = null;
  async function openSnippets() {
    try { snippets = await api('GET', '/api/snippets'); } catch (e) { snippets = []; }
    snSel = null; snForm(null); snRender(); openDlg($('#dlg-snippets'));
  }
  function snRender() {
    $('#sn-list').innerHTML = snippets.length ? `<table><tbody>${snippets.map(x => `<tr data-id="${esc(x.id)}" class="${x.id === snSel ? 'sel' : ''}"><td>${esc(x.name)}</td><td class="cmd">${esc(x.cmd.split('\n')[0])}${x.cmd.includes('\n') ? ' ...' : ''}</td></tr>`).join('')}</tbody></table>` : '<div>No snippets yet.</div>';
    $('#sn-run').disabled = $('#sn-delete').disabled = !snSel;
  }
  function snForm(x) {
    $('#sn-name').value = x ? x.name : ''; $('#sn-cmd').value = x ? x.cmd : ''; $('#sn-enter').checked = x ? x.enter : true;
    $('#sn-legend').textContent = x ? 'Edit snippet' : 'New snippet';
  }
  const snPick = () => snippets.find(x => x.id === snSel);
  $('#sn-list').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (!tr) return; snSel = tr.dataset.id; snForm(snPick()); snRender(); });
  $('#sn-list').addEventListener('dblclick', () => $('#sn-run').click());
  $('#sn-clear').onclick = () => { snSel = null; snForm(null); snRender(); };
  $('#sn-save').onclick = async () => {
    const name = $('#sn-name').value.trim(), cmd = $('#sn-cmd').value; if (!name || !cmd.trim()) return;
    try { const r = await api('POST', '/api/snippets', { id: snSel || undefined, name, cmd, enter: $('#sn-enter').checked }); const i = snippets.findIndex(x => x.id === r.id); if (i >= 0) snippets[i] = r; else snippets.push(r); snSel = r.id; snRender(); } catch (e) { notice('Snippets', e.message); }
  };
  $('#sn-delete').onclick = async () => { if (!snSel) return; try { await api('DELETE', '/api/snippets/' + encodeURIComponent(snSel)); snippets = snippets.filter(x => x.id !== snSel); snSel = null; snForm(null); snRender(); } catch (e) { notice('Snippets', e.message); } };
  $('#sn-run').onclick = () => {
    const x = snPick(); if (!x || !active || active.state !== 'live') return;
    active.input(x.cmd.replace(/\r?\n/g, '\r') + (x.enter ? '\r' : '')); $('#dlg-snippets').close(); active.term.focus();
  };
  $('#sn-close').onclick = () => $('#dlg-snippets').close();

  // ---------------------------------------------------------------- Quick connect: [user@]host[:port], IPv6 as [::1]:22
  $('#quick').addEventListener('submit', (e) => {
    e.preventDefault(); const v = $('#quick-input').value.trim(); if (!v) return openConnect();
    const m = v.match(/^(?:([^@\s]+)@)?(\[[0-9a-fA-F:.]+\]|[^:\s@]+)(?::(\d{1,5}))?$/);
    if (!m) return notice('Quick connect', 'Use the form user@host or user@host:port.');
    $('#quick-input').value = '';
    openConnect({ username: m[1] || 'benj', host: m[2].replace(/^\[|\]$/g, ''), port: +m[3] || 22 });
  });

  // Refit terminal after layout changes
  let refitTimer = null; function refitSoon() { clearTimeout(refitTimer); refitTimer = setTimeout(() => { active && active.refit(); }, 30); }
  window.addEventListener('resize', refitSoon);

  // ---------------------------------------------------------------- Actions
  document.addEventListener('click', (e) => { const a = e.target.closest('[data-act]'); if (a) act(a.dataset.act); });

  async function act(name) {
    const t = active;
    switch (name) {
      case 'new': return openConnect();
      case 'dup': return t && t.info ? openConnect(t.info) : openConnect();
      case 'close-tab': return t && t.close();
      case 'reconnect': { if (!t) return openConnect(); const info = t.info; if (info && t.state === 'dead') t.close(); return openConnect(info || undefined); }
      case 'snippets': return openSnippets();
      case 'account': return openAccount();
      case 'logout': return doLogout();
      case 'copy': if (t && t.term.hasSelection()) copyText(t.term.getSelection()); return t && t.term.focus();
      case 'paste': return pasteInto(t);
      case 'selectall': return t && t.term.selectAll();
      case 'find': return toggleSearch(true);
      case 'clear': return t && (t.term.clear(), t.term.focus());
      case 'reset': return t && (t.term.reset(), t.input('\x0c'), t.term.focus());
      case 'savelog': {
        if (!t) return; const b = t.term.buffer.active; const lines = [];
        for (let i = 0; i < b.length; i++) lines.push(b.getLine(i).translateToString(true));
        while (lines.length && !lines[lines.length - 1]) lines.pop();
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([lines.join('\n') + '\n'], { type: 'text/plain' })); a.download = `${t.label.replace(/[^\w@.-]/g, '_')}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.log`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); return;
      }
      case 'sftp': return toggleSftp();
      case 'keys': { const k = $('#keybar'); k.hidden = !k.hidden; if (k.hidden) $('#fkeys').hidden = true; settings.keys = !k.hidden; $('#tb-keys').classList.toggle('on', !k.hidden); saveSettings(); refitSoon(); return; }
      case 'fullscreen': if (document.fullscreenElement) document.exitFullscreen(); else await document.documentElement.requestFullscreen().catch(() => {}); return;
      case 'zoom-in': return zoom(1);
      case 'zoom-out': return zoom(-1);
      case 'zoom-reset': return zoom(0);
      case 'settings': return openSettings();
      case 'help': return openDlg($('#dlg-help'));
    }
  }
  $('#btn-fs').onclick = () => act('fullscreen');
  $('#btn-logout').onclick = doLogout;
  // In fullscreen (Chrome/Edge) the Keyboard Lock API hands over *every* key, including Ctrl+W/T/N/Tab, Esc (hold to leave), F11 and Alt+Tab-free combos.
  document.addEventListener('fullscreenchange', () => {
    try { if (document.fullscreenElement) navigator.keyboard && navigator.keyboard.lock && navigator.keyboard.lock(); else navigator.keyboard && navigator.keyboard.unlock && navigator.keyboard.unlock(); } catch {}
    $('#st-lock').title = document.fullscreenElement ? 'All keys are sent to the server (fullscreen)' : 'Enter fullscreen to also send Ctrl+W/T/N/Tab to the server';
    refitSoon();
  });
  // Ctrl+W (reserved by the browser outside fullscreen) must not drop the page by accident.
  window.addEventListener('beforeunload', (e) => { if (tabs.some(t => t.state === 'live')) { e.preventDefault(); e.returnValue = ''; } });
  // After any dialog closes, keyboard focus goes back to the terminal.
  $$('dialog').forEach(d => d.addEventListener('close', () => { if (active && !$$('dialog').some(x => x.open)) setTimeout(() => active && active.term.focus(), 0); }));
  // Clicking anywhere on the terminal area keeps keyboard focus in the terminal.
  $('#termwrap').addEventListener('mousedown', () => { if (active && !window.getSelection().toString()) setTimeout(() => active && active.term.focus(), 0); });
  // Network back / tab visible again: reconnect immediately
  const kick = () => tabs.forEach(t => { if (t.state === 'wait' && t.sid) { clearTimeout(t.retryTimer); t.retry = 0; t.reattach(); } });
  window.addEventListener('online', kick);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { kick(); active && active.term.focus(); } });

  // ---------------------------------------------------------------- Start
  async function startApp() {
    show('#login-screen', false); show('#app');
    show('#sftp', settings.sftp); show('#keybar', settings.keys); buildFkeys();
    $('#tb-sftp').classList.toggle('on', !!settings.sftp); $('#tb-keys').classList.toggle('on', !!settings.keys);
    try {
      const live = await api('GET', '/api/sessions');
      for (const s of live) { const tab = new Tab(`${s.username}@${s.host}`); tab.sid = s.id; tab.info = { host: s.host, port: s.port, username: s.username }; activate(tab); tab.initTerm(); tab.openWS(s.id); }
    } catch {}
    if (!tabs.length) { activate(null); openConnect(); }
    updateStatus();
  }

  boot();
})();
