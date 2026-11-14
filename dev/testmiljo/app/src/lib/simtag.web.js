// Webbförhandsvisning: simulerad NTAG 424 DNA i webbläsaren (samma modell som
// __tests__/sim-ntag424.js, men på aes.js i stället för Node crypto). Bara för bilderna.
import { aesEncryptBlock, cbcEncrypt, cbcDecrypt, cmac, macTrunc, jamCrc32, concat, toHex, fromHex, equalBytes, xorBytes } from "./aes";

const rnd = (n) => { const b = new Uint8Array(n); crypto.getRandomValues(b); return b; };
const le16 = (n) => [n & 0xff, (n >> 8) & 0xff];
const le24 = (n) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff];
const rd24 = (b, o) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
const rotl = (b) => concat(b.slice(1), b.slice(0, 1));
const SW = (a, b) => Uint8Array.from([a, b]);
const Z16 = new Uint8Array(16);

export class SimTagWeb {
  constructor() {
    this.uid = concat([0x04], rnd(6));
    this.keys = [0, 1, 2, 3, 4].map(() => new Uint8Array(16));
    this.ver = [0, 0, 0, 0, 0];
    this.file = new Uint8Array(256);
    this.file.set(fromHex("0010d1010c550474617070617373 2e7365".replace(/ /g, "")));
    this.opt = 0; this.ar = [0xe0, 0xee]; this.sdm = null; this.ctr = 0;
    this.reset();
  }
  reset() { this.app = false; this.ef = null; this.sess = null; this.pending = null; }
  access() { const v = this.ar[0] | (this.ar[1] << 8); return { read: (v >> 12) & 15, write: (v >> 8) & 15, change: v & 15 }; }
  mirrored() {
    const out = this.file.slice();
    if (!(this.opt & 0x40) || !this.sdm) return out;
    this.ctr += 1;
    const v = this.sdm.ar[0] | (this.sdm.ar[1] << 8);
    const meta = (v >> 12) & 15, fr = (v >> 8) & 15, c3 = le24(this.ctr);
    const e = aesEncryptBlock(this.keys[meta], concat([0xc7], this.uid, c3, rnd(5)));
    out.set(Uint8Array.from(toHex(e).toUpperCase(), (ch) => ch.charCodeAt(0)), this.sdm.picc);
    const kses = cmac(this.keys[fr], concat([0x3c, 0xc3, 0x00, 0x01, 0x00, 0x80], this.uid, c3));
    out.set(Uint8Array.from(toHex(macTrunc(cmac(kses, new Uint8Array(0)))).toUpperCase(), (ch) => ch.charCodeAt(0)), this.sdm.mac);
    return out;
  }
  iv(label) { return aesEncryptBlock(this.sess.enc, concat(label, this.sess.ti, le16(this.sess.ctr), new Uint8Array(8))); }
  open(cmd, p) {
    const h = p.slice(0, 1), enc = p.slice(1, p.length - 8), mact = p.slice(p.length - 8);
    if (!equalBytes(macTrunc(cmac(this.sess.mac, concat([cmd], le16(this.sess.ctr), this.sess.ti, h, enc))), mact)) return null;
    const plain = cbcDecrypt(this.sess.enc, this.iv([0xa5, 0x5a]), enc);
    let i = plain.length - 1;
    while (i >= 0 && plain[i] === 0) i--;
    return { h, d: plain.slice(0, i) };
  }
  macResp() { this.sess.ctr += 1; return concat(macTrunc(cmac(this.sess.mac, concat([0x00], le16(this.sess.ctr), this.sess.ti))), [0x91, 0x00]); }
  err(c) { this.sess = null; this.pending = null; return SW(0x91, c); }
  process(a) {
    if (a[0] === 0x00) {
      if (a[1] === 0xa4) {
        const d = toHex(a.slice(5, 5 + a[4]));
        if (a[2] === 0x04) { if (d !== "d2760000850101") return SW(0x6a, 0x82); this.app = true; this.ef = null; this.sess = null; return SW(0x90, 0); }
        if (this.app && (d === "e104" || d === "e103")) { this.ef = d; return SW(0x90, 0); }
        return SW(0x6a, 0x82);
      }
      if (a[1] === 0xb0) { const off = (a[2] << 8) | a[3], le = a[4] || 256; return concat(this.mirrored().slice(off, off + le), [0x90, 0x00]); }
      if (a[1] === 0xd6) { if (this.access().write !== 0xe) return SW(0x69, 0x82); this.file.set(a.slice(5, 5 + a[4]), (a[2] << 8) | a[3]); return SW(0x90, 0); }
      return SW(0x6d, 0);
    }
    const cmd = a[1], d = a.length > 5 ? a.slice(5, 5 + a[4]) : new Uint8Array(0);
    if (this.pending && cmd !== 0xaf) this.pending = null;
    if (cmd === 0x64) return this.sess ? this.err(0x1c) : Uint8Array.from([this.ver[d[0]], 0x91, 0x00]);
    if (cmd === 0x71) { this.sess = null; const rb = rnd(16); this.pending = { k: d[0], rb }; return concat(cbcEncrypt(this.keys[d[0]], Z16, rb), [0x91, 0xaf]); }
    if (cmd === 0xaf) {
      const p = this.pending; this.pending = null;
      if (!p) return this.err(0xca);
      const key = this.keys[p.k], plain = cbcDecrypt(key, Z16, d), ra = plain.slice(0, 16);
      if (!equalBytes(plain.slice(16), rotl(p.rb))) return this.err(0xae);
      const ti = rnd(4), ctx = concat(ra.slice(0, 2), xorBytes(ra.slice(2, 8), p.rb.slice(0, 6)), p.rb.slice(6), ra.slice(8));
      this.sess = { k: p.k, ti, ctr: 0, enc: cmac(key, concat([0xa5, 0x5a, 0, 1, 0, 0x80], ctx)), mac: cmac(key, concat([0x5a, 0xa5, 0, 1, 0, 0x80], ctx)) };
      return concat(cbcEncrypt(key, Z16, concat(ti, rotl(ra), new Uint8Array(12))), [0x91, 0x00]);
    }
    if (cmd === 0x5f) {
      if (!this.sess) return this.err(0xae);
      const m = this.open(cmd, d); if (!m) return this.err(0x1e);
      const x = m.d; this.opt = x[0]; this.ar = [x[1], x[2]];
      this.sdm = this.opt & 0x40 ? { ar: [x[4], x[5]], picc: rd24(x, 6), mac: rd24(x, 12) } : null;
      return this.macResp();
    }
    if (cmd === 0xc4) {
      if (!this.sess) return this.err(0xae);
      const m = this.open(cmd, d); if (!m) return this.err(0x1e);
      const no = m.h[0], x = m.d;
      if (no === this.sess.k) { this.keys[no] = x.slice(0, 16); this.ver[no] = x[16]; this.sess = null; return SW(0x91, 0x00); }
      const nk = xorBytes(x.slice(0, 16), this.keys[no]);
      if (!equalBytes(jamCrc32(nk), x.slice(17, 21))) return this.err(0x1e);
      this.keys[no] = nk; this.ver[no] = x[16];
      return this.macResp();
    }
    if (cmd === 0x8d) { this.file.set(d.slice(7), rd24(d, 1)); if (this.sess) this.sess.ctr += 1; return SW(0x91, 0x00); }
    return this.err(0x1c);
  }
}
