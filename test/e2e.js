'use strict';
// End-to-end test against a running server. Usage: node test/e2e.js <baseUrl> <setupCodeFile> <sshPort> <privateKeyFile>
const fs = require('fs');
const WebSocket = require('ws');
const sec = require('../lib/security');
const [base, codeFile, sshPort, keyFile] = process.argv.slice(2);
const email = 'benjaminburger3456@gmail.com', password = 'correct horse battery staple 42';
const CC = process.env.COUNTRY_HEADER || 'X-Country', IPH = process.env.IP_HEADER || 'X-Real-IP';
let cookie = '', csrf = '', ip = '198.51.100.1';
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m); };

async function call(method, url, body, headers = {}, raw) {
  const res = await fetch(base + url, { method, headers: { Origin: base, [IPH]: ip, ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { 'X-CSRF': csrf } : {}), ...(body && !raw ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: raw ? body : body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  let data = null; const ct = res.headers.get('content-type') || '';
  if (ct.includes('json')) data = await res.json(); else data = Buffer.from(await res.arrayBuffer());
  return { status: res.status, data, res };
}
const step = (d = 0) => Math.floor(Date.now() / 30000) + d;

(async () => {
  let r = await call('GET', '/api/state'); ok(r.data.setup === true, 'state: setup mode');
  r = await call('POST', '/api/setup/start', { email, code: 'WRONG', password }); ok(r.status === 401, 'setup with wrong code rejected');
  r = await call('POST', '/api/setup/start', { email: 'x@y.at', code: fs.readFileSync(codeFile, 'utf8').trim(), password }); ok(r.status === 401, 'setup with wrong email rejected');
  r = await call('POST', '/api/setup/start', { email, code: fs.readFileSync(codeFile, 'utf8').trim(), password: 'short' }); ok(r.status === 400, 'short password rejected');
  r = await call('POST', '/api/setup/start', { email, code: fs.readFileSync(codeFile, 'utf8').trim(), password });
  ok(r.status === 200 && r.data.secret && r.data.qr.startsWith('data:image/png'), 'setup start returns secret + QR');
  const { token, secret } = r.data;
  r = await call('POST', '/api/setup/finish', { token, totp: '000000' }); ok(r.status === 401, 'setup finish with wrong TOTP rejected');
  r = await call('POST', '/api/setup/finish', { token, totp: sec.hotp(secret, step()) }); ok(r.status === 200 && cookie.includes('wcsid='), 'setup finish logs in');
  csrf = r.data.csrf;
  ok(!fs.existsSync(codeFile), 'setup code file removed after setup');
  r = await call('POST', '/api/logout', {}); ok(r.status === 200, 'logout'); cookie = ''; csrf = '';

  ip = '198.51.100.2';
  r = await call('GET', '/api/state', undefined, { [CC]: 'AT' }); ok(r.data.setup === false && r.data.needTotp === false, 'AT: no 2FA needed');
  r = await call('GET', '/api/state', undefined, { [CC]: 'DE' }); ok(r.data.needTotp === true, 'DE: 2FA needed');
  r = await call('GET', '/api/state'); ok(r.data.needTotp === true, 'missing country header: 2FA needed (fail-safe)');
  r = await call('POST', '/api/login', { email, password: 'wrong wrong wrong', totp: '' }, { [CC]: 'AT' }); ok(r.status === 401, 'AT wrong password rejected');
  r = await call('POST', '/api/login', { email, password, totp: '' }, { [CC]: 'DE' }); ok(r.status === 401, 'DE without TOTP rejected');
  r = await call('POST', '/api/login', { email, password, totp: sec.hotp(secret, step(1)) }, { [CC]: 'DE' }); ok(r.status === 200, 'DE with TOTP accepted');
  csrf = r.data.csrf;
  r = await call('POST', '/api/login', { email, password, totp: sec.hotp(secret, step(1)) }, { [CC]: 'DE' }); ok(r.status === 401, 'TOTP replay rejected');
  r = await call('POST', '/api/logout', {}); cookie = ''; csrf = '';
  r = await call('POST', '/api/login', { email: email.toUpperCase(), password }, { [CC]: 'AT' }); ok(r.status === 200, 'AT login with password only (email case-insensitive)');
  csrf = r.data.csrf;

  ip = '198.51.100.3';
  // CSRF / origin
  r = await call('POST', '/api/profiles', { host: 'h', username: 'u' }, { 'X-CSRF': 'bad' }); ok(r.status === 403, 'bad CSRF token rejected');
  r = await call('POST', '/api/profiles', { host: 'h', username: 'u' }, { Origin: 'https://evil.example' }); ok(r.status === 403, 'foreign Origin rejected');
  r = await call('GET', '/api/profiles'); ok(r.status === 200 && Array.isArray(r.data), 'profiles list');
  const saved = await call('POST', '/api/profiles', { name: 't', host: 'h', username: 'u' }); ok(saved.status === 200, 'profile saved');
  await call('DELETE', '/api/profiles/' + saved.data.id);

  // security headers
  r = await call('GET', '/'); ok(/frame-ancestors 'none'/.test(r.res.headers.get('content-security-policy')) && r.res.headers.get('x-content-type-options') === 'nosniff', 'security headers on /');
  for (const f of ['/app.js', '/style.css', '/vendor/xterm.js', '/vendor/addon-fit.js', '/vendor/addon-webgl.js', '/vendor/xterm.css']) { r = await call('GET', f); ok(r.status === 200, 'static ' + f); }
  r = await call('GET', '/lib/ssh.js'); ok(r.status === 404 || (r.data && r.data.toString().includes('<!DOCTYPE')) , 'server source not served');
  r = await call('GET', '/../server.js'); ok(r.status !== 200 || !String(r.data).includes('WebSocketServer'), 'no path traversal');

  // WebSocket without cookie
  const wsUrl = base.replace('http', 'ws') + '/ws';
  await new Promise((res) => { const w = new WebSocket(wsUrl, { headers: { Origin: base } }); w.on('error', () => { ok(true, 'ws without cookie rejected'); res(); }); w.on('open', () => { ok(false, 'ws without cookie rejected'); w.close(); res(); }); });
  await new Promise((res) => { const w = new WebSocket(wsUrl, { headers: { Origin: 'https://evil.example', Cookie: cookie } }); w.on('error', () => { ok(true, 'ws with foreign origin rejected'); res(); }); w.on('open', () => { ok(false, 'ws with foreign origin rejected'); w.close(); res(); }); });

  // SSH
  const key = fs.readFileSync(keyFile, 'utf8');
  const open = (sid) => new Promise((res) => { const w = new WebSocket(wsUrl + (sid ? '?sid=' + sid : ''), { headers: { Origin: base, [IPH]: ip, Cookie: cookie } }); w.out = ''; w.msgs = []; w.on('message', (d, bin) => { if (bin) w.out += d.toString(); else w.msgs.push(JSON.parse(d.toString())); }); w.on('open', () => res(w)); });
  const waitFor = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = fn(); if (v) return v; await new Promise(r => setTimeout(r, 1)); } return null; };

  let w = await open();
  w.send(JSON.stringify({ t: 'connect', host: '127.0.0.1', port: +sshPort, username: require('os').userInfo().username, privateKey: key, cols: 100, rows: 30 }));
  const hk = await waitFor(() => w.msgs.find(m => m.t === 'hostkey')); ok(hk && hk.fp.startsWith('SHA256:') && hk.alg === 'ssh-ed25519' && !hk.changed, 'unknown host key prompt');
  w.send(JSON.stringify({ t: 'hostkey-answer', accept: true, remember: true }));
  const rd = await waitFor(() => w.msgs.find(m => m.t === 'ready')); ok(!!rd, 'ssh session ready');
  const sid = rd.sid;
  await new Promise(r => setTimeout(r, 400));
  const t0 = Date.now(); w.send(Buffer.from('echo MARK$((20+22))\n'));
  ok(await waitFor(() => w.out.includes('MARK42\r\n')), 'shell echo roundtrip (' + (Date.now() - t0) + ' ms)');
  { const L = []; for (let i = 0; i < 20; i++) { const n = w.msgs.length; const t = process.hrtime.bigint(); w.send(JSON.stringify({ t: 'ping', ts: 100 + i })); await waitFor(() => w.msgs.length > n, 3000); L.push(Number(process.hrtime.bigint() - t) / 1e6); await new Promise(r => setTimeout(r, 30)); } L.sort((a, b) => a - b); console.log(`INFO ws ping/pong latency: median ${L[10].toFixed(1)} ms`); }
  { // keystroke echo latency (warm shell)
    await new Promise(r => setTimeout(r, 1500)); const lat = [];
    for (let i = 0; i < 30; i++) { const before = w.out.length; const t = process.hrtime.bigint(); w.send(Buffer.from('q')); await waitFor(() => w.out.length > before, 3000); lat.push(Number(process.hrtime.bigint() - t) / 1e6); await new Promise(r => setTimeout(r, 30)); }
    lat.sort((a, b) => a - b); console.log(`INFO keystroke echo latency: median ${lat[15].toFixed(1)} ms, p95 ${lat[28].toFixed(1)} ms, max ${lat[29].toFixed(1)} ms`);
    w.send(Buffer.from('\x15'));
  }
  w.send(JSON.stringify({ t: 'resize', cols: 133, rows: 41 })); w.send(Buffer.from('stty size\n'));
  ok(await waitFor(() => w.out.includes('41 133')), 'resize applied (stty size = 41 133)');
  w.send(JSON.stringify({ t: 'ping', ts: 5 })); ok(await waitFor(() => w.msgs.find(m => m.t === 'pong' && m.ts === 5)), 'ping/pong');
  w.send(Buffer.from('printf "\\033[31mred\\033[0m \\xc3\\xa4\\xe2\\x82\\xac\\n"\n')); ok(await waitFor(() => w.out.includes('\x1b[31mred\x1b[0m ä€')), 'colors + UTF-8 pass through');

  // SFTP
  const base_ = `/api/sftp/${sid}`; const dir = '/tmp/claude-1000/wc-e2e-' + Date.now();
  r = await call('POST', base_ + '/op', { op: 'mkdir', path: dir }); ok(r.status === 200, 'sftp mkdir');
  const big = Buffer.alloc(5 * 1024 * 1024 + 123); for (let i = 0; i < big.length; i++) big[i] = (i * 31) & 255;
  r = await call('POST', base_ + `/upload?path=${encodeURIComponent(dir + '/big.bin')}&offset=0`, big.subarray(0, 4 * 1048576), { 'Content-Type': 'application/octet-stream' }, true); ok(r.status === 200, 'sftp upload chunk 1');
  r = await call('POST', base_ + `/upload?path=${encodeURIComponent(dir + '/big.bin')}&offset=${4 * 1048576}`, big.subarray(4 * 1048576), { 'Content-Type': 'application/octet-stream' }, true); ok(r.status === 200, 'sftp upload chunk 2');
  r = await call('GET', base_ + `/list?path=${encodeURIComponent(dir)}`); ok(r.data.entries.length === 1 && r.data.entries[0].size === big.length, 'sftp list shows size');
  r = await call('GET', base_ + `/download?path=${encodeURIComponent(dir + '/big.bin')}`); ok(r.status === 200 && Buffer.compare(r.data, big) === 0, 'sftp download identical (5 MB)');
  r = await call('POST', base_ + '/op', { op: 'rename', path: dir + '/big.bin', to: dir + '/renamed.bin' }); ok(r.status === 200, 'sftp rename');
  r = await call('POST', base_ + '/op', { op: 'chmod', path: dir + '/renamed.bin', mode: '600' }); ok(r.status === 200, 'sftp chmod');
  r = await call('GET', base_ + `/list?path=${encodeURIComponent(dir)}`); ok(r.data.entries[0].name === 'renamed.bin' && r.data.entries[0].mode === 0o600, 'rename+chmod visible');
  r = await call('GET', base_ + `/download?path=${encodeURIComponent(dir)}&archive=1`); ok(r.status === 200 && r.data[0] === 0x1f && r.data[1] === 0x8b, 'directory download as tar.gz');
  r = await call('GET', base_ + `/download?path=${encodeURIComponent(dir + '/nope')}`); ok(r.status === 400, 'download of missing file -> error');
  r = await call('POST', base_ + '/op', { op: 'delete', path: dir }); ok(r.status === 200, 'sftp recursive delete');
  r = await call('GET', base_ + `/list?path=${encodeURIComponent(dir)}`); ok(r.status === 400, 'deleted dir gone');

  // Reconnect / replay
  w.close(); await new Promise(r => setTimeout(r, 300));
  r = await call('GET', '/api/sessions'); ok(r.data.length === 1 && r.data[0].attached === false, 'session survives browser disconnect');
  const w2 = await open(sid); const rd2 = await waitFor(() => w2.msgs.find(m => m.t === 'ready' && m.replay)); ok(!!rd2, 'reattach to session');
  ok(await waitFor(() => w2.out.includes('MARK42')), 'scrollback replayed after reattach');
  w2.send(Buffer.from('echo STILL$((1+1))\n')); ok(await waitFor(() => w2.out.includes('STILL2')), 'input works after reattach');

  // Known host: second connection needs no prompt
  const w3 = await open(); w3.send(JSON.stringify({ t: 'connect', host: '127.0.0.1', port: +sshPort, username: require('os').userInfo().username, privateKey: key, cols: 80, rows: 24 }));
  const r3 = await waitFor(() => w3.msgs.find(m => m.t === 'ready' || m.t === 'hostkey')); ok(r3 && r3.t === 'ready', 'known host: no prompt second time');
  // Wrong credentials -> friendly error, ws stays usable
  const w4 = await open(); w4.send(JSON.stringify({ t: 'connect', host: '127.0.0.1', port: +sshPort, username: 'nosuchuser', password: 'x' }));
  const e4 = await waitFor(() => w4.msgs.find(m => m.t === 'error')); ok(e4 && /failed/.test(e4.message), 'bad credentials -> error: ' + (e4 && e4.message));
  const w5 = await open(); w5.send(JSON.stringify({ t: 'connect', host: '127.0.0.1', port: 1, username: 'a', password: 'x' }));
  const e5 = await waitFor(() => w5.msgs.find(m => m.t === 'error')); ok(e5 && /refused/.test(e5.message), 'refused port -> error: ' + (e5 && e5.message));
  const w6 = await open(); w6.send(JSON.stringify({ t: 'connect', host: 'bad host', username: 'a' }));
  const e6 = await waitFor(() => w6.msgs.find(m => m.t === 'error')); ok(!!e6, 'invalid host rejected');

  // End session from shell
  w2.send(Buffer.from('exit\n')); ok(await waitFor(() => w2.msgs.find(m => m.t === 'exit')), 'exit from shell ends session');
  r = await call('GET', '/api/sessions'); ok(r.data.length === 1, 'only the other session remains');
  [w3, w4, w5, w6].forEach(x => x.close());

  // brute-force limiter
  cookie = ''; csrf = '';
  let blocked = false; for (let i = 0; i < 8; i++) { r = await call('POST', '/api/login', { email, password: 'nope-nope-nope' }, { [CC]: 'AT', [IPH]: '203.0.113.9' }); if (r.status === 429) blocked = true; }
  ok(blocked, 'repeated failures -> 429 lockout');

  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
