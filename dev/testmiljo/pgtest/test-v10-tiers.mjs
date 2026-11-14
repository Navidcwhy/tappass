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
const set = (tiers, tok = "tok-linnea") => call("merchant_set_reward_tiers", tok, JSON.stringify(tiers));
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
eq((await call("merchant_set_reward_tiers", "fel", "[]")).error, "bad_session", "fel session");
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

// ── Behörigheter ─────────────────────────────────────────────────────
const priv = async (fn) => (await one(`select has_function_privilege('anon', 'public.${fn}', 'execute') as a`)).a;
eq(await priv("save_reward(text, text, integer)"), true, "anon: save_reward");
eq(await priv("cancel_saved_reward(text, text)"), true, "anon: cancel_saved_reward");
eq(await priv("merchant_get_reward_tiers(text)"), true, "anon: merchant_get_reward_tiers");
eq(await priv("merchant_set_reward_tiers(text, jsonb)"), true, "anon: merchant_set_reward_tiers");
eq(await priv("reward_tiers_clean(jsonb, integer)"), false, "stängd: reward_tiers_clean");
eq(await priv("reward_label(uuid, integer)"), false, "stängd: reward_label");

console.log("v10 OK:", passed, "kontroller");
