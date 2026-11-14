// v10: Fler belöningar — kunden väljer nivå, överskottet räknas från vald nivå.
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import assert from "node:assert/strict";

const db = new PGlite();
let passed = 0;
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); passed++; };
const ok = (c, msg) => { assert.ok(c, msg); passed++; };
const call = async (fn, ...args) =>
  (await db.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args)).rows[0].r;
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const R = "/home/claude/tappass/supabase_migration_";

await db.exec(fs.readFileSync(new URL("./base.sql", import.meta.url), "utf8"));
for (const v of ["v6_dagens_hjul", "v7_buggfixar", "v8_lugna_timmar", "v9_inlosen_tapp"]) await db.exec(fs.readFileSync(R + v + ".sql", "utf8"));
await db.exec(`
  insert into cafes(slug, name, type, area, stamps_needed, reward_text, reward_short, city, stamp_cooldown_seconds) values
    ('linnea', 'Café Linnea', 'Kafé', 'Vasastan', 10, 'En kaffe på huset', 'Gratis kaffe', 'Stockholm', 10),
    ('miyabi', 'Miyabi', 'Sushi-restaurang', 'Lidingö', 6, 'En 5-bitars sushi på huset', 'Gratis 5-bitars sushi', 'Stockholm', 10);
  insert into tags(cafe_id, token) select id, slug || '-01' from cafes;
  insert into merchant_sessions(token_hash, cafe_id, expires_at)
    select encode(sha256(convert_to('tok-' || slug, 'UTF8')), 'hex'), id, now() + interval '30 days' from cafes;
`);
const V10 = fs.readFileSync(R + "v10_fler_beloningar.sql", "utf8");

// Före v10: gamla save_reward(device, slug) fungerar (baslinje)
const base = "device-BASE-0001";
await call("tap_token", base, "miyabi-01");
await db.exec(V10);
await db.exec(V10);   // kan köras två gånger
eq((await one(`select count(*)::int n from pg_proc where proname = 'save_reward'`)).n, 1, "bara en save_reward (3 argument)");

const user = async (dev, slug = "linnea") => {
  await call("tap_token", dev, slug + "-01");
  return (await one(`select id from users where device_id = $1`, [dev])).id;
};
const give = async (uid, slug, n) => db.query(
  `insert into stamps(user_id, cafe_id, stamped_at) select $1, c.id, now() - interval '3 hours' - (g || ' minutes')::interval
     from cafes c, generate_series(1, $3::int) g where c.slug = $2`, [uid, slug, n]);
const count = async (uid, slug) => (await one(`select public.stamps_since_last_redeem($1, (select id from cafes where slug = $2)) as n`, [uid, slug])).n;

// ── Panelen: sätt och läs nivåer ──────────────────────────────────────
const set = (tiers, tok = "tok-linnea", value = null) => call("merchant_set_reward_tiers", tok, JSON.stringify(tiers), value);
eq((await set([{ at: 5, text: "  Valfri kaka " }, { at: 3, text: "Kanelbulle" }])).tiers,
   [{ at: 3, text: "Kanelbulle" }, { at: 5, text: "Valfri kaka" }], "rensas och sorteras");
for (const [bad, why] of [
  [[{ at: 10, text: "x" }], "lika med huvudbelöningen"],
  [[{ at: 0, text: "x" }], "noll"],
  [[{ at: 4, text: "" }], "tom text"],
  [[{ at: 4, text: "x".repeat(41) }], "för lång text"],
  [[{ at: 4, text: "a" }, { at: 4, text: "b" }], "dubblett"],
  [[1, 2, 3, 4].map((at) => ({ at, text: "t" + at })), "fler än 3"],
  [[{ at: "5", text: "x" }], "at som text"],
  [[{ at: 4.5, text: "x" }], "decimal"],
  [[{ at: 99999999999, text: "x" }], "jättetal"],
  [{}, "inte en lista"],
]) eq((await set(bad)).error, "invalid_tiers", "avvisas: " + why);
eq((await call("merchant_get_reward_tiers", "tok-linnea")).tiers, [{ at: 3, text: "Kanelbulle" }, { at: 5, text: "Valfri kaka" }], "ogiltigt sparas inte");
eq((await call("merchant_set_reward_tiers", "fel", "[]", null)).error, "bad_session", "fel session");
const got = await call("merchant_get_reward_tiers", "tok-linnea");
eq([got.stamps_needed, got.reward_short, got.max_tiers], [10, "Gratis kaffe", 3], "huvudbelöningen visas");

// ── Kunden: välj nivå ─────────────────────────────────────────────────
const A = "device-AAAA-0001";
const ua = await user(A);                 // 1
await give(ua, "linnea", 6);              // 7 av 10
eq((await call("save_reward", A, "linnea", 10)).error, "not_complete", "kaffe kräver 10");
eq((await call("save_reward", A, "linnea", 4)).error, "unknown_tier", "nivå som inte finns");
const s5 = await call("save_reward", A, "linnea", 5);
eq([s5.ok, s5.tier_at, s5.reward], [true, 5, "Valfri kaka"], "kakan sparad");
eq((await call("current_saved_code", A, "linnea")).tier_at, 5, "koden visar nivån");
const s3 = await call("save_reward", A, "linnea", 3);
eq([s3.code, s3.tier_at, s3.reward], [s5.code, 3, "Kanelbulle"], "byter nivå, samma kod");
const keep = await call("save_reward", A, "linnea");
eq([keep.code, keep.tier_at], [s5.code, 3], "utan nivå (äldre app) behålls den sparade");
const wallet = await call("load_wallet", A);
const lw = wallet.find((w) => w.cafe.slug === "linnea");
eq([lw.stamps, lw.pending, lw.pending_tier, lw.cafe.reward_tiers.length], [7, true, 3, 2], "plånboken: sparad nivå 3");
const pend = await call("merchant_pending_list", "tok-linnea");
eq(pend.pending.map((p) => p.reward), ["Kanelbulle"], "väntande visar belöningen");
const tap1 = await call("redeem_by_tap", A, "linnea", "linnea-01");
eq([tap1.ok, tap1.carry_over, tap1.tier_at, tap1.reward], [true, 4, 3, "Kanelbulle"], "kanelbulle: 7 − 3 = 4 kvar");
eq(await count(ua, "linnea"), 4, "kortet börjar om på 4");

// ── Kod-inlösen räknar också från nivån ──────────────────────────────
const B = "device-BBBB-0002";
const ub = await user(B);
await give(ub, "linnea", 11);              // 12 av 10
const sb = await call("save_reward", B, "linnea", 5);
const rc = await call("merchant_redeem_by_code", "tok-linnea", sb.code);
eq([rc.ok, rc.carry_over, rc.reward], [true, 7, "Valfri kaka"], "kod: 12 − 5 = 7 kvar");
const rec = await call("merchant_recent_redemptions", "tok-linnea");
eq(rec.recent.map((r) => r.reward).sort(), ["Kanelbulle", "Valfri kaka"], "senast inlösta visar belöningen");

// ── Hela kortet som förut ────────────────────────────────────────────
const C = "device-CCCC-0003";
const uc = await user(C);
await give(uc, "linnea", 10);              // 11 av 10
const sc = await call("save_reward", C, "linnea", 10);
eq([sc.tier_at, sc.reward], [10, "Gratis kaffe"], "hela kortet = 10");
const tc = await call("redeem_by_tap", C, "linnea", "linnea-01");
eq([tc.carry_over, tc.reward], [1, "Gratis kaffe"], "kaffe: 11 − 10 = 1 kvar");

// ── Direkt med stämpeln utan val ─────────────────────────────────────
const D = "device-DDDD-0004";
const ud = await user(D);
await give(ud, "linnea", 5);               // 6: kakan nådd, inte fullt
eq((await call("redeem_by_tap", D, "linnea", "linnea-01")).error, "choose_reward", "måste välja när en nivå är nådd");
await give(ud, "linnea", 4);               // 10: fullt
const td = await call("redeem_by_tap", D, "linnea", "linnea-01");
eq([td.ok, td.reward, td.carry_over], [true, "Gratis kaffe", 0], "fullt kort: huvudbelöningen direkt");

// ── Ångra ────────────────────────────────────────────────────────────
const E = "device-EEEE-0005";
const ue = await user(E);
await give(ue, "linnea", 5);               // 6
await call("save_reward", E, "linnea", 5);
await db.query(`update stamps set stamped_at = now() - interval '3 hours'`);
eq((await call("tap_token", E, "linnea-01")).error, "pending_reward", "sparad kaka blockerar stämpling");
const cancel = await call("cancel_saved_reward", E, "linnea");
eq([cancel.ok, cancel.stamps], [true, 6], "ångrad, stämplarna kvar");
eq((await call("current_saved_code", E, "linnea")).code, null, "ingen sparad kod");
eq((await call("tap_token", E, "linnea-01")).stamps, 7, "samlar vidare");
eq((await call("cancel_saved_reward", E, "linnea")).error, "nothing_saved", "inget att ångra");
eq((await call("merchant_pending_list", "tok-linnea")).pending.length, 0, "ångrad syns inte som väntande");

// ── Butik utan nivåer: som förut, även äldre appar ──────────────────
const F = "device-FFFF-0006";
const uf = await user(F, "miyabi");
await give(uf, "miyabi", 5);                // 6 av 6
const old = await call("save_reward", F, "miyabi");
eq([old.ok, old.tier_at, old.reward], [true, 6, "Gratis 5-bitars sushi"], "äldre app: hela kortet");
eq((await call("save_reward", F, "miyabi", 3)).error, "unknown_tier", "nivå hos butik utan nivåer");
eq((await call("merchant_get_reward_tiers", "tok-miyabi")).tiers, [], "inga nivåer");

// ── TapPass sänker antalet stämplar: nivåer över gränsen döljs ──────
await db.query(`update cafes set stamps_needed = 4 where slug = 'linnea'`);
eq((await call("merchant_get_reward_tiers", "tok-linnea")).tiers, [{ at: 3, text: "Kanelbulle" }], "nivå 5 döljs när kortet är 4");
eq((await call("save_reward", "device-AAAA-0001", "linnea", 5)).tier_at, 4, "nivå >= hela kortet behandlas som hela kortet (4 av 4)");
await db.query(`update cafes set stamps_needed = 10 where slug = 'linnea'`);

// ── Värde i kronor och sparat-räknaren ───────────────────────────────
// Butiken anger värden: kaffe 39 kr, kanelbulle 25 kr, kakan utan värde
const sv = await set([{ at: 3, text: "Kanelbulle", value_kr: 25 }, { at: 5, text: "Valfri kaka", value_kr: null }], "tok-linnea", 39);
eq([sv.ok, sv.reward_value_kr], [true, 39], "värden sparas");
const g2 = await call("merchant_get_reward_tiers", "tok-linnea");
eq([g2.reward_value_kr, g2.tiers], [39, [{ at: 3, text: "Kanelbulle", value_kr: 25 }, { at: 5, text: "Valfri kaka" }]], "panelen läser värdena (tomt värde utelämnas)");
for (const [bad, why] of [[0, "noll"], [10001, "för stort"], ["25", "text"], [25.5, "decimal"], [-3, "negativt"], [true, "sant/falskt"]])
  eq((await set([{ at: 3, text: "Kanelbulle", value_kr: bad }], "tok-linnea", 39)).error, "invalid_tiers", "nivåns värde avvisas: " + why);
for (const bad of [0, 10001, -1])
  eq((await set([], "tok-linnea", bad)).error, "invalid_value", "huvudbelöningens värde avvisas: " + bad);
const g3 = await call("merchant_get_reward_tiers", "tok-linnea");
eq([g3.reward_value_kr, g3.tiers.length], [39, 2], "ogiltigt sparas inte");

const val = async (code) => one(`select reward_name, value_kr from redemptions where redeem_code = $1`, [code]);
const card = async (dev, slug = "linnea") => (await call("load_wallet", dev)).find((w) => w.cafe.slug === slug);

// Sparad kanelbulle: namn och värde följer med även om butiken ändrar sig
const G = "device-GGGG-0007";
const ug = await user(G);                  // 1
await give(ug, "linnea", 2);               // 3
const sg = await call("save_reward", G, "linnea", 3);
eq(await val(sg.code), { reward_name: "Kanelbulle", value_kr: 25 }, "namn och värde sparas med belöningen");
await set([{ at: 5, text: "Valfri kaka", value_kr: 35 }], "tok-linnea", 42);   // kanelbullen tas bort, kaffet 42 kr
eq((await call("merchant_pending_list", "tok-linnea")).pending.find((p) => p.code === sg.code).reward, "Kanelbulle", "personalen ser den sparade belöningen");
eq((await call("current_saved_code", G, "linnea")).reward, "Kanelbulle", "appen ser den sparade belöningen");
const wg = await card(G);
eq([wg.pending_tier, wg.pending_reward, wg.rewards_redeemed, wg.saved_kr, wg.rewards_unvalued], [3, "Kanelbulle", 0, 0, 0], "plånboken: sparad kanelbulle, inget inlöst än");
const rg = await call("merchant_redeem_by_code", "tok-linnea", sg.code);
eq([rg.ok, rg.reward, rg.carry_over], [true, "Kanelbulle", 0], "inlöst: Kanelbulle (3 − 3 = 0 kvar)");
eq([(await card(G)).rewards_redeemed, (await card(G)).saved_kr], [1, 25], "sparat: 25 kr (värdet när den sparades)");
eq((await call("merchant_recent_redemptions", "tok-linnea")).recent[0].reward, "Kanelbulle", "senast inlösta: borttagen nivå visas rätt");
ok((await call("merchant_get_reward_tiers", "tok-linnea")).redeemed_30d.some((r) => r.tier_at === 3 && r.reward === "Kanelbulle"), "30 dagar: borttagen nivå med sitt namn");

// Fullt kort direkt med stämpeln: huvudbelöningens värde nu (42 kr)
// Testets stämplar är 3 h gamla: flytta kundens historik bakåt så att nya stämplar kommer efter inlösen.
const backdate = async (uid) => {
  await db.query(`update stamps set stamped_at = stamped_at - interval '2 days' where user_id = $1`, [uid]);
  await db.query(`update redemptions set saved_at = saved_at - interval '1 day', redeemed_at = redeemed_at - interval '1 day'
    where user_id = $1 and status = 'redeemed'`, [uid]);
};
await backdate(ug);
await give(ug, "linnea", 10);              // 10 av 10
const tg = await call("redeem_by_tap", G, "linnea", "linnea-01");
eq([tg.ok, tg.reward, tg.carry_over], [true, "Gratis kaffe", 0], "fullt kort direkt");
eq([(await card(G)).rewards_redeemed, (await card(G)).saved_kr], [2, 67], "sparat: 25 + 42 kr");

// Inlöst före v10 (inget namn, inget värde): räknas med butikens värde nu
await db.query(`insert into redemptions(user_id, cafe_id, saved_at, status, redeemed_at)
  select $1, id, now() - interval '40 days', 'redeemed', now() - interval '40 days' from cafes where slug = 'linnea'`, [ug]);
const wg3 = await card(G);
eq([wg3.rewards_redeemed, wg3.saved_kr, wg3.rewards_unvalued, wg3.stamps], [3, 109, 0, 0], "äldre inlösen: 42 kr, kortet orört");

// Butik utan värden: räknas men utan kronor — tills butiken anger ett värde
await user(G, "miyabi");                   // 1 av 6
await give(ug, "miyabi", 5);               // 6 av 6
eq((await call("redeem_by_tap", G, "miyabi", "miyabi-01")).ok, true, "miyabi: fullt kort direkt");
const wm = await card(G, "miyabi");
eq([wm.rewards_redeemed, wm.saved_kr, wm.rewards_unvalued], [1, 0, 1], "utan värde: 1 belöning, 0 kr, 1 utan värde");
await set([], "tok-miyabi", 89);
const wm2 = await card(G, "miyabi");
eq([wm2.saved_kr, wm2.rewards_unvalued], [89, 0], "värdet sätts senare: 89 kr");

// Byte av nivå byter också namn och värde
const H = "device-HHHH-0008";
const uh = await user(H);
await give(uh, "linnea", 10);              // 11
const sh = await call("save_reward", H, "linnea", 5);
eq(await val(sh.code), { reward_name: "Valfri kaka", value_kr: 35 }, "kakan 35 kr");
const sh2 = await call("save_reward", H, "linnea", 10);
eq([sh2.code, sh2.reward], [sh.code, "Gratis kaffe"], "byter till kaffet, samma kod");
eq(await val(sh.code), { reward_name: "Gratis kaffe", value_kr: 42 }, "namn och värde följer bytet");
await call("redeem_by_tap", H, "linnea", "linnea-01");
eq([(await card(H)).saved_kr, (await card(H)).stamps], [42, 1], "inlöst kaffe: 42 kr, 1 stämpel kvar");

// Värdet sätts efter att belöningen sparades: tas vid inlösen
const I = "device-IIII-0009";
const ui = await user(I, "miyabi");
await give(ui, "miyabi", 5);
await set([], "tok-miyabi", null);         // butiken tar bort värdet
const si = await call("save_reward", I, "miyabi");
eq(await val(si.code), { reward_name: "Gratis 5-bitars sushi", value_kr: null }, "sparad utan värde");
await set([], "tok-miyabi", 95);
await call("merchant_redeem_by_code", "tok-miyabi", si.code);
eq(await val(si.code), { reward_name: "Gratis 5-bitars sushi", value_kr: 95 }, "värdet tas vid inlösen");

// Ett felaktigt värde skrivet direkt i databasen stoppar aldrig plånboken eller sparandet
const J = "device-JJJJ-0010";
const uj = await user(J);
await give(uj, "linnea", 6);               // 7
await db.query(`update cafes set reward_tiers = '[{"at": 3, "text": "Kanelbulle", "value_kr": 25.5}, {"at": 5, "text": "Valfri kaka", "value_kr": 99999}]' where slug = 'linnea'`);
const sj = await call("save_reward", J, "linnea", 5);
eq([sj.ok, sj.reward], [true, "Valfri kaka"], "sparar trots trasigt värde");
eq(await val(sj.code), { reward_name: "Valfri kaka", value_kr: null }, "trasigt värde = inget värde");
ok(Array.isArray(await call("load_wallet", J)), "plånboken fungerar");
eq(await one(`select public.reward_value((select id from cafes where slug = 'linnea'), 3) as v`), { v: null }, "decimalvärde = null");
await set([{ at: 5, text: "Valfri kaka", value_kr: 35 }], "tok-linnea", 42);   // tillbaka

// ── Behörigheter ─────────────────────────────────────────────────────
const priv = async (fn) => (await one(`select has_function_privilege('anon', 'public.${fn}', 'execute') as a`)).a;
eq(await priv("save_reward(text, text, integer)"), true, "anon: save_reward");
eq(await priv("cancel_saved_reward(text, text)"), true, "anon: cancel_saved_reward");
eq(await priv("merchant_get_reward_tiers(text)"), true, "anon: merchant_get_reward_tiers");
eq(await priv("merchant_set_reward_tiers(text, jsonb, integer)"), true, "anon: merchant_set_reward_tiers");
eq((await one(`select count(*)::int n from pg_proc where proname = 'merchant_set_reward_tiers'`)).n, 1, "bara en merchant_set_reward_tiers (3 argument)");
eq(await priv("reward_tiers_clean(jsonb, integer)"), false, "stängd: reward_tiers_clean");
eq(await priv("reward_label(uuid, integer)"), false, "stängd: reward_label");
eq(await priv("reward_value(uuid, integer)"), false, "stängd: reward_value");

console.log("v10 OK:", passed, "kontroller");
