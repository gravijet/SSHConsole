'use strict';
const express = require('express');

const S_IFMT = 0o170000, S_IFDIR = 0o040000, S_IFLNK = 0o120000, S_IFREG = 0o100000;
const MAX_UPLOAD_CHUNK = 9 * 1024 * 1024;

const p = (fn) => new Promise((resolve, reject) => fn((err, r) => err ? reject(err) : resolve(r)));
const kind = (mode) => ((mode & S_IFMT) === S_IFDIR ? 'dir' : (mode & S_IFMT) === S_IFLNK ? 'link' : (mode & S_IFMT) === S_IFREG ? 'file' : 'other');
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

function errMsg(e) {
  if (e && e.code === 2) return 'Nicht gefunden';
  if (e && e.code === 3) return 'Zugriff verweigert';
  return (e && e.message) || 'Fehler';
}

async function rmrf(sftp, path) {
  const st = await p(cb => sftp.lstat(path, cb));
  if (kind(st.mode) !== 'dir') return p(cb => sftp.unlink(path, cb));
  const list = await p(cb => sftp.readdir(path, cb));
  for (const e of list) if (e.filename !== '.' && e.filename !== '..') await rmrf(sftp, path.replace(/\/$/, '') + '/' + e.filename);
  return p(cb => sftp.rmdir(path, cb));
}

module.exports = function sftpRouter(manager) {
  const r = express.Router({ mergeParams: true });

  r.use('/:sid', (req, res, next) => {
    const s = manager.get(req.params.sid);
    if (!s) return res.status(404).json({ error: 'Session not found' });
    req.sess = s; next();
  });

  const wrap = (fn) => async (req, res) => {
    try { await fn(req, res, await req.sess.sftp()); }
    catch (e) { if (!res.headersSent) res.status(400).json({ error: errMsg(e) }); else res.destroy(); }
  };

  r.get('/:sid/list', wrap(async (req, res, sftp) => {
    let path = String(req.query.path || '.');
    path = await p(cb => sftp.realpath(path, cb));
    const list = await p(cb => sftp.readdir(path, cb));
    const entries = await Promise.all(list.filter(e => e.filename !== '.' && e.filename !== '..').map(async (e) => {
      const a = e.attrs; let type = kind(a.mode), target = null;
      if (type === 'link') {
        try { const st = await p(cb => sftp.stat(path.replace(/\/$/, '') + '/' + e.filename, cb)); target = kind(st.mode); } catch { target = 'broken'; }
      }
      return { name: e.filename, type, target, size: a.size, mtime: a.mtime, mode: a.mode & 0o7777, uid: a.uid, gid: a.gid };
    }));
    res.json({ path, entries });
  }));

  r.get('/:sid/download', async (req, res) => {
    try {
      const path = String(req.query.path || '');
      if (!path) throw new Error('Path missing');
      const name = path.split('/').filter(Boolean).pop() || 'download';
      const disp = (n) => `attachment; filename="${n.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(n)}`;
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Type', 'application/octet-stream');
      if (req.query.archive) {
        const parent = path.replace(/\/[^/]*\/?$/, '') || '/';
        const stream = await req.sess.exec(`tar -czf - -C ${shq(parent)} -- ${shq(name)}`);
        res.setHeader('Content-Disposition', disp(name + '.tar.gz'));
        stream.pipe(res); res.on('close', () => stream.close());
        return;
      }
      const sftp = await req.sess.sftp();
      const st = await p(cb => sftp.stat(path, cb));
      if (kind(st.mode) === 'dir') throw new Error('This is a folder (download it as an archive)');
      res.setHeader('Content-Length', st.size);
      res.setHeader('Content-Disposition', disp(name));
      const rs = sftp.createReadStream(path, { highWaterMark: 256 * 1024 });
      rs.on('error', () => res.destroy());
      rs.pipe(res); res.on('close', () => rs.destroy());
    } catch (e) { if (!res.headersSent) res.status(400).json({ error: errMsg(e) }); else res.destroy(); }
  });

  r.post('/:sid/upload', express.raw({ type: () => true, limit: MAX_UPLOAD_CHUNK }), wrap(async (req, res, sftp) => {
    const path = String(req.query.path || ''); const offset = Number(req.query.offset) || 0;
    if (!path || path.endsWith('/')) throw new Error('Path missing');
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const handle = await p(cb => sftp.open(path, offset === 0 ? 'w' : 'r+', 0o644, cb));
    try {
      let written = 0;
      while (written < body.length) {
        const len = Math.min(body.length - written, 256 * 1024);
        await p(cb => sftp.write(handle, body, written, len, offset + written, cb));
        written += len;
      }
      if (offset === 0 && body.length === 0) { /* empty file created */ }
    } finally { await p(cb => sftp.close(handle, cb)).catch(() => {}); }
    res.json({ ok: true, written: body.length });
  }));

  r.post('/:sid/op', express.json({ limit: '64kb' }), wrap(async (req, res, sftp) => {
    const { op, path, to, mode } = req.body || {};
    if (typeof path !== 'string' || !path) throw new Error('Path missing');
    switch (op) {
      case 'mkdir': await p(cb => sftp.mkdir(path, cb)); break;
      case 'rename': if (typeof to !== 'string' || !to) throw new Error('Target missing'); await p(cb => sftp.rename(path, to, cb)); break;
      case 'delete': await rmrf(sftp, path); break;
      case 'chmod': { const m = parseInt(String(mode), 8); if (!(m >= 0 && m <= 0o7777)) throw new Error('Invalid mode'); await p(cb => sftp.chmod(path, m, cb)); break; }
      case 'symlink': if (typeof to !== 'string' || !to) throw new Error('Target missing'); await p(cb => sftp.symlink(to, path, cb)); break;
      default: throw new Error('Unknown action');
    }
    res.json({ ok: true });
  }));

  return r;
};
