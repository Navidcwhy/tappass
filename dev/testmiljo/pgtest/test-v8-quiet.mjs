// v8: Lugna timmar — butiken väljer tider då varje stämpling ger 2 stämplar.
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import assert from "node:assert/strict";

const db = new PGlite();
let passed = 0;
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); passed++; };
const call = async (fn, ...args) =>
  (await db.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args)).rows[0].r;
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const V8 = "/home/claude/tappass/supabase_migration_v8_lugna_timmar.sql";

await db.exec(fs.readFileSync(new URL("./base.sql", import.meta.url), "utf8"));
await db.exec(fs.readFileSync("/home/claude/tappass/supabase_migration_v6_dagens_hjul.sql", "utf8"));
await db.exec(fs.readFileSync("/home/claude/tappass/supabase_migration_v7_buggfixar.sql", "utf8"));
await db.exec(`
  insert into cafes(slug, name, type, area, stamps_needed, city, stamp_cooldown_seconds) values
    ('miyabi', 'Miyabi', 'Sushi-restaurang', 'Lidingö', 6, 'Stockholm', 10),
    ('bryggan', 'Bryggans Bageri', 'Bageri', 'Södermalm', 8, 'Stockholm', 10);
  insert into tags(cafe_id, token) select id, slug || '-01' from cafes;
  insert into merchant_sessions(token_hash, cafe_id, expires_at)
    select encode(sha256(convert_to('tok-' || slug, 'UTF8')), 'hex'), id, now() + interval '30 days' from cafes;
`);
// Före v8: vanlig stämpling fungerar (baslinje)
const before = await call("tap_token", "device-BASE-0001", "miyabi-01");
eq([before.ok, before.stamps_added], [true, 1], "baslinje före v8");

await db.exec(fs.readFileSync(V8, "utf8"));
await db.exec(fs.readFileSync(V8, "utf8"));   // kan köras två gånger

// ── quiet_hours_clean ──────────────────────────────────────────────
const clean = async (j) => (await one(`select public.quiet_hours_clean($1::jsonb) as r`, [JSON.stringify(j)])).r;
eq(await clean([{ days: [5, 1, 3, 1], from: "14:00", to: "16:00" }]), [{ days: [1, 3, 5], from: "14:00", to: "16:00" }], "dagar sorteras, dubbletter bort");
eq(await clean([]), [], "tom lista = inga lugna timmar");
eq(await clean([{ days: [6, 7], from: "20:00", to: "24:00" }]), [{ days: [6, 7], from: "20:00", to: "24:00" }], "till midnatt");
for (const [bad, why] of [
  [{}, "inte en lista"],
  [Array(8).fill({ days: [1], from: "10:00", to: "11:00" }), "fler än 7"],
  [[{ days: [], from: "10:00", to: "11:00" }], "inga dagar"],
  [[{ days: [0], from: "10:00", to: "11:00" }], "dag 0"],
  [[{ days: [8], from: "10:00", to: "11:00" }], "dag 8"],
  [[{ days: ["1"], from: "10:00", to: "11:00" }], "dag som text"],
  [[{ days: [1.5], from: "10:00", to: "11:00" }], "halv dag"],
  [[{ days: [1], from: "16:00", to: "14:00" }], "slut före start"],
  [[{ days: [1], from: "14:00", to: "14:00" }], "noll minuter"],
  [[{ days: [1], from: "9:00", to: "11:00" }], "fel format"],
  [[{ days: [1], from: "10:00" }], "saknar slut"],
  [[{ days: [1], from: "24:00", to: "24:00" }], "start 24:00"],
  [["x"], "inte ett objekt"],
]) eq(await clean(bad), null, "ogiltig: " + why);

// ── quiet_hours_active (svensk tid, även sommartid) ────────────────
const H = JSON.stringify([{ days: [1, 2, 3, 4, 5], from: "14:00", to: "16:00" }]);
const act = async (at) => (await one(`select public.quiet_hours_active($1::jsonb, $2::timestamptz) as r`, [H, at])).r;
eq(await act("2026-11-16 13:30+00"), true, "måndag 14.30 vintertid");
eq(await act("2026-11-16 12:59+00"), false, "måndag 13.59");
eq(await act("2026-11-16 15:00+00"), false, "måndag 16.00 (slutet räknas inte)");
eq(await act("2026-11-14 13:30+00"), false, "lördag");
eq(await act("2026-06-15 12:30+00"), true, "måndag 14.30 sommartid (UTC+2)");
eq(await act("2026-06-15 13:30+00"), true, "måndag 15.30 sommartid");
eq(await act("2026-06-15 14:00+00"), false, "måndag 16.00 sommartid");
eq((await one(`select public.quiet_hours_active('[]'::jsonb, now()) as r`)).r, false, "inga perioder");

// ── tap_token ───────────────────────────────────────────────────────
const ALWAYS = JSON.stringify([{ days: [1, 2, 3, 4, 5, 6, 7], from: "00:00", to: "24:00" }]);
await db.query(`update cafes set quiet_hours = $1::jsonb where slug = 'miyabi'`, [ALWAYS]);
let r = await call("tap_token", "device-QUIET-0001", "miyabi-01");
eq([r.ok, r.stamps_added, r.quiet_applied, r.bonus_applied, r.stamps], [true, 2, true, false, 2], "lugn timme: 2 stämplar");
eq(r.cafe.quiet_hours, JSON.parse(ALWAYS), "appen får butikens tider i svaret");
eq((await one(`select array_agg(source order by source) as s from stamps s join users u on u.id = s.user_id where u.device_id = 'device-QUIET-0001'`)).s, ["quiet", "tap"], "källor tap + quiet");
r = await call("tap_token", "device-QUIET-0001", "miyabi-01");
eq(r.error, "cooldown", "väntetiden gäller som vanligt");

// Hjulets bonus sparas under en lugn timme
await db.exec(`
  insert into users(device_id) values ('device-BONUS-0001');
  insert into wheel_spins(user_id, spin_date, segment, won, offers, claimed_cafe_id, claimed_at)
    select u.id, public.sthlm_today(), 0, true, array[c.id], c.id, now() from users u, cafes c
     where u.device_id = 'device-BONUS-0001' and c.slug = 'miyabi';
  insert into stamp_bonuses(user_id, cafe_id, spin_id, expires_at)
    select w.user_id, w.claimed_cafe_id, w.id, public.sthlm_midnight(w.spin_date + 3) from wheel_spins w;
`);
r = await call("tap_token", "device-BONUS-0001", "miyabi-01");
eq([r.stamps_added, r.quiet_applied, r.bonus_applied], [2, true, false], "lugn timme + bonus = 2, inte 3");
eq((await one(`select used_at is null as unused from stamp_bonuses`)).unused, true, "bonusen finns kvar");
const wallet = await call("load_wallet", "device-BONUS-0001");
eq(wallet[0].bonus_expires_at !== null, true, "bonusen syns fortfarande i plånboken");
eq(wallet[0].cafe.quiet_hours, JSON.parse(ALWAYS), "plånboken har butikens tider");

// Utanför lugna timmar används bonusen
await db.exec(`update cafes set quiet_hours = '[]' where slug = 'miyabi'; update stamps set stamped_at = stamped_at - interval '1 hour';`);
r = await call("tap_token", "device-BONUS-0001", "miyabi-01");
eq([r.stamps_added, r.quiet_applied, r.bonus_applied, r.stamps], [2, false, true, 4], "utanför: hjulets bonus som förut");
eq((await one(`select used_at is not null as used from stamp_bonuses`)).used, true, "bonusen använd");

// Trasig inställning stoppar aldrig en stämpling
await db.exec(`update cafes set quiet_hours = '[{"days":[1,2,3,4,5,6,7],"from":"xx","to":"yy"}]' where slug = 'bryggan'`);
r = await call("tap_token", "device-BROKEN-0001", "bryggan-01");
eq([r.ok, r.stamps_added, r.quiet_applied], [true, 1, false], "trasig inställning → vanlig stämpel");

// ── Butikspanelen ───────────────────────────────────────────────────
eq((await call("merchant_set_quiet_hours", "fel-token", "[]")).error, "bad_session", "fel session");
eq((await call("merchant_get_quiet_hours", "fel-token")).error, "bad_session", "fel session (läs)");
eq((await call("merchant_set_quiet_hours", "tok-bryggan", JSON.stringify([{ days: [1], from: "16:00", to: "14:00" }]))).error, "invalid_quiet_hours", "ogiltig sparas inte");
const set = await call("merchant_set_quiet_hours", "tok-bryggan", JSON.stringify([{ days: [3, 1, 2], from: "14:00", to: "16:00" }]));
eq([set.ok, set.quiet_hours], [true, [{ days: [1, 2, 3], from: "14:00", to: "16:00" }]], "sparas rensad");
eq((await one(`select quiet_hours from cafes where slug = 'bryggan'`)).quiet_hours, [{ days: [1, 2, 3], from: "14:00", to: "16:00" }], "i tabellen");
const miyabiStats = await call("merchant_get_quiet_hours", "tok-miyabi");
eq([miyabiStats.ok, miyabiStats.visits_30d, miyabiStats.visits_total, miyabiStats.quiet_hours], [true, 2, 2, []], "två besök under lugna timmar");
const ms = await call("merchant_stats", "tok-miyabi");
eq(ms.total, 4, "besöksstatistiken räknar bara riktiga tryck (4 tap)");
eq((await call("merchant_set_quiet_hours", "tok-bryggan", "[]")).quiet_hours, [], "kan stängas av");

// ── Behörigheter ────────────────────────────────────────────────────
const priv = (await one(`select has_function_privilege('anon', 'public.quiet_hours_clean(jsonb)', 'execute') as c,
  has_function_privilege('anon', 'public.quiet_hours_active(jsonb, timestamptz)', 'execute') as a,
  has_function_privilege('anon', 'public.merchant_set_quiet_hours(text, jsonb)', 'execute') as s`));
eq([priv.c, priv.a, priv.s], [false, false, true], "hjälpfunktioner stängda, panelens öppna");
// Gamla källor tillåts, okända inte
let rejected = false;
try { await db.exec(`insert into stamps(user_id, cafe_id, tag_id, source) select u.id, c.id, t.id, 'hack' from users u, cafes c join tags t on t.cafe_id = c.id limit 1`); } catch { rejected = true; }
eq(rejected, true, "okänd källa avvisas");

console.log("v8 OK:", passed, "kontroller");
