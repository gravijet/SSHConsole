'use strict';
const http = require('http');
const path = require('path');
const fs = require('fs');
const express = require('express');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');

const { Store } = require('./lib/store');
const sec = require('./lib/security');
const { SshManager } = require('./lib/ssh');
const sftpRouter = require('./lib/sftp');

const PORT = Number(process.env.PORT || 3099);
const HOST = process.env.HOST || '127.0.0.1';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const ALLOWED_EMAIL = String(process.env.ALLOWED_EMAIL || '').trim().toLowerCase();
const PUBLIC_ORIGIN = String(process.env.PUBLIC_ORIGIN || `http://127.0.0.1:${PORT}`).replace(/\/$/, '');
const SECURE = PUBLIC_ORIGIN.startsWith('https://');
const COOKIE = (SECURE ? '__Host-' : '') + 'wcsid';
const SESSION_IDLE = 12 * 3600 * 1000, SESSION_MAX = 7 * 24 * 3600 * 1000;
const ISSUER = 'Benjamin Console';

if (!ALLOWED_EMAIL) { console.error('ALLOWED_EMAIL is required'); process.exit(1); }

const store = new Store(DATA_DIR);
const manager = new SshManager(store);
const SETUP_FILE = path.join(DATA_DIR, 'setup-code.txt');

let setupCode = null;
function ensureSetupCode() {
  if (store.data.user) { try { fs.unlinkSync(SETUP_FILE); } catch {} setupCode = null; return; }
  setupCode = sec.newSetupCode();
  fs.writeFileSync(SETUP_FILE, setupCode + '\n', { mode: 0o600 });
}
ensureSetupCode();

// ---------- web sessions ----------
const webSessions = new Map();
function newWebSession(req) {
  const token = sec.randomToken(32);
  const s = { csrf: sec.randomToken(24), created: Date.now(), last: Date.now(), ip: clientIp(req), ua: String(req.headers['user-agent'] || '').slice(0, 160) };
  webSessions.set(token, s);
  return { token, s };
}
function parseCookies(h) {
  const out = {};
  for (const part of String(h || '').split(';')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim(); }
  return out;
}
function getWebSession(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return null;
  const s = webSessions.get(token);
  if (!s) return null;
  const now = Date.now();
  if (now - s.last > SESSION_IDLE || now - s.created > SESSION_MAX) { webSessions.delete(token); return null; }
  s.last = now;
  return { token, s };
}
function setCookie(res, token) {
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MAX / 1000}${SECURE ? '; Secure' : ''}`);
}
function clearCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${SECURE ? '; Secure' : ''}`);
}
function clientIp(req) {
  const remote = req.socket.remoteAddress || '';
  const loop = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  return (loop && (req.headers['x-real-ip'] || '').toString().trim()) || remote;
}
// Country as reported by Cloudflare (nginx forwards CF-IPCountry as X-Country; only trusted from loopback).
const HOME_COUNTRY = (process.env.HOME_COUNTRY || 'AT').toUpperCase();
function clientCountry(req) {
  const remote = req.socket.remoteAddress || '';
  const loop = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  return String((loop && req.headers['x-country']) || '').trim().toUpperCase();
}
// Fail safe: anything that is not positively Austria (missing header, XX, T1 = Tor, ...) needs the second factor.
const needTotp = (req) => clientCountry(req) !== HOME_COUNTRY;

setInterval(() => {
  const now = Date.now();
  for (const [t, s] of webSessions) if (now - s.last > SESSION_IDLE || now - s.created > SESSION_MAX) webSessions.delete(t);
  loginLimiter.sweep(); pendingSetup.forEach((v, k) => { if (now - v.created > 10 * 60 * 1000) pendingSetup.delete(k); });
}, 60000).unref();

// ---------- limits ----------
const loginLimiter = new sec.FailureLimiter({ max: 5, windowMs: 15 * 60 * 1000, blockMs: 15 * 60 * 1000 });
const globalLimiter = new sec.FailureLimiter({ max: 60, windowMs: 60 * 60 * 1000, blockMs: 10 * 60 * 1000 });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const pendingSetup = new Map();

// ---------- app ----------
const app = express();
app.disable('x-powered-by');
app.set('etag', false);

app.use((req, res, next) => {
  const wsOrigin = PUBLIC_ORIGIN.replace(/^http/, 'ws');
  res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ${wsOrigin}; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), clipboard-read=(self), clipboard-write=(self)');
  if (SECURE) res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});

const json = express.json({ limit: '64kb' });

function originOk(req) {
  const o = req.headers.origin;
  return !!o && o === PUBLIC_ORIGIN;
}
function requireAuth(req, res, next) {
  const ws = getWebSession(req);
  if (!ws) return res.status(401).json({ error: 'Not logged in' });
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (!originOk(req) || !sec.safeEqual(req.headers['x-csrf'] || '', ws.s.csrf)) return res.status(403).json({ error: 'CSRF check failed' });
  }
  req.web = ws; next();
}
function requireOrigin(req, res, next) { if (!originOk(req)) return res.status(403).json({ error: 'Invalid origin' }); next(); }

const emailMatches = (e) => String(e || '').trim().toLowerCase() === ALLOWED_EMAIL;
const passwordPolicy = (pw) => typeof pw === 'string' && pw.length >= 12 && pw.length <= 256;

async function guard(req, res, key) {
  const ip = clientIp(req);
  const wait = Math.max(loginLimiter.blockedFor(ip), globalLimiter.blockedFor('*'));
  if (wait > 0) { res.status(429).json({ error: `Too many failed attempts. Try again in ${Math.ceil(wait / 60000)} min.` }); return false; }
  // global slow-down proportional to recent failures
  const g = globalLimiter.count('*');
  if (g > 5) await sleep(Math.min(g * 100, 3000));
  return true;
}
function failed(req, what) {
  const ip = clientIp(req);
  loginLimiter.fail(ip); globalLimiter.fail('*');
  store.audit('auth-fail', ip, what);
}

// ----- state -----
app.get('/api/state', (req, res) => {
  const ws = getWebSession(req);
  res.json({ setup: !store.data.user, loggedIn: !!ws, csrf: ws ? ws.s.csrf : undefined, email: ws ? ALLOWED_EMAIL : undefined, needTotp: needTotp(req), country: clientCountry(req) || '??' });
});

// ----- first-time setup: email + one-time setup code + new password -> TOTP enrolment -----
app.post('/api/setup/start', requireOrigin, json, async (req, res) => {
  if (store.data.user) return res.status(409).json({ error: 'Already set up' });
  if (!(await guard(req, res))) return;
  const { email, code, password } = req.body || {};
  const ok = emailMatches(email) && setupCode && sec.safeEqual(String(code || '').trim().toUpperCase(), setupCode);
  if (!ok) { failed(req, 'setup'); return res.status(401).json({ error: 'Wrong email or setup code' }); }
  if (!passwordPolicy(password)) return res.status(400).json({ error: 'Password must be at least 12 characters long' });
  const secret = sec.newTotpSecret();
  const uri = `otpauth://totp/${encodeURIComponent(ISSUER)}:${encodeURIComponent(ALLOWED_EMAIL)}?secret=${secret}&issuer=${encodeURIComponent(ISSUER)}&period=30&digits=6`;
  const token = sec.randomToken(24);
  pendingSetup.set(token, { pw: await sec.hashPassword(password), secret, created: Date.now(), tries: 0 });
  const qr = await QRCode.toDataURL(uri, { margin: 2, width: 220, errorCorrectionLevel: 'M' });
  res.json({ token, secret, uri, qr });
});

app.post('/api/setup/finish', requireOrigin, json, async (req, res) => {
  if (store.data.user) return res.status(409).json({ error: 'Already set up' });
  if (!(await guard(req, res))) return;
  const p = pendingSetup.get(String((req.body || {}).token));
  if (!p) return res.status(400).json({ error: 'Setup expired, please start again' });
  const step = sec.totpCheck(p.secret, (req.body || {}).totp);
  if (step < 0) {
    if (++p.tries >= 5) pendingSetup.delete(String(req.body.token));
    failed(req, 'setup-totp'); return res.status(401).json({ error: 'Wrong code' });
  }
  pendingSetup.delete(String(req.body.token));
  store.data.user = { email: ALLOWED_EMAIL, pw: p.pw, totp: { secret: p.secret, lastStep: step }, createdAt: Date.now() };
  store.flush(); ensureSetupCode();
  store.audit('setup-done', clientIp(req));
  const { token, s } = newWebSession(req); setCookie(res, token);
  res.json({ ok: true, csrf: s.csrf });
});

// ----- login -----
let dummyHash = null;
sec.hashPassword('dummy-password-for-timing').then(h => { dummyHash = h; });

app.post('/api/login', requireOrigin, json, async (req, res) => {
  if (!store.data.user) return res.status(409).json({ error: 'Not set up yet' });
  if (!(await guard(req, res))) return;
  const { email, password, totp } = req.body || {};
  const u = store.data.user;
  const emailOk = emailMatches(email);
  const pwOk = await sec.verifyPassword(String(password || ''), emailOk ? u.pw : dummyHash);
  const wantTotp = needTotp(req);
  const step = sec.totpCheck(u.totp.secret, totp, u.totp.lastStep);
  if (!(emailOk && pwOk && (!wantTotp || step >= 0))) {
    failed(req, 'login' + (wantTotp ? ' (2FA required, country ' + (clientCountry(req) || '??') + ')' : ''));
    return res.status(401).json({ error: 'Login failed' });
  }
  if (step >= 0) u.totp.lastStep = step;
  store.save();
  loginLimiter.reset(clientIp(req));
  const { token, s } = newWebSession(req); setCookie(res, token);
  store.audit('login', clientIp(req), `${clientCountry(req) || '??'}${wantTotp ? ' +2FA' : ''} ${s.ua}`);
  res.json({ ok: true, csrf: s.csrf });
});

app.post('/api/logout', requireAuth, (req, res) => {
  webSessions.delete(req.web.token); clearCookie(res); res.json({ ok: true });
});

app.post('/api/logout-all', requireAuth, (req, res) => {
  webSessions.clear(); manager.closeAll('Abmeldung aller Sitzungen'); clearCookie(res);
  store.audit('logout-all', clientIp(req)); res.json({ ok: true });
});

app.post('/api/password', requireAuth, json, async (req, res) => {
  if (!(await guard(req, res))) return;
  const { current, next, totp } = req.body || {};
  const u = store.data.user;
  const wantTotp = needTotp(req);
  const step = sec.totpCheck(u.totp.secret, totp, u.totp.lastStep);
  if (!(await sec.verifyPassword(String(current || ''), u.pw)) || (wantTotp && step < 0)) { failed(req, 'password-change'); return res.status(401).json({ error: 'Current password or code wrong' }); }
  if (!passwordPolicy(next)) return res.status(400).json({ error: 'New password must be at least 12 characters long' });
  u.pw = await sec.hashPassword(next); if (step >= 0) u.totp.lastStep = step; store.save();
  for (const t of [...webSessions.keys()]) if (t !== req.web.token) webSessions.delete(t);
  store.audit('password-change', clientIp(req)); res.json({ ok: true });
});

// ----- profiles / known hosts / audit -----
app.get('/api/profiles', requireAuth, (req, res) => res.json(store.data.profiles));
app.post('/api/profiles', requireAuth, json, (req, res) => {
  const b = req.body || {};
  const prof = {
    id: String(b.id || sec.randomToken(8)).slice(0, 32),
    name: String(b.name || '').slice(0, 80) || `${b.username}@${b.host}`,
    host: String(b.host || '').slice(0, 255), port: Number(b.port) || 22, username: String(b.username || '').slice(0, 128),
    legacy: !!b.legacy, startup: String(b.startup || '').slice(0, 500),
  };
  if (!prof.host || !prof.username) return res.status(400).json({ error: 'Host and user required' });
  const i = store.data.profiles.findIndex(x => x.id === prof.id);
  if (i >= 0) store.data.profiles[i] = prof; else { if (store.data.profiles.length >= 200) return res.status(400).json({ error: 'Too many profiles' }); store.data.profiles.push(prof); }
  store.save(); res.json(prof);
});
app.delete('/api/profiles/:id', requireAuth, (req, res) => {
  store.data.profiles = store.data.profiles.filter(x => x.id !== req.params.id); store.save(); res.json({ ok: true });
});
app.get('/api/snippets', requireAuth, (req, res) => res.json(store.data.snippets || []));
app.post('/api/snippets', requireAuth, json, (req, res) => {
  const b = req.body || {};
  const sn = { id: String(b.id || sec.randomToken(8)).slice(0, 32), name: String(b.name || '').trim().slice(0, 60), cmd: String(b.cmd || '').slice(0, 4000), enter: b.enter !== false };
  if (!sn.name || !sn.cmd.trim()) return res.status(400).json({ error: 'Name and command required' });
  const list = store.data.snippets = store.data.snippets || [];
  const i = list.findIndex(x => x.id === sn.id);
  if (i >= 0) list[i] = sn; else { if (list.length >= 100) return res.status(400).json({ error: 'Too many snippets' }); list.push(sn); }
  store.save(); res.json(sn);
});
app.delete('/api/snippets/:id', requireAuth, (req, res) => {
  store.data.snippets = (store.data.snippets || []).filter(x => x.id !== req.params.id); store.save(); res.json({ ok: true });
});
app.get('/api/knownhosts', requireAuth, (req, res) => res.json(store.data.knownHosts));
app.delete('/api/knownhosts', requireAuth, json, (req, res) => {
  delete store.data.knownHosts[String((req.body || {}).host)]; store.save(); res.json({ ok: true });
});
app.get('/api/audit', requireAuth, (req, res) => res.json(store.data.audit.slice(-100).reverse()));
app.get('/api/sessions', requireAuth, (req, res) => res.json(manager.list()));
app.delete('/api/sessions/:id', requireAuth, (req, res) => { const s = manager.get(req.params.id); if (s) s.close('Ended from the account dialog'); res.json({ ok: true }); });

app.use('/api/sftp', requireAuth, sftpRouter(manager));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// ----- static -----
const vendor = (rel) => path.join(__dirname, 'node_modules', rel);
const VENDOR = {
  '/vendor/xterm.js': vendor('@xterm/xterm/lib/xterm.js'),
  '/vendor/xterm.css': vendor('@xterm/xterm/css/xterm.css'),
  '/vendor/addon-fit.js': vendor('@xterm/addon-fit/lib/addon-fit.js'),
  '/vendor/addon-webgl.js': vendor('@xterm/addon-webgl/lib/addon-webgl.js'),
  '/vendor/addon-web-links.js': vendor('@xterm/addon-web-links/lib/addon-web-links.js'),
  '/vendor/addon-search.js': vendor('@xterm/addon-search/lib/addon-search.js'),
  '/vendor/addon-unicode11.js': vendor('@xterm/addon-unicode11/lib/addon-unicode11.js'),
  '/vendor/addon-clipboard.js': vendor('@xterm/addon-clipboard/lib/addon-clipboard.js'),
  '/vendor/addon-image.js': vendor('@xterm/addon-image/lib/addon-image.js'),
};
for (const [url, file] of Object.entries(VENDOR)) {
  app.get(url, (req, res) => { res.setHeader('Cache-Control', 'public, max-age=86400'); res.sendFile(file); });
}
app.use(express.static(path.join(__dirname, 'public'), { etag: true, maxAge: 0, index: 'index.html', dotfiles: 'ignore' }));

app.use((err, req, res, next) => {
  if (res.headersSent) return res.destroy();
  res.status(err.status || 500).json({ error: err.status && err.status < 500 ? err.message : 'Internal error' });
});

// ---------- http + websocket ----------
const server = http.createServer(app);
server.keepAliveTimeout = 65000;
server.on('connection', (sock) => sock.setNoDelay(true));

const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 4 * 1024 * 1024 });
server.on('upgrade', (req, socket, head) => {
  const reject = (code) => { socket.write(`HTTP/1.1 ${code}\r\nConnection: close\r\n\r\n`); socket.destroy(); };
  const url = new URL(req.url, 'http://x');
  if (url.pathname !== '/ws') return reject('404 Not Found');
  if (req.headers.origin !== PUBLIC_ORIGIN) return reject('403 Forbidden');
  if (!getWebSession(req)) return reject('401 Unauthorized');
  wss.handleUpgrade(req, socket, head, (ws) => manager.handleSocket(ws, { ip: clientIp(req), sid: url.searchParams.get('sid') || null }));
});
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false; try { ws.ping(); } catch {}
  }
}, 20000).unref();

server.listen(PORT, HOST, () => console.log(`Benjamin Console listening on ${HOST}:${PORT} (${PUBLIC_ORIGIN}) setup=${!store.data.user}`));

function shutdown() { try { store.flush(); } catch {} process.exit(0); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
