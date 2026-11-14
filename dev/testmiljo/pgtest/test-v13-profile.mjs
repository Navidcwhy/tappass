// v13: Självservice-profil — butiken ändrar typ, område, belöningstext, färg, logga,
// adress, beskrivning, webbplats, Instagram och öppettider.
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import assert from "node:assert/strict";

let passed = 0;
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); passed++; };
const ok = (c, msg) => { assert.ok(c, msg); passed++; };
const R = "/home/claude/tappass/supabase_migration_";
const read = (v) => fs.readFileSync(R + v + ".sql", "utf8");
const BASE = fs.readFileSync(new URL("./base.sql", import.meta.url), "utf8");
const V13 = read("v13_profil");
const CHAIN = ["v6_dagens_hjul", "v7_buggfixar", "v8_lugna_timmar", "v9_inlosen_tapp", "v10_fler_beloningar", "v11_stamgaster"];

{
  const early = new PGlite();
  await early.exec(BASE);
  for (const v of CHAIN) await early.exec(read(v));
  let msg = "";
  try { await early.exec(V13); } catch (e) { msg = e.message; }
  ok(/Kör v12 först/.test(msg), "v13 kräver v12: " + msg);
  await early.close();
}

const db = new PGlite();
const call = async (fn, ...args) =>
  (await db.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args)).rows[0].r;
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
await db.exec(BASE);
for (const v of [...CHAIN, "v12_insikter"]) await db.exec(read(v));
await db.exec(`
  insert into cafes(slug, name, type, area, stamps_needed, reward_text, reward_short, city, ink_color, soft_color, deep_color) values
    ('linnea', 'Café Linnea', 'Kafé', 'Vasastan', 10, 'En kaffe på huset', 'Gratis kaffe', 'Stockholm', '#A04A22', '#F3E5DA', '#3C1A0C'),
    ('miyabi', 'Miyabi', 'Sushi-restaurang', 'Lidingö', 6, 'En 5-bitars sushi på huset', 'Gratis 5-bitars sushi', 'Stockholm', '#1B5A66', '#DEE9EA', '#0C2A30');
  insert into tags(cafe_id, token) select id, slug || '-01' from cafes;
  insert into merchant_sessions(token_hash, cafe_id, expires_at)
    select encode(sha256(convert_to('tok-' || slug, 'UTF8')), 'hex'), id, now() + interval '30 days' from cafes;
`);
await db.exec(V13);
await db.exec(V13);   // kan köras två gånger

// ── Läsa ─────────────────────────────────────────────────────────────
const g = await call("merchant_get_profile", "tok-linnea");
eq([g.ok, g.name, g.slug, g.city, g.stamps_needed, g.type, g.area, g.ink_color], [true, "Café Linnea", "linnea", "Stockholm", 10, "Kafé", "Vasastan", "#A04A22"], "profilen läses");
eq([g.address, g.description, g.website, g.instagram, g.opening_hours, g.logo_version, g.logo], ["", "", "", "", [], 0, null], "tomma fält");
eq((await call("merchant_get_profile", "fel")).error, "bad_session", "fel session");

// ── Färgerna ─────────────────────────────────────────────────────────
const cv = async (ink) => (await one(`select public.color_variants($1) as c`, [ink])).c;
const linnea = await cv("#a04a22");
eq(linnea.ink, "#A04A22", "versaler");
const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
const lum = (s) => { const [r, gg, b] = hex(s); return (Math.max(r, gg, b) + Math.min(r, gg, b)) / 2 / 255; };
ok(Math.abs(lum(linnea.soft) - 0.91) < 0.01 && Math.abs(lum(linnea.deep) - 0.14) < 0.01, "soft ljus, deep mörk: " + JSON.stringify(linnea));
const [sr, sg, sb] = hex(linnea.soft);
ok(sr > sg && sg > sb, "soft har samma nyans (varm) som butikens färg");
const gray = await cv("#777777");
eq([gray.soft, gray.deep], ["#E8E8E8", "#242424"], "grå förblir grå");
for (const bad of ["#12345", "123456", "#GGGGGG", null]) eq(await cv(bad), null, "ogiltig färg: " + bad);

// ── Spara ────────────────────────────────────────────────────────────
const set = (p, tok = "tok-linnea") => call("merchant_set_profile", tok, JSON.stringify(p));
const HOURS = [{ days: [1, 2, 3, 4, 5], from: "07:00", to: "18:00" }, { days: [6, 7], from: "09:00", to: "16:00" }];
const s1 = await set({ type: " Kafé & bageri ", area: "Vasastan", reward_text: "En kaffe eller te på huset", reward_short: "Gratis kaffe",
  ink_color: "#2e6b4f", address: "Upplandsgatan 9, 113 23 Stockholm", description: "Surdeg och kaffe sedan 2012.",
  website: "https://cafelinnea.se", instagram: "@cafe.linnea", opening_hours: HOURS });
eq([s1.ok, s1.type, s1.reward_text, s1.ink_color, s1.instagram, s1.website], [true, "Kafé & bageri", "En kaffe eller te på huset", "#2E6B4F", "cafe.linnea", "https://cafelinnea.se"], "sparas och trimmas");
eq(s1.opening_hours, HOURS, "öppettider");
const row = await one(`select soft_color, deep_color, name, stamps_needed, profile_updated_at is not null as upd from cafes where slug = 'linnea'`);
eq([row.soft_color, row.deep_color], [(await cv("#2E6B4F")).soft, (await cv("#2E6B4F")).deep], "soft/deep följer färgen (äldre appar)");
eq([row.name, row.stamps_needed, row.upd], ["Café Linnea", 10, true], "namn och antal stämplar orörda");
// Bara några fält: resten lämnas
const s2 = await set({ description: "" });
eq([s2.description, s2.type, s2.address], ["", "Kafé & bageri", "Upplandsgatan 9, 113 23 Stockholm"], "tomt = borttaget, resten orört");
eq((await set({ instagram: "", website: "" })).website, "", "tom webbplats tillåten");
// Ogiltigt
for (const [p, field] of [
  [{ type: "" }, "type"], [{ type: "x".repeat(31) }, "type"], [{ area: 5 }, "area"],
  [{ reward_text: "" }, "reward_text"], [{ reward_short: "x".repeat(41) }, "reward_short"],
  [{ reward_text: "rad1\nrad2" }, "reward_text"],
  [{ address: "x".repeat(121) }, "address"], [{ description: "x".repeat(161) }, "description"],
  [{ website: "cafelinnea.se" }, "website"], [{ website: "javascript:alert(1)" }, "website"], [{ website: "https://localhost" }, "website"],
  [{ instagram: "café linnea" }, "instagram"], [{ instagram: "@" + "a".repeat(31) }, "instagram"],
  [{ ink_color: "red" }, "ink_color"], [{ ink_color: 123 }, "ink_color"],
  [{ opening_hours: [{ days: [1], from: "18:00", to: "07:00" }] }, "opening_hours"],
  [{ opening_hours: [{ days: [], from: "07:00", to: "18:00" }] }, "opening_hours"],
  [{ opening_hours: Array.from({ length: 15 }, () => ({ days: [1], from: "07:00", to: "08:00" })) }, "opening_hours"],
]) {
  const r = await set(p);
  eq([r.ok, r.error, r.field], [false, "invalid_field", field], "avvisas: " + JSON.stringify(p).slice(0, 50));
}
eq((await call("merchant_set_profile", "tok-linnea", "[]")).field, "profile", "inte ett objekt");
eq((await call("merchant_get_profile", "tok-linnea")).type, "Kafé & bageri", "ogiltigt sparas inte");
ok(await set({ opening_hours: [{ days: [5, 6], from: "18:00", to: "24:00" }, { days: [6, 7], from: "00:00", to: "02:00" }] }).then((r) => r.ok), "över midnatt som två perioder");
eq((await set({ website: "http://www.cafe-linnea.se/meny?x=1" })).website, "http://www.cafe-linnea.se/meny?x=1", "webbplats med sökväg");
// Andra butikens session ändrar inte Linnea
await set({ type: "Sushi" }, "tok-miyabi");
eq((await call("merchant_get_profile", "tok-linnea")).type, "Kafé & bageri", "bara egen butik");
// Appen ser profilen (load_wallet/cafes)
const appRow = await one(`select row_to_json(c) as c from cafes c where slug = 'linnea'`);
eq([appRow.c.address, appRow.c.logo_version, Array.isArray(appRow.c.opening_hours)], ["Upplandsgatan 9, 113 23 Stockholm", 0, true], "appen får fälten via cafes");

// ── Loggan ───────────────────────────────────────────────────────────
const PNG = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.from("0000000d49484452000000010000000108060000001f15c489", "hex")]).toString("base64");
const JPG = Buffer.from("ffd8ffe000104a46494600010100000100010000", "hex").toString("base64");
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x20, 0, 0, 0]), Buffer.from("WEBPVP8 ")]).toString("base64");
const l1 = await call("merchant_set_logo", "tok-linnea", "image/png", PNG);
eq([l1.ok, l1.logo_version], [true, 1], "PNG sparas, version 1");
eq((await call("merchant_set_logo", "tok-linnea", "image/jpeg", JPG)).logo_version, 2, "JPEG ersätter, version 2");
eq((await call("merchant_set_logo", "tok-linnea", "image/webp", WEBP)).logo_version, 3, "WebP, version 3");
for (const [mime, data, why] of [
  ["image/png", JPG, "JPEG som PNG"], ["image/gif", PNG, "GIF"], ["image/png", "inte base64!!", "trasig base64"],
  ["image/png", Buffer.alloc(200001, 1).toString("base64"), "för stor"], ["image/svg+xml", PNG, "SVG"],
]) eq((await call("merchant_set_logo", "tok-linnea", mime, data)).error, "invalid_logo", "avvisas: " + why);
const pub = await call("cafe_logo", "linnea");
eq([pub.ok, pub.version, pub.mime, pub.data], [true, 3, "image/webp", WEBP], "appen hämtar loggan");
const gp = await call("merchant_get_profile", "tok-linnea");
eq([gp.logo_version, gp.logo.mime, gp.logo.data], [3, "image/webp", WEBP], "panelen ser loggan");
eq(await call("cafe_logo", "miyabi"), { ok: true, version: 0, mime: null, data: null }, "ingen logga");
eq((await call("cafe_logo", "finns-inte")).error, "not_found", "okänd butik");
const rm = await call("merchant_set_logo", "tok-linnea", null, null);
eq([rm.ok, rm.logo_version, (await call("cafe_logo", "linnea")).data], [true, 0, null], "loggan tas bort");
eq((await call("merchant_set_logo", "fel", "image/png", PNG)).error, "bad_session", "fel session");
eq((await one(`select count(*)::int n from cafe_logos`)).n, 0, "inga rester");

// ── Behörigheter ─────────────────────────────────────────────────────
const priv = async (fn) => (await one(`select has_function_privilege('anon', 'public.${fn}', 'execute') as a`)).a;
for (const fn of ["hsl_hex(double precision, double precision, double precision)", "color_variants(text)", "opening_hours_clean(jsonb)", "profile_text(jsonb, integer, integer)"])
  eq(await priv(fn), false, "stängd: " + fn);
for (const fn of ["merchant_get_profile(text)", "merchant_set_profile(text, jsonb)", "merchant_set_logo(text, text, text)", "cafe_logo(text)"])
  eq(await priv(fn), true, "anon: " + fn);
eq((await one(`select has_table_privilege('anon', 'public.cafe_logos', 'select') as a`)).a, false, "cafe_logos stängd för klienter");

console.log("v13 OK:", passed, "kontroller");
