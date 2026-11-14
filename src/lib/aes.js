// AES-128 (FIPS-197), CBC, AES-CMAC (RFC 4493) och CRC32 i ren JavaScript — utan
// inbyggda moduler, så att taggverktyget (ntag424.js) kan nå appen med en OTA-uppdatering.
// Bara för NTAG 424 DNA-protokollet (korta meddelanden); inte optimerat för stora data.

// S-boxarna räknas fram (multiplikativ invers i GF(2^8) + affin avbildning) i stället för
// att skrivas av — en avskrivningsmiss i en tabell vore svår att upptäcka.
const SBOX = new Uint8Array(256);
const INV_SBOX = new Uint8Array(256);
(function buildSbox() {
  const rotl8 = (x, s) => ((x << s) | (x >>> (8 - s))) & 0xff;
  let p = 1;
  let q = 1;
  do {
    p = (p ^ ((p << 1) & 0xff) ^ (p & 0x80 ? 0x1b : 0)) & 0xff;   // p · 3
    q ^= q << 1; q ^= q << 2; q ^= q << 4; q &= 0xff;              // q / 3
    if (q & 0x80) q ^= 0x09;
    const s = q ^ rotl8(q, 1) ^ rotl8(q, 2) ^ rotl8(q, 3) ^ rotl8(q, 4);
    SBOX[p] = (s ^ 0x63) & 0xff;
    INV_SBOX[SBOX[p]] = p;
  } while (p !== 1);
  SBOX[0] = 0x63;
  INV_SBOX[0x63] = 0;
})();

const xtime = (b) => ((b << 1) ^ (b & 0x80 ? 0x1b : 0)) & 0xff;
function gmul(a, b) {
  let r = 0;
  while (b) {
    if (b & 1) r ^= a;
    a = xtime(a);
    b >>= 1;
  }
  return r;
}

const RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];
const keyCache = new Map();

// 11 rundnycklar à 16 byte (kolumnvis, som tillståndet)
function expandKey(key) {
  const k = bytes(key);
  if (k.length !== 16) throw new Error("AES-128 kräver en nyckel på 16 byte");
  const id = toHex(k);
  const hit = keyCache.get(id);
  if (hit) return hit;
  const w = new Uint8Array(176);
  w.set(k);
  for (let i = 16; i < 176; i += 4) {
    let t0 = w[i - 4], t1 = w[i - 3], t2 = w[i - 2], t3 = w[i - 1];
    if (i % 16 === 0) {
      const r = RCON[i / 16 - 1];
      [t0, t1, t2, t3] = [SBOX[t1] ^ r, SBOX[t2], SBOX[t3], SBOX[t0]];
    }
    w[i] = w[i - 16] ^ t0;
    w[i + 1] = w[i - 15] ^ t1;
    w[i + 2] = w[i - 14] ^ t2;
    w[i + 3] = w[i - 13] ^ t3;
  }
  if (keyCache.size > 32) keyCache.clear();
  keyCache.set(id, w);
  return w;
}

function addRoundKey(s, w, round) {
  for (let i = 0; i < 16; i++) s[i] ^= w[round * 16 + i];
}

export function aesEncryptBlock(key, block) {
  const w = expandKey(key);
  const s = Uint8Array.from(bytes(block));
  if (s.length !== 16) throw new Error("AES-blocket ska vara 16 byte");
  addRoundKey(s, w, 0);
  for (let round = 1; round <= 10; round++) {
    for (let i = 0; i < 16; i++) s[i] = SBOX[s[i]];
    // ShiftRows: rad r flyttas r steg åt vänster (byte i = rad + 4·kolumn)
    const t = Uint8Array.from(s);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) s[r + 4 * c] = t[r + 4 * ((c + r) % 4)];
    if (round < 10) {
      for (let c = 0; c < 4; c++) {
        const a0 = s[4 * c], a1 = s[4 * c + 1], a2 = s[4 * c + 2], a3 = s[4 * c + 3];
        s[4 * c] = xtime(a0) ^ (xtime(a1) ^ a1) ^ a2 ^ a3;
        s[4 * c + 1] = a0 ^ xtime(a1) ^ (xtime(a2) ^ a2) ^ a3;
        s[4 * c + 2] = a0 ^ a1 ^ xtime(a2) ^ (xtime(a3) ^ a3);
        s[4 * c + 3] = (xtime(a0) ^ a0) ^ a1 ^ a2 ^ xtime(a3);
      }
    }
    addRoundKey(s, w, round);
  }
  return s;
}

export function aesDecryptBlock(key, block) {
  const w = expandKey(key);
  const s = Uint8Array.from(bytes(block));
  if (s.length !== 16) throw new Error("AES-blocket ska vara 16 byte");
  addRoundKey(s, w, 10);
  for (let round = 9; round >= 0; round--) {
    const t = Uint8Array.from(s);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) s[r + 4 * ((c + r) % 4)] = t[r + 4 * c];
    for (let i = 0; i < 16; i++) s[i] = INV_SBOX[s[i]];
    addRoundKey(s, w, round);
    if (round > 0) {
      for (let c = 0; c < 4; c++) {
        const a0 = s[4 * c], a1 = s[4 * c + 1], a2 = s[4 * c + 2], a3 = s[4 * c + 3];
        s[4 * c] = gmul(a0, 14) ^ gmul(a1, 11) ^ gmul(a2, 13) ^ gmul(a3, 9);
        s[4 * c + 1] = gmul(a0, 9) ^ gmul(a1, 14) ^ gmul(a2, 11) ^ gmul(a3, 13);
        s[4 * c + 2] = gmul(a0, 13) ^ gmul(a1, 9) ^ gmul(a2, 14) ^ gmul(a3, 11);
        s[4 * c + 3] = gmul(a0, 11) ^ gmul(a1, 13) ^ gmul(a2, 9) ^ gmul(a3, 14);
      }
    }
  }
  return s;
}

// CBC utan utfyllnad (längden måste vara en multipel av 16)
export function cbcEncrypt(key, iv, data) {
  const d = bytes(data);
  if (d.length % 16) throw new Error("CBC kräver hela block");
  const out = new Uint8Array(d.length);
  let prev = bytes(iv);
  for (let i = 0; i < d.length; i += 16) {
    const block = new Uint8Array(16);
    for (let j = 0; j < 16; j++) block[j] = d[i + j] ^ prev[j];
    prev = aesEncryptBlock(key, block);
    out.set(prev, i);
  }
  return out;
}

export function cbcDecrypt(key, iv, data) {
  const d = bytes(data);
  if (d.length % 16) throw new Error("CBC kräver hela block");
  const out = new Uint8Array(d.length);
  let prev = bytes(iv);
  for (let i = 0; i < d.length; i += 16) {
    const block = d.slice(i, i + 16);
    const plain = aesDecryptBlock(key, block);
    for (let j = 0; j < 16; j++) out[i + j] = plain[j] ^ prev[j];
    prev = block;
  }
  return out;
}

// AES-CMAC (RFC 4493)
export function cmac(key, message) {
  const m = bytes(message);
  const dbl = (b) => {
    const o = new Uint8Array(16);
    for (let i = 0; i < 16; i++) o[i] = ((b[i] << 1) | (i < 15 ? b[i + 1] >>> 7 : 0)) & 0xff;
    if (b[0] & 0x80) o[15] ^= 0x87;
    return o;
  };
  const k1 = dbl(aesEncryptBlock(key, new Uint8Array(16)));
  const k2 = dbl(k1);
  const n = Math.max(1, Math.ceil(m.length / 16));
  const last = new Uint8Array(16);
  if (m.length && m.length % 16 === 0) {
    for (let j = 0; j < 16; j++) last[j] = m[(n - 1) * 16 + j] ^ k1[j];
  } else {
    const rest = m.length - (n - 1) * 16;
    for (let j = 0; j < 16; j++) last[j] = (j < rest ? m[(n - 1) * 16 + j] : j === rest ? 0x80 : 0) ^ k2[j];
  }
  let x = new Uint8Array(16);
  for (let i = 0; i < n - 1; i++) {
    const block = new Uint8Array(16);
    for (let j = 0; j < 16; j++) block[j] = x[j] ^ m[i * 16 + j];
    x = aesEncryptBlock(key, block);
  }
  for (let j = 0; j < 16; j++) last[j] ^= x[j];
  return aesEncryptBlock(key, last);
}

// NXP:s förkortade MAC: byte 1, 3 … 15 av CMAC:en
export const macTrunc = (mac) => Uint8Array.from([1, 3, 5, 7, 9, 11, 13, 15].map((i) => mac[i]));

// JAMCRC (CRC-32 utan avslutande XOR), minst signifikanta byte först — som NTAG 424 vill ha i ChangeKey
let crcTable = null;
export function jamCrc32(data) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of bytes(data)) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
  crc >>>= 0;
  return Uint8Array.from([crc & 0xff, (crc >>> 8) & 0xff, (crc >>> 16) & 0xff, (crc >>> 24) & 0xff]);
}

// ---- byte-hjälp ----
export function bytes(x) {
  if (x instanceof Uint8Array) return x;
  if (Array.isArray(x)) return Uint8Array.from(x);
  if (typeof x === "string") return fromHex(x);
  if (x == null) return new Uint8Array(0);
  return Uint8Array.from(x);
}
export function fromHex(h) {
  const s = String(h).replace(/\s+/g, "");
  if (s.length % 2 || /[^0-9a-f]/i.test(s)) throw new Error("Ogiltig hex");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
}
export const toHex = (b) => Array.from(bytes(b), (v) => v.toString(16).padStart(2, "0")).join("");
export function concat(...parts) {
  const list = parts.map(bytes);
  const out = new Uint8Array(list.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of list) { out.set(p, o); o += p.length; }
  return out;
}
export const xorBytes = (a, b) => Uint8Array.from(bytes(a), (v, i) => v ^ bytes(b)[i]);
export function equalBytes(a, b) {
  const x = bytes(a), y = bytes(b);
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}
