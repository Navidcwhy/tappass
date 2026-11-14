// v9: Inlösen med tapp — redeem_by_tap och merchant_recent_redemptions.
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
for (const v of ["v6_dagens_hjul", "v7_buggfixar", "v8_lugna_timmar"]) await db.exec(fs.readFileSync(R + v + ".sql", "utf8"));
await db.exec(`
  insert into cafes(slug, name, type, area, stamps_needed, city, stamp_cooldown_seconds) values
    ('miyabi', 'Miyabi', 'Sushi-restaurang', 'Lidingö', 6, 'Stockholm', 10),
    ('bryggan', 'Bryggans Bageri', 'Bageri', 'Södermalm', 8, 'Stockholm', 10);
  insert into tags(cafe_id, token) select id, slug || '-01' from cafes;
  insert into merchant_sessions(token_hash, cafe_id, expires_at)
    select encode(sha256(convert_to('tok-' || slug, 'UTF8')), 'hex'), id, now() + interval '30 days' from cafes;
`);
const V9 = fs.readFileSync(R + "v9_inlosen_tapp.sql", "utf8");
await db.exec(V9);
await db.exec(V9);   // kan köras två gånger

// Hjälp: ge en enhet n stämplar hos en butik (bakåtdaterade, förbi väntetiden)
const user = async (dev) => {
  await call("tap_token", dev, "miyabi-01");   // skapar användaren + 1 stämpel
  return (await one(`select id from users where device_id = $1`, [dev])).id;
};
const give = async (uid, slug, n) => db.query(
  `insert into stamps(user_id, cafe_id, stamped_at) select $1, c.id, now() - interval '1 hour' - (g || ' minutes')::interval
     from cafes c, generate_series(1, $3::int) g where c.slug = $2`, [uid, slug, n]);
await db.query(`update stamps set stamped_at = now() - interval '2 hours'`);   // förbi väntetiden

// 1. Sparad kod + rätt stämpel → inlöst med tapp
const A = "device-AAAA-0001";
const ua = await user(A);
await give(ua, "miyabi", 5);                                   // 6 av 6
await db.query(`update stamps set stamped_at = now() - interval '2 hours'`);
const saved = await call("save_reward", A, "miyabi");
ok(saved.ok && /^\d{6}$/.test(saved.code), "save_reward ger kod");
eq(await call("redeem_by_tap", A, "miyabi", "bryggan-01"), { ok: false, error: "wrong_tag", expected: "Miyabi", got: "Bryggans Bageri" }, "fel butiks stämpel");
eq(await call("redeem_by_tap", A, "miyabi", "okand-99"), { ok: false, error: "unknown_tag", expected: "Miyabi" }, "okänd stämpel");
eq((await one(`select status from redemptions where redeem_code = $1`, [saved.code])).status, "saved", "fel stämpel löser inte in");
eq(await call("redeem_by_tap", A, "miyabi", " MIYABI-01 "), { ok: true, carry_over: 0, stamps: 0 }, "rätt stämpel (skiftläge/mellanslag spelar ingen roll)");
const red = await one(`select status, redeemed_via, carry_over, redeemed_at is not null as at from redemptions where redeem_code = $1`, [saved.code]);
eq(red, { status: "redeemed", redeemed_via: "tap", carry_over: 0, at: true }, "raden inlöst via tapp");
eq(await call("current_saved_code", A, "miyabi"), { ok: true, code: null }, "appens pollning ser att koden är borta");
const again = await call("redeem_by_tap", A, "miyabi", "miyabi-01");
eq(again.ok && again.already, true, "andra tappet inom 2 min = redan inlöst");
const tap = await call("tap_token", A, "miyabi-01");
eq([tap.ok, tap.stamps], [true, 1], "stämpling fungerar direkt efter inlösen");

// 2. Fullt kort utan sparad kod, ett överskott → löses in direkt med överskottet kvar
const B = "device-BBBB-0002";
const ub = await user(B);
await give(ub, "miyabi", 6);                                   // 7 av 6
eq(await call("redeem_by_tap", B, "miyabi", "miyabi-01"), { ok: true, carry_over: 1, stamps: 1 }, "direktinlösen med överskott");
eq((await one(`select count(*)::int n from redemptions r join users u on u.id = r.user_id where u.device_id = $1 and r.status = 'redeemed' and r.redeemed_via = 'tap' and r.redeem_code is null`, [B])).n, 1, "direktinlöst rad utan kod");
eq(await one(`select public.stamps_since_last_redeem($1, (select id from cafes where slug = 'miyabi')) as n`, [ub]), { n: 1 }, "kortet börjar om på överskottet");

// 3. Inte fullt
const C = "device-CCCC-0003";
const uc = await user(C);
await give(uc, "miyabi", 2);
eq(await call("redeem_by_tap", C, "miyabi", "miyabi-01"), { ok: false, error: "not_complete", stamps: 3, needed: 6 }, "ej fullt kort");

// 4. Personalen löste in med koden — tappet strax efter räknas som redan inlöst
const D = "device-DDDD-0004";
const ud = await user(D);
await give(ud, "miyabi", 5);
const sd = await call("save_reward", D, "miyabi");
const rc = await call("merchant_redeem_by_code", "tok-miyabi", sd.code);
eq(rc.ok, true, "koden fungerar som förut");
eq((await one(`select redeemed_via from redemptions where redeem_code = $1`, [sd.code])).redeemed_via, null, "kod-inlösen lämnar redeemed_via tom (= kod)");
const late = await call("redeem_by_tap", D, "miyabi", "miyabi-01");
eq([late.ok, late.already], [true, true], "tapp efter kodinlösen = redan inlöst");
await db.query(`update redemptions set redeemed_at = now() - interval '5 minutes' where redeem_code = $1`, [sd.code]);
eq((await call("redeem_by_tap", D, "miyabi", "miyabi-01")).error, "not_complete", "efter 2 min: inte fullt");

// 5. Felaktiga anrop
eq(await call("redeem_by_tap", "kort", "miyabi", "miyabi-01"), { ok: false, error: "bad_device" }, "för kort enhets-id");
eq(await call("redeem_by_tap", "device-OKAND-999", "miyabi", "miyabi-01"), { ok: false, error: "not_found" }, "okänd enhet");
eq(await call("redeem_by_tap", A, "finns-inte", "miyabi-01"), { ok: false, error: "not_found" }, "okänd butik");
await db.query(`update cafes set active = false where slug = 'bryggan'`);
eq(await call("redeem_by_tap", A, "bryggan", "bryggan-01"), { ok: false, error: "not_found" }, "inaktiv butik");
await db.query(`update cafes set active = true where slug = 'bryggan'`);
eq((await call("redeem_by_tap", A, "miyabi", null)).error, "unknown_tag", "token saknas");

// 6. Sparad belöning blockerar fortfarande stämpling, och inlösen med tapp häver blocket
const E = "device-EEEE-0005";
const ue = await user(E);
await give(ue, "miyabi", 5);
await call("save_reward", E, "miyabi");
await db.query(`update stamps set stamped_at = now() - interval '2 hours'`);
eq((await call("tap_token", E, "miyabi-01")).error, "pending_reward", "sparad belöning blockerar");
eq((await call("redeem_by_tap", E, "miyabi", "miyabi-01")).ok, true, "inlöst med tapp");
eq((await call("tap_token", E, "miyabi-01")).ok, true, "blocket hävt");

// 7. Panelens lista
const recent = await call("merchant_recent_redemptions", "tok-miyabi");
eq(recent.ok, true, "lista ok");
eq(recent.recent.length, 4, "fyra inlösta senaste dygnet (A, B, D, E — inte C)");
eq(recent.recent.map((r) => r.via).sort(), ["code", "tap", "tap", "tap"].sort(), "sätt: 3 tapp, 1 kod");
ok(recent.recent.every((r) => /^Kund #[0-9a-f]{4}$/.test(r.customer_label)), "kundetikett som i väntande-listan");
ok(recent.recent[0].redeemed_at >= recent.recent[recent.recent.length - 1].redeemed_at, "nyast först");
eq((await call("merchant_recent_redemptions", "tok-bryggan")).recent, [], "andra butiker ser inget");
eq(await call("merchant_recent_redemptions", "fel"), { ok: false, error: "bad_session" }, "fel session");

// 8. Behörigheter
for (const fn of ["redeem_by_tap(text, text, text)", "merchant_recent_redemptions(text)"]) {
  const r = await one(`select has_function_privilege('anon', 'public.${fn}', 'execute') as a`);
  eq(r.a, true, "anon får köra " + fn);
}
eq((await one(`select pg_get_constraintdef(oid) d from pg_constraint where conname = 'redemptions_redeemed_via_check'`)).d.includes("tap"), true, "villkoret finns");
let bad = null;
try { await db.query(`update redemptions set redeemed_via = 'push' where true`); } catch (e) { bad = e.message; }
ok(bad && /redeemed_via/.test(bad), "ogiltigt sätt avvisas");

console.log("v9 OK:", passed, "kontroller");
