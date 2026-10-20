'use strict';
const crypto = require('crypto');
const { Client } = require('ssh2');

const RING_MAX = 1024 * 1024;           // scrollback replayed after a reconnect
const DETACH_TTL = 30 * 60 * 1000;      // keep a session alive this long without a browser attached
const MAX_SESSIONS = 20;
const HIGH_WATER = 4 * 1024 * 1024;
const LOW_WATER = 512 * 1024;

const LEGACY = {
  kex: { append: ['diffie-hellman-group-exchange-sha1', 'diffie-hellman-group14-sha1', 'diffie-hellman-group1-sha1'] },
  cipher: { append: ['aes128-cbc', 'aes192-cbc', 'aes256-cbc', '3des-cbc'] },
  serverHostKey: { append: ['ssh-dss'] },
  hmac: { append: ['hmac-sha1'] },
};

function hostKeyInfo(blob) {
  const len = blob.readUInt32BE(0);
  return {
    alg: blob.subarray(4, 4 + len).toString('latin1'),
    fp: 'SHA256:' + crypto.createHash('sha256').update(blob).digest('base64').replace(/=+$/, ''),
  };
}

function friendlyError(err) {
  if (err.level === 'client-authentication') return 'Authentication failed (password/key rejected).';
  if (err.level === 'client-timeout' || err.code === 'ETIMEDOUT') return 'Connection timed out.';
  switch (err.code) {
    case 'ECONNREFUSED': return 'Connection refused (is an SSH server running on that port?).';
    case 'ENOTFOUND': case 'EAI_AGAIN': return 'Hostname could not be resolved.';
    case 'EHOSTUNREACH': case 'ENETUNREACH': return 'Host nicht erreichbar.';
    case 'ECONNRESET': return 'Connection was reset.';
  }
  if (/passphrase/i.test(err.message)) return 'Key is encrypted: passphrase missing or wrong.';
  if (/Cannot parse privateKey|Unsupported key format/i.test(err.message)) return 'Private key could not be read.';
  if (/handshake|no matching/i.test(err.message)) return 'Handshake failed: ' + err.message + ' (maybe enable "Allow legacy algorithms").';
  return err.message || 'Unbekannter Fehler';
}

class Session {
  constructor(id, info) {
    Object.assign(this, info);
    this.id = id;
    this.created = Date.now();
    this.ring = []; this.ringSize = 0;
    this.ws = null;
    this.client = null; this.stream = null;
    this._sftp = null;
    this.detachTimer = null;
    this.pending = []; this.flushScheduled = false;
    this.paused = false; this.flowPaused = false; this.drainTimer = null;
    this.closed = false;
  }

  attach(ws) {
    if (this.ws && this.ws !== ws) { try { this.ws.close(4000, 'replaced'); } catch {} }
    clearTimeout(this.detachTimer);
    this.ws = ws;
    this.send({ t: 'ready', sid: this.id, host: this.host, port: this.port, username: this.username, replay: true, cols: this.cols, rows: this.rows });
    if (this.ringSize) ws.send(Buffer.concat(this.ring), { binary: true, compress: false });
    if (this.stream && this.paused) this._maybeResume();
  }
  detach(ws) {
    if (this.ws !== ws) return;
    this.ws = null;
    this.pending = [];
    this.flowPaused = false;
    if (this.paused) { this.paused = false; clearInterval(this.drainTimer); this.stream.resume(); }
    clearTimeout(this.detachTimer);
    if (!this.closed) this.detachTimer = setTimeout(() => this.close('Inaktiv getrennt'), DETACH_TTL);
  }

  send(obj) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj)); }

  _onData(chunk) {
    this.ring.push(chunk); this.ringSize += chunk.length;
    while (this.ringSize > RING_MAX && this.ring.length > 1) this.ringSize -= this.ring.shift().length;
    this.lastActive = Date.now();
    if (!this.ws) return;
    this.pending.push(chunk);
    if (!this.flushScheduled) { this.flushScheduled = true; setImmediate(() => this._flush()); }
  }
  _flush() {
    this.flushScheduled = false;
    if (!this.ws || !this.pending.length) { this.pending = []; return; }
    const buf = this.pending.length === 1 ? this.pending[0] : Buffer.concat(this.pending);
    this.pending = [];
    this.ws.send(buf, { binary: true, compress: false });
    if (this.ws.bufferedAmount > HIGH_WATER && !this.paused && this.stream) {
      this.paused = true; this.stream.pause();
      this.drainTimer = setInterval(() => this._maybeResume(), 20);
    }
  }
  /** Browser-side flow control: the client asks us to stop while xterm.js catches up. */
  setFlow(pause) {
    this.flowPaused = !!pause;
    if (pause && this.stream && !this.paused && !this.closed) {
      this.paused = true; this.stream.pause();
      this.drainTimer = setInterval(() => this._maybeResume(), 20);
    } else if (!pause) this._maybeResume();
  }
  _maybeResume() {
    if (!this.paused || this.flowPaused) return;
    if (!this.ws || this.ws.bufferedAmount < LOW_WATER) {
      this.paused = false; clearInterval(this.drainTimer); this.stream && this.stream.resume();
    }
  }

  write(buf) { if (this.stream && !this.closed) { this.lastActive = Date.now(); this.stream.write(buf); } }
  resize(cols, rows) {
    cols = Math.max(1, Math.min(1000, cols | 0)); rows = Math.max(1, Math.min(500, rows | 0));
    this.cols = cols; this.rows = rows;
    if (this.stream) this.stream.setWindow(rows, cols, 0, 0);
  }

  sftp() {
    if (!this._sftp) {
      this._sftp = new Promise((resolve, reject) => {
        this.client.sftp((err, s) => {
          if (err) { this._sftp = null; return reject(err); }
          s.on('close', () => { this._sftp = null; });
          resolve(s);
        });
      });
    }
    return this._sftp;
  }

  exec(cmd) {
    return new Promise((resolve, reject) => this.client.exec(cmd, (err, stream) => err ? reject(err) : resolve(stream)));
  }

  close(reason = '', code = null) {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.detachTimer); clearInterval(this.drainTimer);
    this.send({ t: 'exit', reason, code });
    try { this.client.end(); } catch {}
    setTimeout(() => { try { this.client.destroy(); } catch {} }, 1000).unref();
    this.manager.sessions.delete(this.id);
    if (this.ws) { try { this.ws.close(1000, 'session ended'); } catch {} }
    this.manager.store.audit('ssh-close', this.ip, `${this.username}@${this.host}:${this.port} ${reason}`);
  }
}

class SshManager {
  constructor(store) { this.store = store; this.sessions = new Map(); this.connectLimiter = []; }

  list() {
    return [...this.sessions.values()].map(s => ({
      id: s.id, host: s.host, port: s.port, username: s.username, created: s.created,
      lastActive: s.lastActive, attached: !!s.ws,
    }));
  }
  get(id) { return this.sessions.get(id); }

  closeAll(reason) { for (const s of [...this.sessions.values()]) s.close(reason); }

  /**
   * Handle one WebSocket from the browser. Protocol:
   *   text frames  = JSON control messages, binary frames = terminal data.
   */
  handleSocket(ws, { ip, sid }) {
    ws.binaryType = 'nodebuffer';
    ws._socket.setNoDelay(true);
    let session = null;
    let connecting = null;      // { abort(), answers: {hostkey, kbd} }

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    if (sid) {
      session = this.sessions.get(sid);
      if (!session) { ws.send(JSON.stringify({ t: 'gone' })); ws.close(4004, 'gone'); return; }
      session.attach(ws);
    }

    ws.on('message', (data, isBinary) => {
      if (isBinary) { if (session) session.write(data); return; }
      let m; try { m = JSON.parse(data.toString()); } catch { return; }
      switch (m.t) {
        case 'ping': ws.send(JSON.stringify({ t: 'pong', ts: m.ts })); break;
        case 'resize': if (session) session.resize(m.cols, m.rows); break;
        case 'flow': if (session) session.setFlow(m.pause); break;
        case 'close': if (session) session.close('Vom Benutzer beendet'); break;
        case 'hostkey-answer': connecting && connecting.answer('hostkey', m); break;
        case 'kbd-answer': connecting && connecting.answer('kbd', m); break;
        case 'abort': connecting && connecting.abort(); break;
        case 'connect':
          if (session || connecting) return;
          connecting = this._connect(ws, ip, m, (s) => { session = s; connecting = null; s.attach(ws); }, () => { connecting = null; });
          break;
      }
    });

    ws.on('close', () => {
      if (connecting) connecting.abort();
      if (session) session.detach(ws);
    });
    ws.on('error', () => {});
  }

  _connect(ws, ip, m, onReady, onFail) {
    const send = (o) => ws.readyState === 1 && ws.send(JSON.stringify(o));
    const fail = (message) => { send({ t: 'error', message }); onFail(); };

    const now = Date.now();
    this.connectLimiter = this.connectLimiter.filter(t => now - t < 60000);
    if (this.connectLimiter.length >= 30) { fail('Too many connection attempts, please wait a moment.'); return null; }
    this.connectLimiter.push(now);
    if (this.sessions.size >= MAX_SESSIONS) { fail('Maximum number of sessions reached.'); return null; }

    const host = String(m.host || '').trim();
    const port = Number(m.port) || 22;
    const username = String(m.username || '').trim();
    if (!host || host.length > 255 || /[\s/\\]/.test(host)) { fail('Invalid host.'); return null; }
    if (!username || username.length > 128) { fail('Username missing.'); return null; }
    if (!(port > 0 && port < 65536)) { fail('Invalid port.'); return null; }
    const cols = Math.max(1, Math.min(1000, m.cols | 0 || 80)), rows = Math.max(1, Math.min(500, m.rows | 0 || 24));

    const client = new Client();
    const waiters = {};
    let aborted = false, done = false;

    const handle = {
      abort: () => { if (done) return; aborted = true; done = true; try { client.destroy(); } catch {} Object.values(waiters).forEach(w => w(null)); onFail(); },
      answer: (kind, msg) => { const w = waiters[kind]; if (w) { delete waiters[kind]; w(msg); } },
    };
    const ask = (kind, payload, timeoutMs = 120000) => new Promise((resolve) => {
      const timer = setTimeout(() => { delete waiters[kind]; resolve(null); }, timeoutMs);
      waiters[kind] = (msg) => { clearTimeout(timer); resolve(msg); };
      send(payload);
    });

    const target = `${host}:${port}`;
    const cfg = {
      host, port, username,
      readyTimeout: 25000, keepaliveInterval: 15000, keepaliveCountMax: 4,
      tryKeyboard: true,
      hostVerifier: (blob, verify) => {
        const info = hostKeyInfo(blob);
        const known = this.store.data.knownHosts[target];
        if (known && known.fp === info.fp) return verify(true);
        (async () => {
          const ans = await ask('hostkey', { t: 'hostkey', host, port, ...info, changed: !!known, oldFp: known && known.fp });
          if (!ans || !ans.accept) return verify(false);
          if (ans.remember) {
            this.store.data.knownHosts[target] = { ...info, added: Date.now() };
            this.store.save();
            this.store.audit('hostkey', ip, `${target} ${info.fp}${known ? ' (changed)' : ''}`);
          }
          verify(true);
        })();
      },
    };
    if (m.privateKey) { cfg.privateKey = String(m.privateKey); if (m.passphrase) cfg.passphrase = String(m.passphrase); }
    if (m.password) cfg.password = String(m.password);
    if (m.legacy) cfg.algorithms = LEGACY;

    send({ t: 'status', msg: `Connecting to ${target}...` });

    client.on('keyboard-interactive', async (name, instructions, lang, prompts, finish) => {
      // If the only prompt looks like a password prompt and we have one, answer it silently.
      if (cfg.password && prompts.length === 1 && /password|passwort/i.test(prompts[0].prompt) && !handle._pwTried) {
        handle._pwTried = true; return finish([cfg.password]);
      }
      const ans = await ask('kbd', { t: 'kbd', name, instructions, prompts });
      finish(ans && Array.isArray(ans.responses) ? ans.responses.map(String) : []);
    });

    client.on('error', (err) => {
      if (done) return;
      done = true;
      this.store.audit('ssh-fail', ip, `${username}@${target}: ${err.level || err.code || err.message}`);
      fail(friendlyError(err));
    });

    client.on('ready', () => {
      if (aborted) return client.end();
      client.shell({ term: 'xterm-256color', cols, rows }, { env: { COLORTERM: 'truecolor', LANG: 'en_US.UTF-8' } }, (err, stream) => {
        if (err) { done = true; fail('Could not open shell: ' + err.message); return client.end(); }
        done = true;
        const id = crypto.randomBytes(12).toString('hex');
        const s = new Session(id, { host, port, username, ip, cols, rows, lastActive: Date.now() });
        s.manager = this; s.client = client; s.stream = stream;
        this.sessions.set(id, s);
        this.store.audit('ssh-open', ip, `${username}@${target}`);
        stream.on('data', (c) => s._onData(c));
        stream.stderr.on('data', (c) => s._onData(c));
        stream.on('close', (code) => s.close('Shell beendet', code));
        client.on('close', () => s.close('Verbindung getrennt'));
        client.on('error', () => {});
        onReady(s);
      });
    });

    client.on('close', () => { if (!done) { done = true; fail('Connection closed.'); } });
    try { client.connect(cfg); client.setNoDelay(true); } catch (e) { done = true; fail(friendlyError(e)); return null; }   // ssh2 leaves Nagle on: +40 ms per keystroke
    return handle;
  }
}

module.exports = { SshManager };
