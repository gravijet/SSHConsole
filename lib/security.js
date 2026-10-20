'use strict';
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

const N = 1 << 15, R = 8, P = 1, KEYLEN = 64;
const SCRYPT_OPTS = { N, r: R, p: P, maxmem: 128 * N * R * 2 };

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password.normalize('NFKC'), salt, KEYLEN, SCRYPT_OPTS);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64');
  const got = await scrypt(password.normalize('NFKC'), Buffer.from(salt, 'base64'), expected.length, {
    N: +n, r: +r, p: +p, maxmem: 128 * +n * +r * 2,
  });
  return crypto.timingSafeEqual(got, expected);
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(str) {
  let bits = 0, value = 0; const out = [];
  for (const c of str.replace(/=+$/, '').toUpperCase()) {
    const i = B32.indexOf(c); if (i < 0) continue;
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

function hotp(secret, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  const code = (h.readUInt32BE(o) & 0x7fffffff) % 1000000;
  return String(code).padStart(6, '0');
}

/** Returns the matching time step (for replay protection) or -1. */
function totpCheck(secret, token, lastStep = -1) {
  if (!/^\d{6}$/.test(String(token || '').replace(/\s/g, ''))) return -1;
  token = String(token).replace(/\s/g, '');
  const now = Math.floor(Date.now() / 30000);
  let found = -1;
  for (const d of [-1, 0, 1]) {
    const step = now + d;
    if (safeEqual(hotp(secret, step), token) && step > lastStep) found = Math.max(found, step);
  }
  return found;
}

function newTotpSecret() { return base32Encode(crypto.randomBytes(20)); }

function randomToken(bytes = 32) { return crypto.randomBytes(bytes).toString('base64url'); }

function newSetupCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(20);
  let s = '';
  for (let i = 0; i < 20; i++) { s += alphabet[bytes[i] % alphabet.length]; if (i % 4 === 3 && i < 19) s += '-'; }
  return s;
}

/** Sliding-window failure counter keyed by string. */
class FailureLimiter {
  constructor({ max, windowMs, blockMs }) { this.max = max; this.windowMs = windowMs; this.blockMs = blockMs; this.map = new Map(); }
  _entry(key) {
    const now = Date.now();
    let e = this.map.get(key);
    if (!e) { e = { fails: [], blockedUntil: 0 }; this.map.set(key, e); }
    e.fails = e.fails.filter(t => now - t < this.windowMs);
    return e;
  }
  blockedFor(key) { const e = this._entry(key); return Math.max(0, e.blockedUntil - Date.now()); }
  fail(key) {
    const e = this._entry(key); e.fails.push(Date.now());
    if (e.fails.length >= this.max) { e.blockedUntil = Date.now() + this.blockMs; e.fails = []; }
  }
  reset(key) { this.map.delete(key); }
  count(key) { return this._entry(key).fails.length; }
  sweep() { const now = Date.now(); for (const [k, e] of this.map) if (e.blockedUntil < now && e.fails.every(t => now - t > this.windowMs)) this.map.delete(k); }
}

module.exports = { hotp, base32Decode, hashPassword, verifyPassword, safeEqual, newTotpSecret, totpCheck, randomToken, newSetupCode, FailureLimiter, base32Encode };
