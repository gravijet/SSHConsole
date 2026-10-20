'use strict';
const fs = require('fs');
const path = require('path');

class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'data.json');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.data = { user: null, knownHosts: {}, profiles: [], snippets: [], audit: [] };
    try { Object.assign(this.data, JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    this._timer = null;
  }
  save() {
    // Debounced atomic write, mode 0600.
    if (this._timer) return;
    this._timer = setTimeout(() => { this._timer = null; this.flush(); }, 50);
  }
  flush() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
  audit(type, ip, detail = '') {
    this.data.audit.push({ ts: Date.now(), type, ip, detail: String(detail).slice(0, 200) });
    if (this.data.audit.length > 500) this.data.audit.splice(0, this.data.audit.length - 500);
    this.save();
  }
}
module.exports = { Store };
