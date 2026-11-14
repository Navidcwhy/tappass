// Simulerad NTAG 424 DNA för testerna av taggverktyget (src/lib/ntag424.js).
// Oberoende av appens kod: AES/CMAC via Node crypto, CRC via zlib. Modellerar det
// verktyget använder — ISO SELECT/READ/UPDATE BINARY, GetKeyVersion, AuthenticateEV2First,
// säker kanal (MAC/Full) med kommandoräknare, ChangeFileSettings, ChangeKey, WriteData,
// GetFileSettings och SDM-spegling (krypterad PICC-data + CMAC) vid läsning — enligt
// NT4H2421Gx-databladet och AN12196. Byteordningen för AccessRights/SDMAccessRights:
// 16-bitarsvärdet (Read|Write|RW|Change resp. MetaRead|FileRead|RFU|CtrRet) skickas
// minst signifikanta byte först.
const crypto = require("crypto");
const zlib = require("zlib");

const aesEcb = (key, block, decrypt = false) => {
  const c = (decrypt ? crypto.createDecipheriv : crypto.createCipheriv)("aes-128-ecb", key, null);
  c.setAutoPadding(false);
  return Buffer.concat([c.update(block), c.final()]);
};
const cbc = (key, iv, data, decrypt = false) => {
  const c = (decrypt ? crypto.createDecipheriv : crypto.createCipheriv)("aes-128-cbc", key, iv);
  c.setAutoPadding(false);
  return Buffer.concat([c.update(data), c.final()]);
};
const xor = (a, b) => Buffer.from(a.map((v, i) => v ^ b[i]));
const dbl = (b) => { const o = Buffer.alloc(16); for (let i = 0; i < 16; i++) o[i] = ((b[i] << 1) | (i < 15 ? b[i + 1] >> 7 : 0)) & 0xff; if (b[0] & 0x80) o[15] ^= 0x87; return o; };
function cmac(key, msg) {
  const k1 = dbl(aesEcb(key, Buffer.alloc(16))), k2 = dbl(k1);
  const n = Math.max(1, Math.ceil(msg.length / 16));
  let last;
  if (msg.length && msg.length % 16 === 0) last = xor(msg.subarray((n - 1) * 16), k1);
  else { const p = Buffer.alloc(16); msg.copy(p, 0, (n - 1) * 16); p[msg.length - (n - 1) * 16] = 0x80; last = xor(p, k2); }
  let x = Buffer.alloc(16);
  for (let i = 0; i < n - 1; i++) x = aesEcb(key, xor(x, msg.subarray(i * 16, i * 16 + 16)));
  return aesEcb(key, xor(x, last));
}
const trunc = (m) => Buffer.from([1, 3, 5, 7, 9, 11, 13, 15].map((i) => m[i]));
const jamcrc = (b) => { const v = (~zlib.crc32(b)) >>> 0; return Buffer.from([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]); };
const le16 = (n) => Buffer.from([n & 0xff, (n >> 8) & 0xff]);
const le24 = (n) => Buffer.from([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff]);
const rd24 = (b, o) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
const rotl = (b) => Buffer.concat([b.subarray(1), b.subarray(0, 1)]);
const SW = (a, b) => Buffer.from([a, b]);
const OK9000 = SW(0x90, 0x00);
const AID = Buffer.from("d2760000850101", "hex");

class TagLost extends Error { constructor() { super("transceive fail"); } }

class SimTag {
  constructor({ uid = crypto.randomBytes(7), ndef = null } = {}) {
    this.uid = Buffer.from(uid);
    this.keys = [0, 1, 2, 3, 4].map(() => Buffer.alloc(16));
    this.keyVer = [0, 0, 0, 0, 0];
    this.file = Buffer.alloc(256);
    if (ndef) Buffer.from(ndef).copy(this.file);
    else Buffer.from("0010d1010c550474617070617373 2e7365".replace(/ /g, ""), "hex").copy(this.file);   // tappass.se (fabrik/annan app)
    this.fileOption = 0x00;
    this.ar = [0xe0, 0xee];        // fabrik: RW E, Change 0 | Read E, Write E
    this.sdm = null;               // { options, ar: [b1, b2], picc, macIn, mac }
    this.readCtr = 0;
    this.log = [];                 // varje APDU (hex) som taggen tog emot
    this.reset();
  }
  // Fältet bryts (taggen tas bort): flyktigt läge nollställs
  reset() { this.appSelected = false; this.ef = null; this.sess = null; this.pending = null; }

  get access() {
    const v = this.ar[0] | (this.ar[1] << 8);
    return { read: (v >> 12) & 15, write: (v >> 8) & 15, rw: (v >> 4) & 15, change: v & 15 };
  }
  sdmKeys() {
    const v = this.sdm.ar[0] | (this.sdm.ar[1] << 8);
    return { metaRead: (v >> 12) & 15, fileRead: (v >> 8) & 15, ctrRet: v & 15 };
  }

  // Filen som den läses, med SDM-spegling (räknaren ökar en gång per läsning)
  mirrored() {
    const out = Buffer.from(this.file);
    if (!(this.fileOption & 0x40) || !this.sdm) return out;
    this.readCtr += 1;
    const { metaRead, fileRead } = this.sdmKeys();
    const ascii = this.sdm.options & 0x01;
    const ctr = le24(this.readCtr);
    if (metaRead <= 4) {
      const tag = 0x80 * !!(this.sdm.options & 0x80) | 0x40 * !!(this.sdm.options & 0x40) | 0x07;
      const enc = aesEcb(this.keys[metaRead], Buffer.concat([Buffer.from([tag]), this.uid, ctr, crypto.randomBytes(5)]));
      Buffer.from(ascii ? enc.toString("hex").toUpperCase() : enc.toString("binary"), ascii ? "ascii" : "binary").copy(out, this.sdm.picc);
    }
    if (fileRead <= 4) {
      const kses = cmac(this.keys[fileRead], Buffer.concat([Buffer.from("3cc300010080", "hex"), this.uid, ctr]));
      const mac = trunc(cmac(kses, out.subarray(this.sdm.macIn, this.sdm.mac)));
      Buffer.from(mac.toString("hex").toUpperCase(), "ascii").copy(out, this.sdm.mac);
    }
    return out;
  }

  fileSettingsBytes() {
    const parts = [Buffer.from([0x00, this.fileOption, this.ar[0], this.ar[1]]), le24(256)];
    if (this.fileOption & 0x40) {
      const s = this.sdm;
      parts.push(Buffer.from([s.options, s.ar[0], s.ar[1]]));
      const { metaRead, fileRead } = this.sdmKeys();
      if (metaRead <= 4) parts.push(le24(s.picc));
      if (fileRead <= 4) parts.push(le24(s.macIn), le24(s.mac));
    }
    return Buffer.concat(parts);
  }

  // ---- säker kanal ----
  iv(label) { return aesEcb(this.sess.enc, Buffer.concat([Buffer.from(label), this.sess.ti, le16(this.sess.ctr), Buffer.alloc(8)])); }
  // Kontrollera MAC och dekryptera ett Full-kommando → { header, data } eller null
  openFull(cmd, payload, headerLen) {
    if (payload.length < headerLen + 8) return null;
    const header = payload.subarray(0, headerLen), enc = payload.subarray(headerLen, payload.length - 8), mact = payload.subarray(payload.length - 8);
    const want = trunc(cmac(this.sess.mac, Buffer.concat([Buffer.from([cmd]), le16(this.sess.ctr), this.sess.ti, header, enc])));
    if (!want.equals(mact)) return { macError: true };
    if (!enc.length) return { header, data: Buffer.alloc(0) };
    if (enc.length % 16) return { lengthError: true };
    const plain = cbc(this.sess.enc, this.iv([0xa5, 0x5a]), enc, true);
    let i = plain.length - 1;
    while (i >= 0 && plain[i] === 0) i--;
    if (i < 0 || plain[i] !== 0x80) return { lengthError: true };
    return { header, data: plain.subarray(0, i) };
  }
  // Svar i MAC-läge efter uppräkning av räknaren
  macResponse(data = Buffer.alloc(0)) {
    this.sess.ctr += 1;
    const mact = trunc(cmac(this.sess.mac, Buffer.concat([Buffer.from([0x00]), le16(this.sess.ctr), this.sess.ti, data])));
    return Buffer.concat([data, mact, SW(0x91, 0x00)]);
  }
  err(code) { this.sess = null; this.pending = null; return SW(0x91, code); }

  // ---- APDU ----
  process(apdu) {
    const a = Buffer.from(apdu);
    this.log.push(a.toString("hex"));
    if (a[0] === 0x00) return this.iso(a);
    if (a[0] !== 0x90 || a[2] !== 0 || a[3] !== 0) return SW(0x6e, 0x00);
    const lc = a.length > 5 ? a[4] : 0;
    if (a.length > 5 && a.length !== 6 + lc) return this.err(0x7e);
    const data = a.subarray(5, 5 + lc);
    const cmd = a[1];
    if (!this.appSelected) return SW(0x91, 0x9d);
    if (this.pending && cmd !== 0xaf) this.pending = null;
    switch (cmd) {
      case 0x64: return this.getKeyVersion(data);
      case 0x71: return this.auth1(data);
      case 0xaf: return this.auth2(data);
      case 0x5f: return this.changeFileSettings(data);
      case 0xc4: return this.changeKey(data);
      case 0x8d: return this.writeData(data);
      case 0xf5: return this.getFileSettings(data);
      default: return this.err(0x1c);
    }
  }

  iso(a) {
    const ins = a[1];
    if (ins === 0xa4) {
      const lc = a[4], data = a.subarray(5, 5 + lc);
      if (a[2] === 0x04) {
        if (!data.equals(AID)) return SW(0x6a, 0x82);
        this.appSelected = true; this.ef = null; this.sess = null; this.pending = null;
        return OK9000;
      }
      if (a[2] === 0x00 && this.appSelected && (data.toString("hex") === "e104" || data.toString("hex") === "e103")) {
        this.ef = data.toString("hex");
        return OK9000;
      }
      return SW(0x6a, 0x82);
    }
    if (ins === 0xb0) {
      if (this.ef !== "e104") return SW(0x69, 0x86);
      if (this.access.read !== 0xe) return SW(0x69, 0x82);
      const off = (a[2] << 8) | a[3], le = a[4] || 256;
      if (off + le > 256) return SW(0x6b, 0x00);
      return Buffer.concat([this.mirrored().subarray(off, off + le), OK9000]);
    }
    if (ins === 0xd6) {
      if (this.ef !== "e104") return SW(0x69, 0x86);
      if (this.access.write !== 0xe) return SW(0x69, 0x82);
      const off = (a[2] << 8) | a[3], lc = a[4];
      if (a.length !== 5 + lc || off + lc > 256) return SW(0x67, 0x00);
      a.subarray(5, 5 + lc).copy(this.file, off);
      return OK9000;
    }
    return SW(0x6d, 0x00);
  }

  getKeyVersion(data) {
    if (data.length !== 1 || data[0] > 4) return this.err(0x40);
    if (this.sess) return this.macResponse(Buffer.from([this.keyVer[data[0]]]));
    return Buffer.from([this.keyVer[data[0]], 0x91, 0x00]);
  }

  auth1(data) {
    if (data.length < 2 || data[0] > 4) return this.err(0x40);
    this.sess = null;
    const rndB = crypto.randomBytes(16);
    this.pending = { keyNo: data[0], rndB };
    return Buffer.concat([cbc(this.keys[data[0]], Buffer.alloc(16), rndB), SW(0x91, 0xaf)]);
  }

  auth2(data) {
    const p = this.pending;
    this.pending = null;
    if (!p || data.length !== 32) return this.err(0xca);
    const key = this.keys[p.keyNo];
    const plain = cbc(key, Buffer.alloc(16), data, true);
    const rndA = plain.subarray(0, 16);
    if (!plain.subarray(16).equals(rotl(p.rndB))) return this.err(0xae);
    const ti = crypto.randomBytes(4);
    const ctx = Buffer.concat([rndA.subarray(0, 2), xor(rndA.subarray(2, 8), p.rndB.subarray(0, 6)), p.rndB.subarray(6), rndA.subarray(8)]);
    this.sess = {
      keyNo: p.keyNo, ti, ctr: 0,
      enc: cmac(key, Buffer.concat([Buffer.from("a55a00010080", "hex"), ctx])),
      mac: cmac(key, Buffer.concat([Buffer.from("5aa500010080", "hex"), ctx])),
    };
    const resp = cbc(key, Buffer.alloc(16), Buffer.concat([ti, rotl(rndA), Buffer.alloc(12)]));
    return Buffer.concat([resp, SW(0x91, 0x00)]);
  }

  changeFileSettings(payload) {
    if (!this.sess) return this.err(0xae);
    const m = this.openFull(0x5f, payload, 1);
    if (!m || m.lengthError) return this.err(0x7e);
    if (m.macError) return this.err(0x1e);
    if (m.header[0] !== 0x02) return this.err(0xf0);
    if (this.sess.keyNo !== this.access.change) return this.err(0x9d);
    const d = m.data;
    if (d.length < 3) return this.err(0x7e);
    const option = d[0], ar = [d[1], d[2]];
    let sdm = null, need = 3;
    if (option & 0x40) {
      if (d.length < 6) return this.err(0x7e);
      sdm = { options: d[3], ar: [d[4], d[5]] };
      const v = d[4] | (d[5] << 8);
      const metaRead = (v >> 12) & 15, fileRead = (v >> 8) & 15;
      let o = 6;
      if (metaRead === 0xe) return this.err(0x9e);   // klartext-UID stöds inte i simulatorn
      if (metaRead <= 4) { sdm.picc = rd24(d, o); o += 3; }
      if (fileRead <= 4) { sdm.macIn = rd24(d, o); sdm.mac = rd24(d, o + 3); o += 6; }
      if (sdm.options & 0x10 || sdm.options & 0x20) return this.err(0x9e);
      need = o;
      if (sdm.picc + 32 > 256 || sdm.mac + 16 > 256 || sdm.macIn > sdm.mac || (sdm.picc < sdm.mac + 16 && sdm.mac < sdm.picc + 32)) return this.err(0x9e);
    }
    if (d.length !== need) return this.err(0x7e);
    this.fileOption = option; this.ar = ar; this.sdm = sdm;
    // Försiktigt antagande: att slå på SDM igen nollställer läsräknaren
    if (option & 0x40) this.readCtr = 0;
    return this.macResponse();
  }

  changeKey(payload) {
    if (!this.sess) return this.err(0xae);
    if (this.sess.keyNo !== 0) return this.err(0x9d);
    const m = this.openFull(0xc4, payload, 1);
    if (!m || m.lengthError) return this.err(0x7e);
    if (m.macError) return this.err(0x1e);
    const no = m.header[0], d = m.data;
    if (no > 4) return this.err(0x40);
    if (no === this.sess.keyNo) {
      if (d.length !== 17) return this.err(0x7e);
      this.keys[no] = Buffer.from(d.subarray(0, 16)); this.keyVer[no] = d[16];
      this.sess = null;                       // sessionen avslutas, svaret saknar MAC
      return SW(0x91, 0x00);
    }
    if (d.length !== 21) return this.err(0x7e);
    const nk = xor(d.subarray(0, 16), this.keys[no]);
    if (!jamcrc(nk).equals(d.subarray(17, 21))) return this.err(0x1e);
    this.keys[no] = nk; this.keyVer[no] = d[16];
    return this.macResponse();
  }

  writeData(data) {
    if (data.length < 7 || data[0] !== 0x02) return this.err(0x7e);
    const off = rd24(data, 1), len = rd24(data, 4), body = data.subarray(7);
    const w = this.access.write;
    const allowed = w === 0xe || (this.sess && (this.sess.keyNo === w || this.sess.keyNo === this.access.rw));
    if (!allowed) return this.err(0x9d);
    if ((this.fileOption & 0x03) !== 0) return this.err(0x9e);   // simulatorn: bara CommMode plain
    if (body.length !== len || off + len > 256) return this.err(0x7e);
    body.copy(this.file, off);
    if (this.sess) this.sess.ctr += 1;    // klartext i sessionen räknar ändå upp
    return SW(0x91, 0x00);
  }

  getFileSettings(payload) {
    if (this.sess) return this.err(0x1c);   // MAC-läge i sessionen används inte av verktyget
    if (payload.length !== 1 || payload[0] !== 0x02) return this.err(0xf0);
    return Buffer.concat([this.fileSettingsBytes(), SW(0x91, 0x00)]);
  }
}

// transceive(bytes) som NfcManager.isoDepHandler — med avbrott: cut = { at: n, after: bool }
// bryter kontakten vid n:te kommandot (före eller efter att taggen utfört det).
function connect(tag, { cut = null, asArray = false } = {}) {
  let n = 0;
  return async (bytes) => {
    const i = n++;
    if (cut && i === cut.at && !cut.after) { tag.reset(); throw new TagLost(); }
    const r = tag.process(Buffer.from(bytes));
    if (cut && i === cut.at && cut.after) { tag.reset(); throw new TagLost(); }
    return asArray ? [...r] : new Uint8Array(r);
  };
}

module.exports = { SimTag, connect, TagLost, cmac, aesEcb, jamcrc };
