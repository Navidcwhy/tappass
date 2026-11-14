// Taggverktyget (v17): AES/CMAC/CRC, protokollet mot NXP AN12196:s exempelvärden,
// inklistringen av admin_sdm_issue_keys och programmeringen av en simulerad NTAG 424 DNA.
// (Hela vägen mot produktionens SQL i PGlite: pgtest/test-tagtool-e2e.mjs.)
const crypto = require("crypto");
const A = require("../src/lib/aes");
const N = require("../src/lib/ntag424");
const { SimTag, connect } = require("./sim-ntag424");

const H = (s) => s.replace(/\s+/g, "").toLowerCase();
const hex = (b) => A.toHex(b);

describe("aes.js", () => {
  test("FIPS-197 och RFC 4493", () => {
    expect(hex(A.aesEncryptBlock("000102030405060708090a0b0c0d0e0f", "00112233445566778899aabbccddeeff"))).toBe("69c4e0d86a7b0430d8cdb78070b4c55a");
    expect(hex(A.aesDecryptBlock("000102030405060708090a0b0c0d0e0f", "69c4e0d86a7b0430d8cdb78070b4c55a"))).toBe("00112233445566778899aabbccddeeff");
    const K = "2b7e151628aed2a6abf7158809cf4f3c";
    expect(hex(A.cmac(K, ""))).toBe("bb1d6929e95937287fa37d129b756746");
    expect(hex(A.cmac(K, "6bc1bee22e409f96e93d7e117393172a"))).toBe("070a16b46b4d4144f79bdd9dd04a287c");
    expect(hex(A.cmac(K, "6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e5130c81c46a35ce411"))).toBe("dfa66747de9ae63030ca32611497c827");
    expect(hex(A.cmac(K, "6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e5130c81c46a35ce411e5fbc1191a0a52eff69f2445df4f9b17ad2b417be66c3710"))).toBe("51f0bebf7e3b9d92fc49741779363cfe");
  });
  test("CBC och CMAC = Node crypto (slumpade)", () => {
    for (let i = 0; i < 100; i++) {
      const k = crypto.randomBytes(16), iv = crypto.randomBytes(16), p = crypto.randomBytes(16 * (1 + (i % 4)));
      const c = crypto.createCipheriv("aes-128-cbc", k, iv); c.setAutoPadding(false);
      const want = Buffer.concat([c.update(p), c.final()]).toString("hex");
      expect(hex(A.cbcEncrypt(new Uint8Array(k), new Uint8Array(iv), new Uint8Array(p)))).toBe(want);
      expect(hex(A.cbcDecrypt(new Uint8Array(k), new Uint8Array(iv), A.fromHex(want)))).toBe(p.toString("hex"));
      const m = crypto.randomBytes(i % 40);
      expect(hex(A.cmac(new Uint8Array(k), new Uint8Array(m)))).toBe(require("./sim-ntag424").cmac(k, m).toString("hex"));
    }
  });
  test("JAMCRC32 (minst signifikanta byte först) och förkortad MAC", () => {
    expect(hex(A.jamCrc32(Uint8Array.from("123456789", (c) => c.charCodeAt(0))))).toBe("d9c60b34");
    expect(hex(A.macTrunc(A.fromHex("00112233445566778899aabbccddeeff")))).toBe("1133557799bbddff");
    expect(() => A.fromHex("0g")).toThrow();
  });
});

describe("AN12196", () => {
  const scripted = (pairs) => { let i = 0; return async (apdu) => { const [want, resp] = pairs[i++]; expect(hex(apdu)).toBe(H(want)); return A.fromHex(resp); }; };
  test.each([
    ["§ 6.6", "13C5DB8A5930439FC3DEF9A4C675360F", "A04C124213C186F22399D33AC2A3021591AF", "90AF00002035C3E05A752E0144BAC0DE51C1F22C56B34408A23D8AEA266CAB947EA8E0118D00",
      "3FA64DB5446D1F34CD6EA311167F5E4985B89690C04A05F17FA7AB2F081206639100", "9d00c4df", "1309C877509E5A215007FF0ED19CA564", "4C6626F5E72EA694202139295C7A7FC7"],
    ["§ 6.10", "B98F4C50CF1C2E084FD150E33992B048", "B875CEB0E66A6C5CD00898DC371F92D191AF", "90AF000020FF0306E47DFBC50087C4D8A78E88E62DE1E8BE457AA477C707E2F0874916A8B100",
      "0CC9A8094A8EEA683ECAAC5C7BF20584206D0608D477110FC6B3D5D3F65C3A6A9100", "7614281a", "7A93D6571E4B180FCA6AC90C9A7488D4", "FC4AF159B62E549B5812394CAB1918CC"],
  ])("AuthenticateEV2First %s", async (_, rndA, r1, c2, r2, ti, enc, mac) => {
    const s = await N.authenticate(scripted([["9071000002000000", r1], [c2, r2]]), 0, N.ZERO_KEY, A.fromHex(rndA));
    expect([hex(s.ti), hex(s.enc), hex(s.mac), s.ctr]).toEqual([ti, H(enc), H(mac), 0]);
  });
  test("fel nyckel: 91 AE → auth", async () => {
    const tx = async (apdu) => A.fromHex(apdu[1] === 0x71 ? "A04C124213C186F22399D33AC2A3021591AF" : "91AE");
    await expect(N.authenticate(tx, 0, N.ZERO_KEY)).rejects.toMatchObject({ code: "auth", status: 0x91ae });
  });
  test("CommMode.MAC § 5.3 (GetFileSettings)", () => {
    const s = { mac: A.fromHex("8248134A386E86EB7FAF54A52E536CB6"), enc: new Uint8Array(16), ti: A.fromHex("7A21085E"), ctr: 0 };
    expect(hex(N.wrapMac(s, 0xf5, [0x02], []))).toBe(H("90F5000009026597A457C8CD442C00"));
    s.ctr = 1;
    expect(hex(N.unwrapResponse(s, A.fromHex("0040EEEE000100D1FE001F00004400004400002000006A00002A474282E7A479869100"), false))).toBe(H("0040eeee000100d1fe001f00004400004400002000006a0000"));
    expect(() => N.unwrapResponse(s, A.fromHex("0040EEEE000100D1FE001F00004400004400002000006A00002A474282E7A479879100"), false)).toThrow(expect.objectContaining({ code: "mac" }));
  });
  test("CommMode.Full § 5.4 (128 byte → helt utfyllnadsblock) och § 6.12", () => {
    const apdu = "908D000087020000008000000051D1014D550463686F6F73652E75726C2E636F6D2F6E7461673432343F653D303030303030303030303030303030303030303030303030303030303030303026633D303030303030303030303030303030300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";
    const data = A.fromHex(apdu).slice(12, 140);
    const s = { mac: A.fromHex("4C6626F5E72EA694202139295C7A7FC7"), enc: A.fromHex("1309C877509E5A215007FF0ED19CA564"), ti: A.fromHex("9D00C4DF"), ctr: 0 };
    expect(hex(N.wrapFull(s, 0x8d, A.fromHex("02000000800000"), data))).toBe(H("908D00009F02000000800000421C73A27D827658AF481FDFF20A5025B559D0E3AA21E58D347F343CFFC768BFE596C706BC00F2176781D4B0242642A0FF5A42C461AAF894D9A1284B8C76BCFA658ACD40555D362E08DB15CF421B51283F9064BCBE20E96CAE545B407C9D651A3315B27373772E5DA2367D2064AE054AF996C6F1F669170FA88CE8C4E3A4A7BBBEF0FD971FF532C3A802AF745660F2B4D1D9A8499661EBF300"));
    s.ctr = 1;
    expect(N.unwrapResponse(s, A.fromHex("FC222E5F7A5424529100"), true)).toHaveLength(0);
    const s2 = { mac: A.fromHex("FC4AF159B62E549B5812394CAB1918CC"), enc: A.fromHex("7A93D6571E4B180FCA6AC90C9A7488D4"), ti: A.fromHex("7614281A"), ctr: 0 };
    expect(hex(N.wrapFull(s2, 0x8d, A.fromHex("030000000A0000"), A.fromHex("0102030405060708090A")))).toBe(H("908D00001F030000000A00006B5E6804909962FC4E3FF5522CF0F8436C0C53315B9C73AA00"));
  });
  test("Full-svar § 7.3 (GetCardUID)", () => {
    const s = { mac: A.fromHex("379D32130CE61705DD5FD8C36B95D764"), enc: A.fromHex("2B4D963C014DC36F24F69A50A394F875"), ti: A.fromHex("DF055522"), ctr: 0 };
    expect(hex(N.wrapFull(s, 0x51, [], []))).toBe(H("90510000088E2C155ADDA99BE300"));
    s.ctr = 1;
    expect(hex(N.unwrapResponse(s, A.fromHex("70756055688505B52A5E26E59E329CD6595F672298EA41B79100"), true))).toBe("04958caa5c5e80");
  });
  test("ChangeKey § 5.16 (tabell 25 och 26)", () => {
    const s = { mac: A.fromHex("5529860B2FC5FB6154B7F28361D30BF9"), enc: A.fromHex("4CF3CB41A22583A61E89B158D252FC53"), ti: A.fromHex("7614281A"), ctr: 2 };
    expect(hex(N.wrapFull(s, 0xc4, [0x02], N.changeKeyData(2, 0, N.ZERO_KEY, A.fromHex("F3847D627727ED3BC9C4CC050489B966"), 0x01))))
      .toBe(H("90C4000029022CF362B7BF4311FF3BE1DAA295E8C68DE09050560D19B9E16C2393AE9CD1FAC75D0CE20BCD1D06E600"));
    s.ctr = 3;
    expect(N.unwrapResponse(s, A.fromHex("203BB55D1089D5879100"), true)).toHaveLength(0);
    expect(hex(N.wrapFull(s, 0xc4, [0x00], N.changeKeyData(0, 0, null, A.fromHex("5004BF991F408672B1EF00F08F9E8647"), 0x01))))
      .toBe(H("90C400002900C0EB4DEEFEDDF0B513A03A95A75491818580503190D4D05053FF75668A01D6FDA6610234BDED643200"));
  });
  test("SUN (krypterad PICC-data, nycklar 00…00) och filinställningarnas form (§ 6.9)", () => {
    expect(N.sunVerify({ e: "EF963FF7828658A599F3041510671E88", c: "94EED9EE65337086" }, N.ZERO_KEY, N.ZERO_KEY)).toEqual({ ok: true, uid: "04de5f1eacc040", counter: 61 });
    expect(N.sunVerify({ e: "ef963ff7828658a599f3041510671e88", c: "94eed9ee65337087" }, N.ZERO_KEY, N.ZERO_KEY).ok).toBe(false);
    expect(N.sunVerify({ e: "00", c: "11" }, N.ZERO_KEY, N.ZERO_KEY).ok).toBe(false);
    expect(hex(N.sdmFileSettings(0x20, 0x43))).toBe("4000e0c1ff12200000430000430000");   // AN12196: 4000E0C1F121200000430000430000 (nyckel 2/1)
  });
});

// admin_sdm_issue_keys som SQL Editor visar den (rad 12 räknad som i SQL:en, oberoende av ntag424.js)
function issued(token) {
  const keys = [0, 1, 2].map(() => crypto.randomBytes(16).toString("hex"));
  const prefix = "tappass.se/t/" + token + "?e=";
  const uri = prefix + "0".repeat(32) + "&c=" + "0".repeat(16);
  const picc = 7 + prefix.length, mac = picc + 35;
  const ndef = (5 + uri.length).toString(16).padStart(4, "0") + "d101" + (1 + uri.length).toString(16).padStart(2, "0") + "5504" + Buffer.from(uri).toString("hex");
  const rows = [
    [1, "Tagg", token], [2, "Adress (URI-record, prefix https://)", "https://" + uri],
    [3, "Nyckel 0 – huvudnyckel (AppMasterKey)", keys[0]], [4, "Nyckel 1 – SDMMetaRead (krypterar e)", keys[1]], [5, "Nyckel 2 – SDMFileRead (räknar c)", keys[2]],
    [6, "SDM", "på · UID-spegling på · läsräknare på · ASCII"], [7, "SDM-åtkomst MetaRead / FileRead / CtrRet", "1 / 2 / F"],
    [8, "PICCDataOffset", picc + " (0x" + picc.toString(16).padStart(6, "0") + ")"],
    [9, "SDMMACInputOffset", mac + " (0x" + mac.toString(16).padStart(6, "0") + ") – samma som SDMMACOffset"],
    [10, "SDMMACOffset", mac + " (0x" + mac.toString(16).padStart(6, "0") + ")"],
    [11, "NDEF-filens åtkomst", "läsa fritt (E) · skriva och ändra inställningar med nyckel 0"], [12, "NDEF-filens innehåll (hex)", ndef],
  ].map(([steg, installning, varde]) => ({ steg, installning, varde }));
  return { rows, keys, picc, mac, ndef };
}
const fmt = {
  grid: (rows) => "steg\tinstallning\tvarde\n" + rows.map((r) => [r.steg, r.installning, r.varde].join("\t")).join("\n"),
  csv: (rows) => "steg,installning,varde\n" + rows.map((r) => [r.steg, JSON.stringify(r.installning), JSON.stringify(r.varde)].join(",")).join("\n"),
  json: (rows) => JSON.stringify(rows, null, 2),
  markdown: (rows) => "| steg | installning | varde |\n|---|---|---|\n" + rows.map((r) => `| ${r.steg} | ${r.installning} | ${r.varde} |`).join("\n"),
};

describe("inklistringen", () => {
  test.each(Object.keys(fmt))("%s", (name) => {
    const x = issued("kafe-bryggan-01");
    const p = N.parseIssuedKeys(fmt[name](x.rows));
    expect([p.ok, p.token, hex(p.k0), hex(p.k1), hex(p.k2)]).toEqual([true, "kafe-bryggan-01", ...x.keys]);
    const t = N.ndefTemplate("kafe-bryggan-01");
    expect([hex(t.file), t.piccOffset, t.macOffset]).toEqual([x.ndef, x.picc, x.mac]);
  });
  test("fel och gränsfall", () => {
    const x = issued("miyabi-01");
    const g = fmt.grid(x.rows);
    expect(N.parseIssuedKeys("  ").error).toBe("empty");
    expect(N.parseIssuedKeys(g.replace(/\n4\t[^\n]*/, ""))).toMatchObject({ error: "missing_keys", missing: [1] });
    expect(N.parseErrorText(N.parseIssuedKeys(g.replace(/\n[45]\t[^\n]*/g, "")))).toBe("Hittar inte nyckel 1 och nyckel 2. Kopiera hela resultatet.");
    expect(N.parseIssuedKeys(g + "\n" + fmt.grid(issued("kafe-bryggan-01").rows)).error).toBe("two_tags");
    expect(N.parseIssuedKeys(g.replace(x.ndef, x.ndef.slice(0, -2) + "31")).error).toBe("template");
    expect(N.parseIssuedKeys(g.replace(x.keys[1], x.keys[0])).error).toBe("same_keys");
    expect(N.parseIssuedKeys(g.replace(x.keys[2], "0".repeat(32))).error).toBe("zero_key");
    expect(N.parseIssuedKeys("Nyckel 0 " + x.keys[0] + " Nyckel 1 " + x.keys[1] + " Nyckel 2 " + x.keys[2]).error).toBe("no_tag");
    const short = N.parseIssuedKeys("Tagg miyabi-01\nNyckel 0: " + x.keys[0].toUpperCase() + "\nNyckel 1: " + x.keys[1] + "\nNyckel 2: " + x.keys[2]);
    expect([short.ok, short.token, hex(short.k0)]).toEqual([true, "miyabi-01", x.keys[0]]);
    expect(N.maskKey(A.fromHex(x.keys[0]))).toBe("••••" + x.keys[0].slice(-4));
  });
});

describe("programmering av en simulerad tagg", () => {
  const x = issued("miyabi-01");
  const cfg = N.parseIssuedKeys(fmt.grid(x.rows));
  const K = x.keys;
  const expectDone = (tag) => {
    expect(tag.keys.slice(0, 3).map((k) => k.toString("hex"))).toEqual(K);
    expect([...tag.keyVer]).toEqual([1, 1, 1, 0, 0]);
    expect([tag.fileOption, ...tag.ar, tag.sdm.options, ...tag.sdm.ar, tag.sdm.picc, tag.sdm.macIn, tag.sdm.mac]).toEqual([0x40, 0x00, 0xe0, 0xc1, 0xff, 0x12, x.picc, x.mac, x.mac]);
    expect(tag.file.subarray(0, x.ndef.length / 2).toString("hex")).toBe(x.ndef);
  };

  test("fabrikstagg → dynamisk, svaren som nfc-manager ger (number[])", async () => {
    const tag = new SimTag();
    const steps = [];
    const r = await N.programTag(connect(tag, { asArray: true }), cfg, (s) => steps.push(s));
    expect(steps).toEqual(["connect", "ndef", "sdm", "keys", "verify"]);
    expect(r).toMatchObject({ token: "miyabi-01", uid: tag.uid.toString("hex") });
    expectDone(tag);
    expect(tag.log.filter((h) => h.startsWith("90c4")).map((h) => h.slice(10, 12))).toEqual(["01", "02", "00"]);
    // Omkörning: inget skrivs om — inte heller filinställningarna (kan nollställa läsräknaren)
    const ctr = tag.readCtr, before = tag.log.length;
    await N.programTag(connect(tag), cfg);
    expect(tag.log.slice(before).filter((h) => /^(90c4|905f|00d6|908d)/.test(h))).toEqual([]);
    expect(tag.readCtr).toBeGreaterThan(ctr);
    expect(N.settingsMatch(A.fromHex("0040" + "00e0" + "000100" + "c1ff12" + "200000430000430000"), N.sdmFileSettings(0x20, 0x43))).toBe(true);
    expect(N.settingsMatch(A.fromHex("0000e0ee000100"), N.sdmFileSettings(0x20, 0x43))).toBe(false);
  });
  test("avbrott vid varje kommando → nästa försök fortsätter", async () => {
    const full = new SimTag();
    await N.programTag(connect(full), cfg);
    const n = full.log.length;
    for (let at = 0; at < n; at++) {
      for (const after of [false, true]) {
        const tag = new SimTag();
        await expect(N.programTag(connect(tag, { cut: { at, after } }), cfg)).rejects.toMatchObject({ code: "lost" });
        await N.programTag(connect(tag), cfg);
        expectDone(tag);
      }
    }
  });
  test("andra nycklar, främmande taggar och annan kortsort", async () => {
    const tag = new SimTag();
    await N.programTag(connect(tag), cfg);
    const other = N.parseIssuedKeys(fmt.grid(issued("miyabi-01").rows));
    await expect(N.programTag(connect(tag), other)).rejects.toMatchObject({ code: "wrong_key" });
    const t1 = new SimTag(); t1.keys[0] = crypto.randomBytes(16);
    await expect(N.programTag(connect(t1), cfg)).rejects.toMatchObject({ code: "foreign_key" });
    const t2 = new SimTag(); t2.keys[2] = crypto.randomBytes(16);
    await expect(N.programTag(connect(t2), cfg)).rejects.toMatchObject({ code: "foreign_key2" });
    await expect(N.programTag(async () => [0x6a, 0x82], cfg)).rejects.toMatchObject({ code: "not_ntag424" });
  });
  test("återställning och ny programmering", async () => {
    const tag = new SimTag();
    await N.programTag(connect(tag), cfg);
    await expect(N.resetTag(connect(tag), { ...cfg, k2: crypto.randomBytes(16) })).rejects.toMatchObject({ code: "wrong_key2" });
    await N.resetTag(connect(tag), cfg);
    expect([tag.keys.every((k) => k.equals(Buffer.alloc(16))), [...tag.keyVer], tag.fileOption, ...tag.ar]).toEqual([true, [0, 0, 0, 0, 0], 0, 0xe0, 0xee]);
    await N.programTag(connect(tag), cfg);
    expectDone(tag);
  });
  test("felrutorna", () => {
    expect(N.programErrorText({ code: "lost" })).toMatch(/^Kontakten bröts/);
    expect(N.programErrorText({ code: "wrong_key" })).toMatch(/andra nycklar/);
    expect(N.programErrorText({ code: "foreign_key1" })).toBe("Taggens nyckel 1 är redan bytt av ett annat verktyg. Använd en ny NTAG 424 DNA-tagg.");
    expect(N.programErrorText(new N.TagError("protocol", 0x917e))).toBe("Taggen svarade oväntat (91 7E). Försök igen.");
    expect(N.programErrorText(new Error("x"))).toBe("Taggen svarade oväntat. Försök igen.");
  });
});
