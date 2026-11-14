// v18: kedjekort och huvudkonto.
// Del A: vanliga ställen – samma data och samma anrop före och efter v18 ger samma svar.
// Del B: en kedja med tre ställen (ett med eget kort): stämpling, inlösen överallt, siffror per
//        ställe, huvudkontot, visning, administration. Del C: behörigheter, fingeravtryck, vakt.
import { build } from "./chain.mjs";
import fs from "node:fs";
import assert from "node:assert/strict";

let passed = 0;
const fail = (e) => { console.error("FEL:", e.message, e.position ? "(pos " + e.position + ")" : ""); process.exit(1); };
process.on("unhandledRejection", fail); process.on("uncaughtException", fail);
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); passed++; };
const ok = (c, msg) => { assert.ok(c, msg); passed++; };
const V18 = fs.readFileSync((process.env.TAPPASS_REPO || "/home/claude/tappass") + "/supabase_migration_v18_kedjor.sql", "utf8");
const changed = JSON.parse(fs.readFileSync(new URL("./changed.json", import.meta.url), "utf8"));
const call = async (db, fn, ...args) =>
  (await db.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args)).rows[0].r;
const one = async (db, sql, args = []) => (await db.query(sql, args)).rows[0];
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const DEV = (n) => `device-U${n}-0000000`;

const SEED = `
  insert into auth.users(id, email) values ('${U(902)}', 'a@x.se'), ('${U(903)}', 'b@x.se');
  insert into cafes(slug, name, type, area, stamps_needed, reward_text, reward_short, city, reward_value_kr, reward_tiers, birthday_text) values
    ('miyabi', 'Miyabi', 'Sushi-restaurang', 'Lidingö', 6, 'En 5-bitars sushi på huset', 'Gratis 5-bitars sushi', 'Stockholm', 79,
     '[{"at":3,"text":"Misosoppa","value_kr":25}]', 'En glass'),
    ('linnea', 'Café Linnea', 'Kafé', 'Vasastan', 10, 'En kaffe på huset', 'Gratis kaffe', 'Stockholm', null, '[]', null);
  insert into tags(cafe_id, token) select id, slug || '-01' from cafes;
  insert into merchant_sessions(token_hash, cafe_id, expires_at)
    select encode(sha256(convert_to('tok-' || slug, 'UTF8')), 'hex'), id, now() + interval '30 days' from cafes;
  insert into users(id, device_id, created_at)
    select ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'device-U' || g || '-0000000', now() - interval '400 days'
      from generate_series(1, 9) g;
  insert into stamps(user_id, cafe_id, stamped_at, source)
    select u.id, c.id, now() - make_interval(days => 1 + (k * (3 + u.n) + u.n) % 200, hours => (k * 5 + u.n) % 10),
           case when k % 11 = 0 then 'quiet' when k % 13 = 0 then 'bonus' else 'tap' end
      from (select id, row_number() over (order by device_id)::int as n from users where device_id <> 'device-U9-0000000') u
     cross join cafes c cross join generate_series(1, 14) k
     where (u.n + k + length(c.slug)) % 3 <> 0;
  -- U7: stamgäst hos Miyabi som slutat komma (vinn tillbaka)
  insert into stamps(user_id, cafe_id, stamped_at, source)
    select '${U(7)}'::uuid, c.id, now() - make_interval(days => d), 'tap' from cafes c, unnest(array[120, 110, 100, 90, 80]) d where c.slug = 'miyabi';
  insert into redemptions(user_id, cafe_id, saved_at, redeemed_at, status, redeem_code, carry_over, redeemed_via, tier_at, reward_name, value_kr)
    select '${U(1)}'::uuid, id, now() - interval '20 days', now() - interval '20 days', 'redeemed', null, 1, 'tap', null, 'En 5-bitars sushi på huset', 79 from cafes where slug = 'miyabi'
    union all select '${U(2)}'::uuid, id, now() - interval '5 days', now() - interval '5 days', 'redeemed', null, 0, null, 3, 'Misosoppa', 25 from cafes where slug = 'miyabi'
    union all select '${U(3)}'::uuid, id, now() - interval '2 hours', now() - interval '1 hour', 'redeemed', null, 0, null, null, null, null from cafes where slug = 'linnea'
    union all select '${U(4)}'::uuid, id, now() - interval '3 days', null, 'saved', '345678', 0, null, null, 'En kaffe på huset', null from cafes where slug = 'linnea';
  insert into stamp_bonuses(user_id, cafe_id, created_at, expires_at, used_at, origin)
    select '${U(5)}'::uuid, id, now() - interval '1 day', now() + interval '2 days', null::timestamptz, 'wheel' from cafes where slug = 'miyabi'
    union all select '${U(6)}'::uuid, id, now() - interval '70 days', now() - interval '56 days', null, 'winback' from cafes where slug = 'linnea';
  insert into stamp_bonuses(user_id, cafe_id, created_at, expires_at, used_at, used_stamp_id, origin)
    select s.user_id, s.cafe_id, s.stamped_at - interval '1 day', s.stamped_at + interval '2 days', s.stamped_at, s.id, 'wheel'
      from stamps s join cafes c on c.id = s.cafe_id where c.slug = 'linnea' and s.user_id = '${U(2)}' and s.source = 'tap'
     order by s.stamped_at desc limit 1;
  insert into accounts(auth_uid, user_id, birth_month, birth_day, birthday_set_at)
    values ('${U(902)}', '${U(2)}', extract(month from now() at time zone 'Europe/Stockholm')::int, extract(day from now() at time zone 'Europe/Stockholm')::int, now() - interval '60 days'),
           ('${U(903)}', '${U(3)}', extract(month from now() at time zone 'Europe/Stockholm')::int, extract(day from now() at time zone 'Europe/Stockholm')::int, now() - interval '60 days');
  insert into birthday_gifts(user_id, cafe_id, gift_year, code, status, reward_text, valid_until, created_at, redeemed_at, redeemed_via)
    select '${U(1)}'::uuid, id, 2025, '012345', 'redeemed', 'En glass', now() - interval '300 days', now() - interval '310 days', now() - interval '305 days', 'code' from cafes where slug = 'miyabi';
  insert into invite_codes(user_id, code) values ('${U(1)}', 'ABCDEF');
  insert into invites(inviter_id, friend_id, code, status, created_at, window_until, cafe_id, rewarded_at, friend_stamps, inviter_stamps)
    select '${U(1)}'::uuid, '${U(8)}', 'ABCDEF', 'rewarded', now() - interval '10 days', now() - interval '3 days', id, now() - interval '9 days', 2, 2 from cafes where slug = 'linnea';
`;

// ---------- normalisering för jämförelsen före/efter ----------
const NEW_KEYS = new Set(["is_chain", "chain_id", "own_card"]);
function norm(x, inRecent = false) {
  if (Array.isArray(x)) return x.map((v) => norm(v, inRecent));
  if (x && typeof x === "object") {
    const o = {};
    for (const [k, v] of Object.entries(x)) {
      if (NEW_KEYS.has(k)) continue;
      if (inRecent && k === "place") continue;
      if (k === "code" || k === "id" || k === "spin_id" || k === "retry_after_seconds") { o[k] = v === null ? null : "<x>"; continue; }
      o[k] = norm(v, inRecent || k === "recent");
    }
    return o;
  }
  if (typeof x === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(x)) return "<ts>";
  return x;
}

// ==================== Del A: vanliga ställen oförändrade ====================
const dbA = await build(["./testsetup.sql"]);
const dbB = await build(["./testsetup.sql"]);
await dbA.exec(SEED);
await dbB.exec(SEED);
const before = await dbB.query(`select p.proname, md5(p.prosrc) h from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`);
await dbB.exec(V18);
await dbB.exec(V18);   // kan köras två gånger
eq((await one(dbB, `select count(*)::int n from stamps where place_id <> cafe_id`)).n, 0, "befintliga stämplar: platsen = stället");

const prevMonth = (await one(dbA, `select to_char(date_trunc('month', now() at time zone 'Europe/Stockholm') - interval '1 month', 'YYYY-MM') m`)).m;
const READS = [];
for (const t of ["tok-miyabi", "tok-linnea"]) {
  for (const fn of ["merchant_stats", "merchant_daily", "merchant_campaign_stats", "merchant_get_quiet_hours", "merchant_pending_list",
    "merchant_recent_redemptions", "merchant_get_reward_tiers", "merchant_guest_levels", "merchant_insights", "merchant_lapsed",
    "merchant_get_birthday", "merchant_invite_stats", "merchant_get_profile"]) READS.push([fn, t]);
  READS.push(["merchant_month_report", t, null], ["merchant_month_report", t, prevMonth]);
}
for (let n = 1; n <= 9; n++) READS.push(["load_wallet", DEV(n)]);
READS.push(["wheel_status", DEV(1)], ["tag_public_info", "miyabi-01"], ["tag_public_info", "okand-01"],
  ["current_saved_code", DEV(4), "linnea"], ["birthday_status", DEV(2)], ["invite_status", DEV(1)]);
async function compareReads(label) {
  for (const [fn, ...args] of READS) {
    const a = await call(dbA, fn, ...args), b = await call(dbB, fn, ...args);
    eq(norm(b), norm(a), `${label}: ${fn}(${args.join(", ")})`);
  }
}
await compareReads("före");

// Samma anrop i båda – samma svar
const both = async (label, fn, ...args) => {
  const a = await call(dbA, fn, ...args), b = await call(dbB, fn, ...args);
  eq(norm(b), norm(a), `anrop: ${label}`);
  return [a, b];
};
await both("tapp", "tap_token", DEV(1), "miyabi-01");
await both("väntetid", "tap_token", DEV(1), "miyabi-01");
await both("ny kund", "tap_token", "device-NY1-000000", "linnea-01");
await both("okänd tagg", "tap_token", DEV(2), "nope-01");
const fullUser = DEV(6);
for (const db of [dbA, dbB]) await db.query(`update stamps set stamped_at = stamped_at - interval '2 hours' where user_id = $1`, [U(6)]);
const w6 = (await call(dbA, "load_wallet", fullUser)).find((c) => c.cafe.slug === "miyabi");
ok(w6.stamps >= 6, "U6 har fullt kort hos Miyabi (" + w6.stamps + ")");
const [sa, sb] = await both("spara belöning", "save_reward", fullUser, "miyabi", null);
await both("koden", "current_saved_code", fullUser, "miyabi");
const ra = await call(dbA, "merchant_redeem_by_code", "tok-miyabi", sa.code), rb = await call(dbB, "merchant_redeem_by_code", "tok-miyabi", sb.code);
eq(norm(rb), norm(ra), "anrop: lös in koden");
await both("koden borta", "current_saved_code", fullUser, "miyabi");
await both("fel butiks kod", "merchant_redeem_by_code", "tok-linnea", "345679");
for (const db of [dbA, dbB]) await db.query(`update stamps set stamped_at = stamped_at - interval '2 hours' where user_id = $1`, [U(5)]);
await both("tapp med hjulbonus", "tap_token", DEV(5), "miyabi-01");
await both("inlösen med tapp, fel tagg", "redeem_by_tap", DEV(5), "miyabi", "linnea-01");
await both("inlösen med tapp", "redeem_by_tap", DEV(5), "miyabi", "miyabi-01");
await both("vinn tillbaka", "merchant_winback", "tok-miyabi");
await both("vinn tillbaka igen", "merchant_winback", "tok-miyabi");
await both("nivåer", "merchant_set_reward_tiers", "tok-linnea", [{ at: 5, text: "Kaka", value_kr: 30 }], 45);
await both("present", "merchant_set_birthday", "tok-linnea", "En kaka", 30);
await both("profil", "merchant_set_profile", "tok-miyabi", { type: "Sushi", area: "Lidingö C", reward_text: "En 5-bitars sushi på huset", reward_short: "Gratis 5-bitars sushi", ink_color: "#1B5A66", address: "Stockholmsvägen 1", description: "Sushi", website: "https://miyabi.se", instagram: "miyabi", opening_hours: [] });
await both("lugna timmar", "merchant_set_quiet_hours", "tok-linnea", [{ days: [1, 2, 3, 4, 5, 6, 7], from: "00:00", to: "24:00" }]);
for (const db of [dbA, dbB]) await db.query(`update stamps set stamped_at = stamped_at - interval '2 hours' where user_id = $1`, [U(3)]);
await both("lugn timme", "tap_token", DEV(3), "linnea-01");
await both("födelsedag: läget", "birthday_status", DEV(2));
const [ga, gb] = await both("födelsedag: hämta", "birthday_claim", DEV(2), "miyabi");
eq(norm(await call(dbB, "merchant_redeem_by_code", "tok-miyabi", gb.code)), norm(await call(dbA, "merchant_redeem_by_code", "tok-miyabi", ga.code)), "anrop: presentkoden");
await both("födelsedag: tapp", "redeem_birthday_by_tap", DEV(3), "miyabi", "miyabi-01");
const [ia, ib] = await both("inbjudan: kod", "invite_code", DEV(4));
eq(norm(await call(dbB, "invite_redeem", "device-NY2-000000", ib.code)), norm(await call(dbA, "invite_redeem", "device-NY2-000000", ia.code)), "anrop: ange koden");
await both("inbjudan: första stämpeln", "tap_token", "device-NY2-000000", "miyabi-01");
await both("inbjudan: läget", "invite_status", DEV(4));
READS.push(["load_wallet", "device-NY1-000000"], ["load_wallet", "device-NY2-000000"], ["current_saved_code", fullUser, "miyabi"]);
await compareReads("efter");
console.log(`Del A: ${passed} kontroller`);
const partA = passed;

// ==================== Del B: kedjan ====================
const db = dbB;
const q = (sql, args) => db.query(sql, args);
const c = (fn, ...args) => call(db, fn, ...args);
const v1 = async (sql, args) => (await one(db, sql, args));
await q(`select public.admin_chain_create('kaffekedjan', 'Kaffekedjan', 'Stockholm', 'Kafé', 'En kaffe på huset', 'Gratis kaffe', 5, '#6B3A1F', 'coffee')`);
await q(`insert into cafes(slug, name, type, area, city, symbol, stamps_needed, reward_text, reward_short, stamp_cooldown_seconds, quiet_hours) values
  ('kk-soder', 'Kaffekedjan Södermalm', 'Kafé', 'Södermalm', 'Stockholm', 'coffee', 9, 'Gammal text', 'Gammal', 600, '[]'),
  ('kk-vasa', 'Kaffekedjan Vasastan', 'Kafé', 'Vasastan', 'Stockholm', 'coffee', 9, 'Gammal text', 'Gammal', 60, '[{"days":[1,2,3,4,5,6,7],"from":"00:00","to":"24:00"}]'),
  ('kk-eget', 'Kaffekedjan Kungsholmen', 'Kafé', 'Kungsholmen', 'Stockholm', 'coffee', 4, 'En bulle på huset', 'Gratis bulle', 60, '[]')`);
for (const s of ["kk-soder", "kk-vasa", "kk-eget"]) eq((await c("admin_chain_add_store", s, "kaffekedjan")).ok, true, "lägg till " + s);
eq((await c("admin_chain_add_store", "kk-soder", "kaffekedjan")).already, true, "redan med");
eq((await c("admin_chain_own_card", "kk-eget", true)).own_card, true, "eget kort");
let err = "";
try { await c("admin_chain_add_store", "miyabi", "linnea"); } catch (e) { err = e.message; }
ok(/ingen kedja/.test(err), "bara kedjor tar emot ställen: " + err);
err = "";
try { await c("admin_chain_add_store", "kaffekedjan", "kaffekedjan"); } catch (e) { err = e.message; }
ok(/annan kedja|kan inte/.test(err), "kedja i kedja: " + err);
const pinHq = await c("admin_issue_pin", "kaffekedjan");
eq(pinHq.tag_token, null, "huvudkontot får ingen tagg");
ok(/^[0-9]{6}$/.test(pinHq.pin) && pinHq.login_name === "kaffekedjan", "huvudkontot får inloggning");
for (const s of ["kk-soder", "kk-vasa", "kk-eget"]) eq((await c("admin_issue_pin", s)).tag_token, s + "-01", "tagg för " + s);
await q(`insert into merchant_sessions(token_hash, cafe_id, expires_at)
  select encode(sha256(convert_to('tok-' || slug, 'UTF8')), 'hex'), id, now() + interval '30 days' from cafes where slug like 'k%k%' and slug <> 'kk-x'`);
const ids = Object.fromEntries((await q(`select slug, id from cafes`)).rows.map((r) => [r.slug, r.id]));
const back = (dev, min) => q(`update stamps set stamped_at = stamped_at - make_interval(mins => $2::int) where user_id = (select id from users where device_id = $1)`, [dev, min]);

// Stämpla på flera ställen – ett kort
const C1 = "device-KK1-000000", C2 = "device-KK2-000000", C3 = "device-KK3-000000";
let r = await c("tap_token", C1, "kk-soder-01");
eq([r.ok, r.cafe.slug, r.stamps, r.stamps_added, r.place], [true, "kaffekedjan", 1, 1, { slug: "kk-soder", name: "Kaffekedjan Södermalm", area: "Södermalm" }], "stämpel hos Södermalm räknas på kedjans kort");
r = await c("tap_token", C1, "kk-soder-01");
ok(r.error === "cooldown" && r.retry_after_seconds > 500, "Södermalms väntetid (600 s): " + r.retry_after_seconds);
r = await c("tap_token", C1, "kk-vasa-01");
ok(r.error === "cooldown" && r.retry_after_seconds <= 60, "Vasastans väntetid (60 s) räknas från senaste stämpeln i kedjan: " + r.retry_after_seconds);
await back(C1, 20);
r = await c("tap_token", C1, "kk-vasa-01");
eq([r.ok, r.cafe.slug, r.stamps, r.stamps_added, r.quiet_applied, r.place.slug], [true, "kaffekedjan", 3, 2, true, "kk-vasa"], "Vasastans lugna timmar ger 2");
eq((await q(`select p.slug, s.source, k.slug as card from stamps s join cafes p on p.id = s.place_id join cafes k on k.id = s.cafe_id
             where s.user_id = (select id from users where device_id = $1) order by s.stamped_at, s.source desc`, [C1])).rows,
  [{ slug: "kk-soder", source: "tap", card: "kaffekedjan" }, { slug: "kk-vasa", source: "tap", card: "kaffekedjan" }, { slug: "kk-vasa", source: "quiet", card: "kaffekedjan" }], "platser och kort i stamps");
let wal = await c("load_wallet", C1);
eq(wal.map((w) => [w.cafe.slug, w.stamps]), [["kaffekedjan", 3]], "ett kort i plånboken");
eq(wal[0].stores.map((s) => s.slug), ["kk-soder", "kk-vasa"], "kortets ställen (utan det med eget kort)");
eq(wal[0].cafe.reward_short, "Gratis kaffe", "kedjans belöning på kortet");
await back(C1, 20);
r = await c("tap_token", C1, "kk-eget-01");
eq([r.ok, r.cafe.slug, r.stamps, "place" in r], [true, "kk-eget", 1, false], "eget kort hos Kungsholmen");
wal = await c("load_wallet", C1);
eq(wal.map((w) => [w.cafe.slug, w.stamps]).sort(), [["kaffekedjan", 3], ["kk-eget", 1]], "två kort");
eq(wal.find((w) => w.cafe.slug === "kk-eget").stores, undefined, "eget kort har ingen ställeslista");

// Fullt kort, inlösen på ett annat ställe
await back(C1, 20); await c("tap_token", C1, "kk-soder-01");
await back(C1, 20); r = await c("tap_token", C1, "kk-soder-01");
eq([r.stamps, r.complete], [5, true], "fullt kedjekort");
const code1 = (await c("save_reward", C1, "kaffekedjan", null)).code;
ok(/^[1-9][0-9]{5}$/.test(code1), "kod för kedjekortet");
eq((await c("merchant_redeem_by_code", "tok-kk-eget", code1)).error, "wrong_cafe", "eget kort-stället löser inte in kedjans kort");
eq((await c("merchant_redeem_by_code", "tok-linnea", code1)).error, "wrong_cafe", "annat ställe löser inte in");
r = await c("merchant_redeem_by_code", "tok-kk-vasa", code1);
eq([r.ok, r.reward, r.carry_over], [true, "Gratis kaffe", 0], "Vasastan löser in koden");
eq((await v1(`select p.slug from redemptions r join cafes p on p.id = r.place_id where r.redeem_code = $1`, [code1])).slug, "kk-vasa", "inlöst hos Vasastan");
for (let i = 0; i < 5; i++) { await back(C2, 20); await c("tap_token", C2, "kk-soder-01"); }
eq((await c("redeem_by_tap", C2, "kaffekedjan", "kk-eget-01")).error, "wrong_tag", "eget kort-ställets stämpel löser inte in kedjans kort");
r = await c("redeem_by_tap", C2, "kaffekedjan", "miyabi-01");
eq([r.error, r.expected, r.got], ["wrong_tag", "Kaffekedjan", "Miyabi"], "fel butik");
r = await c("redeem_by_tap", C2, "kaffekedjan", "kk-vasa-01");
eq([r.ok, r.stamps], [true, 0], "stämpeln hos Vasastan löser in kortet från Södermalm");
eq((await v1(`select p.slug, r.redeemed_via from redemptions r join cafes p on p.id = r.place_id
              where r.user_id = (select id from users where device_id = $1)`, [C2])), { slug: "kk-vasa", redeemed_via: "tap" }, "plats och sätt");
for (let i = 0; i < 5; i++) { await back(C3, 20); await c("tap_token", C3, "kk-vasa-01"); }
const code3 = (await c("save_reward", C3, "kaffekedjan", null)).code;
ok(!!code3, "C3 sparar (väntar)");

// Siffror per ställe
const taps = async (slug) => (await v1(`select count(*)::int n from stamps where place_id = $1 and source = 'tap'`, [ids[slug]])).n;
const st = {};
for (const s of ["kaffekedjan", "kk-soder", "kk-vasa", "kk-eget"]) st[s] = await c("merchant_stats", "tok-" + s);
eq(st["kk-soder"].total, await taps("kk-soder"), "Södermalm ser sina stämplar");
eq(st["kk-vasa"].total, await taps("kk-vasa"), "Vasastan ser sina stämplar");
eq(st["kaffekedjan"].total, (await taps("kk-soder")) + (await taps("kk-vasa")) + (await taps("kk-eget")), "huvudkontot ser alla ställen");
eq([st["kk-soder"].redeemed_30d, st["kk-vasa"].redeemed_30d, st["kaffekedjan"].redeemed_30d], [0, 2, 2], "inlösta per ställe");
eq([st["kk-soder"].pending, st["kk-vasa"].pending, st["kaffekedjan"].pending, st["kk-eget"].pending], [1, 1, 1, 0], "väntande gäller kortet");
eq(st["kk-soder"].unique_customers_30d, (await v1(`select count(distinct user_id)::int n from stamps where place_id = $1 and source = 'tap'`, [ids["kk-soder"]])).n, "kunder hos Södermalm");
const daily = await c("merchant_daily", "tok-kk-vasa");
eq(daily.days.reduce((a, d) => a + d.stamps, 0), await taps("kk-vasa"), "dagserie per ställe");
eq((await c("merchant_get_quiet_hours", "tok-kk-vasa")).visits_total, (await v1(`select count(*)::int n from stamps where place_id = $1 and source = 'quiet'`, [ids["kk-vasa"]])).n, "lugna timmar per ställe");
eq((await c("merchant_get_quiet_hours", "tok-kk-soder")).visits_total, 0, "inga lugna timmar hos Södermalm");
const rec = await c("merchant_recent_redemptions", "tok-kk-vasa");
eq(rec.recent.map((x) => x.place), ["Kaffekedjan Vasastan", "Kaffekedjan Vasastan"], "Senast inlösta hos Vasastan");
eq((await c("merchant_recent_redemptions", "tok-kk-soder")).recent, [], "Södermalm har inte löst in något");
eq((await c("merchant_recent_redemptions", "tok-kaffekedjan")).recent.length, 2, "huvudkontot ser alla inlösen");
eq((await c("merchant_pending_list", "tok-kk-soder")).pending.length, 1, "väntande-listan gäller kortet");

// Belöning, present och profil ägs av kedjan
let tiers = await c("merchant_get_reward_tiers", "tok-kk-soder");
eq([tiers.stamps_needed, tiers.reward_text, tiers.managed_by_chain, tiers.chain_name], [5, "En kaffe på huset", true, "Kaffekedjan"], "ställe ser kedjans belöning");
eq((await c("merchant_get_reward_tiers", "tok-kaffekedjan")).managed_by_chain, undefined, "huvudkontot äger belöningen");
eq((await c("merchant_set_reward_tiers", "tok-kk-soder", [{ at: 3, text: "Kaka" }], null)).error, "chain_managed", "ställe ändrar inte belöningen");
eq((await c("merchant_set_reward_tiers", "tok-kaffekedjan", [{ at: 3, text: "Kaka" }], 40)).ok, true, "huvudkontot ändrar belöningen");
eq((await c("merchant_get_reward_tiers", "tok-kk-vasa")).tiers, [{ at: 3, text: "Kaka" }], "ställe ser kedjans nivåer");
eq((await c("merchant_set_reward_tiers", "tok-kk-eget", [{ at: 2, text: "Kaka" }], null)).ok, true, "eget kort: stället ändrar sin belöning");
eq((await c("merchant_set_birthday", "tok-kk-soder", "En kaka", null)).error, "chain_managed", "ställe ändrar inte presenten");
eq((await c("merchant_set_birthday", "tok-kaffekedjan", "En kaka", null)).text, "En kaka", "huvudkontot sätter presenten");
eq((await c("merchant_get_birthday", "tok-kk-soder")).text, "En kaka", "ställe ser kedjans present");
let prof = await c("merchant_get_profile", "tok-kk-soder");
eq([prof.name, prof.reward_short, prof.stamps_needed, prof.managed_by_chain, prof.chain_name], ["Kaffekedjan Södermalm", "Gratis kaffe", 5, true, "Kaffekedjan"], "profil: ställets namn, kedjans belöning");
r = await c("merchant_set_profile", "tok-kk-soder", { area: "Söder", address: "Götgatan 1", reward_text: "Hack", reward_short: "Hack", ink_color: "#000000", type: "Kafé", description: "", website: "", instagram: "", opening_hours: [] });
ok(r.ok !== false, "ställe sparar profilen");
eq(await v1(`select area, address, reward_text, ink_color from cafes where slug = 'kk-soder'`), { area: "Söder", address: "Götgatan 1", reward_text: "Gammal text", ink_color: "#1B6371" }, "belöning och färg rörs inte");
eq((await v1(`select reward_text from cafes where slug = 'kaffekedjan'`)).reward_text, "En kaffe på huset", "kedjans belöning orörd");
eq((await c("tag_public_info", "kk-soder-01")), { ok: true, name: "Kaffekedjan Södermalm", reward_short: "Gratis kaffe", stamps_needed: 5, chain: "Kaffekedjan" }, "tappass.se/t/: ställe + kedjans belöning");
eq((await c("tag_public_info", "kk-eget-01")), { ok: true, name: "Kaffekedjan Kungsholmen", reward_short: "Gratis bulle", stamps_needed: 4 }, "tappass.se/t/: eget kort");

// Födelsedagspresent: kedjans present, inlöst med ett ställes stämpel
await q(`insert into auth.users(id, email) values ('${U(904)}', 'c@x.se')`);
await q(`insert into accounts(auth_uid, user_id, birth_month, birth_day, birthday_set_at)
  select '${U(904)}'::uuid, u.id, extract(month from now() at time zone 'Europe/Stockholm')::int,
         extract(day from now() at time zone 'Europe/Stockholm')::int, now() - interval '60 days' from users u where u.device_id = $1`, [C2]);
const bst = await c("birthday_status", C2);
eq(bst.gifts.map((g) => g.cafe_slug || (g.cafe && g.cafe.slug) || g.slug), ["kaffekedjan"], "presenten gäller kedjan");
eq((await c("redeem_birthday_by_tap", C2, "kaffekedjan", "kk-eget-01")).error, "wrong_tag", "inte med eget kort-ställets stämpel");
r = await c("redeem_birthday_by_tap", C2, "kaffekedjan", "kk-soder-01");
eq([r.ok, r.reward], [true, "En kaka"], "presenten löses in hos Södermalm");
eq([(await c("merchant_get_birthday", "tok-kk-soder")).redeemed_total, (await c("merchant_get_birthday", "tok-kk-vasa")).redeemed_total, (await c("merchant_get_birthday", "tok-kaffekedjan")).redeemed_total], [1, 0, 1], "presenter per ställe");
eq((await c("merchant_recent_redemptions", "tok-kk-soder")).recent.map((x) => [x.reward, x.place]), [["Födelsedagspresent: En kaka", "Kaffekedjan Södermalm"]], "presenten i Senast inlösta");

// Stamgäster, insikter, vinn tillbaka, månadsrapport
const C4 = "device-KK4-000000";
await q(`insert into users(device_id, created_at) values ($1, now() - interval '200 days')`, [C4]);
await q(`insert into stamps(user_id, cafe_id, tag_id, stamped_at, source)
         select u.id, $2, (select id from tags where token = 'kk-soder-01'), now() - make_interval(days => d), 'tap'
           from users u, unnest(array[130, 120, 110, 100]) d where u.device_id = $1`, [C4, ids["kaffekedjan"]]);
eq((await v1(`select count(*)::int n from stamps s join users u on u.id = s.user_id where u.device_id = $1 and s.place_id = $2`, [C4, ids["kk-soder"]])).n, 4, "direktinsatta stämplar får taggens ställe");
const lv = async (t) => (await c("merchant_guest_levels", t)).customers;
eq(await lv("tok-kk-soder"), (await v1(`select count(distinct user_id)::int n from stamps where place_id = $1 and source = 'tap' and stamped_at > now() - interval '365 days'`, [ids["kk-soder"]])).n, "stamgäster per ställe");
ok((await lv("tok-kaffekedjan")) >= (await lv("tok-kk-soder")), "huvudkontot ser minst lika många");
eq((await c("merchant_lapsed", "tok-kk-soder")).count, 1, "Södermalm: en stamgäst har slutat komma");
eq((await c("merchant_lapsed", "tok-kk-vasa")).count, 0, "Vasastan: ingen");
eq((await c("merchant_lapsed", "tok-kk-soder")).customers[0].card_stamps, 4, "kortets stämplar (kedjans kort)");
eq((await c("merchant_winback", "tok-kk-vasa")).sent, 0, "Vasastan skickar inget");
eq((await c("merchant_winback", "tok-kk-soder")).sent, 1, "Södermalm skickar en dubbelstämpel");
eq(await v1(`select k.slug as card, p.slug as place from stamp_bonuses b join cafes k on k.id = b.cafe_id join cafes p on p.id = b.place_id where b.origin = 'winback' and b.place_id = $1`, [ids["kk-soder"]]), { card: "kaffekedjan", place: "kk-soder" }, "bonusen gäller kortet, skickad av Södermalm");
eq((await c("merchant_winback", "tok-kaffekedjan")).sent, 0, "huvudkontot kan inte skicka igen");
eq([(await c("merchant_lapsed", "tok-kk-soder")).sent_60d, (await c("merchant_lapsed", "tok-kk-vasa")).sent_60d, (await c("merchant_lapsed", "tok-kaffekedjan")).sent_60d], [1, 0, 1], "skickade per ställe");
wal = await c("load_wallet", C4);
ok(!!wal[0].bonus_expires_at, "kunden ser dubbelstämpeln på kedjekortet");
r = await c("tap_token", C4, "kk-soder-01");
eq([r.stamps_added, r.bonus_applied], [2, true], "dubbelstämpeln används hos Södermalm");
const ins = await c("merchant_insights", "tok-kk-soder");
eq(ins.ok, true, "insikter för ett ställe");
eq(ins.stamps_90d, (await v1(`select count(*)::int n from stamps where place_id = $1 and source = 'tap' and stamped_at >= now() - interval '89 days' - interval '1 day'`, [ids["kk-soder"]])).n, "stämplingar 90 d per ställe");
ok(!(await c("merchant_insights", "tok-kaffekedjan")).tips.some((t) => t.key === "quiet_day"), "huvudkontot får inget tips om lugna timmar");
const mr = await c("merchant_month_report", "tok-kk-vasa", null);
eq(mr.current.stamps, (await v1(`select count(*)::int n from stamps where place_id = $1 and source = 'tap' and stamped_at >= date_trunc('month', now() at time zone 'Europe/Stockholm') at time zone 'Europe/Stockholm'`, [ids["kk-vasa"]])).n, "månadsrapport per ställe");
eq((await c("merchant_campaign_stats", "tok-kk-soder")).bonus_stamps_total, (await v1(`select count(*)::int n from stamps where place_id = $1 and source = 'bonus'`, [ids["kk-soder"]])).n, "kampanjstämplar per ställe");

// Bjud in en vän: belönas där vännen stämplar
const ic1 = (await c("invite_code", C1)).code;
eq((await c("invite_redeem", "device-KKNY-00000", ic1)).ok, true, "ny kund anger koden");
r = await c("tap_token", "device-KKNY-00000", "kk-soder-01");
eq(r.stamps, 3, "vännen: 1 + 2 i välkomstbonus");
eq((await q(`select p.slug, count(*)::int n from stamps s join cafes p on p.id = s.place_id where s.user_id = (select id from users where device_id = 'device-KKNY-00000') group by 1`)).rows, [{ slug: "kk-soder", n: 3 }], "bonusen placeras hos Södermalm");
eq([(await c("merchant_invite_stats", "tok-kk-soder")).friends_total, (await c("merchant_invite_stats", "tok-kk-vasa")).friends_total, (await c("merchant_invite_stats", "tok-kaffekedjan")).friends_total], [1, 0, 1], "inbjudningar per ställe");

// Hjulet erbjuder kedjan, aldrig ställena
const ws = await c("wheel_status", C1);
eq(ws.cities.find((x) => x.city === "Stockholm").places, 4, "Stockholm: Miyabi, Linnea, Kaffekedjan, Kungsholmen (eget kort)");
let offers = null;
for (let i = 0; i < 60 && !offers; i++) {
  const s = await c("spin_wheel", `device-SPIN${i}-0000`, "Stockholm");
  if (s.won) offers = s.offers.map((o) => o.cafe ? o.cafe.slug : o.slug);
}
ok(offers && !offers.includes("kk-soder") && !offers.includes("kk-vasa"), "hjulets erbjudanden: " + offers);

// Panelen: roll, översikt, visning
let ch = await c("merchant_chain", "tok-kaffekedjan");
eq([ch.role, ch.chain.name, ch.stores.map((s) => s.slug), ch.viewing], ["main", "Kaffekedjan", ["kk-eget", "kk-soder", "kk-vasa"], false], "huvudkontot");
ch = await c("merchant_chain", "tok-kk-soder");
eq([ch.role, ch.place.slug, ch.chain.slug, ch.own_card], ["store", "kk-soder", "kaffekedjan", false], "ställe i kedja");
eq((await c("merchant_chain", "tok-miyabi")), { ok: true, role: "standalone" }, "vanligt ställe");
eq((await c("merchant_chain", "fel")).error, "bad_session", "fel session");
const ov = await c("merchant_chain_overview", "tok-kaffekedjan");
const sod = ov.stores.find((s) => s.slug === "kk-soder");
eq(sod.stamps_30d, (await v1(`select count(*)::int n from stamps where place_id = $1 and source = 'tap' and stamped_at > now() - interval '30 days'`, [ids["kk-soder"]])).n, "översikt: Södermalm 30 d");
eq(ov.stores.find((s) => s.slug === "kk-vasa").redeemed_30d, 2, "översikt: inlösta hos Vasastan");
eq(ov.totals.stamps_30d, ov.stores.reduce((a, s) => a + s.stamps_30d, 0), "översikt: summan");
eq(ov.totals.customers_30d, (await v1(`select count(distinct user_id)::int n from stamps where place_id = any($1) and source = 'tap' and stamped_at > now() - interval '30 days'`, [[ids["kk-soder"], ids["kk-vasa"], ids["kk-eget"]]])).n, "översikt: kunder räknas en gång");
eq((await c("merchant_chain_overview", "tok-kk-soder")).error, "not_main", "bara huvudkontot");
const view = await c("merchant_chain_view", "tok-kaffekedjan", "kk-soder");
ok(view.ok && view.token.length >= 32, "visning av Södermalm");
eq(await c("merchant_stats", view.token), await c("merchant_stats", "tok-kk-soder"), "visningen = Södermalms egen panel");
eq((await c("merchant_chain", view.token)).viewing, true, "visningen vet att den är en visning");
eq((await c("merchant_chain_view", "tok-kaffekedjan", "miyabi")).error, "not_found", "bara kedjans ställen");
eq((await c("merchant_chain_view", "tok-kk-soder", "kk-vasa")).error, "not_main", "ställen kan inte visa varandra");
const view2 = await c("merchant_chain_view", "tok-kaffekedjan", "kk-soder");
eq((await c("merchant_stats", view.token)).error, "bad_session", "en visning per ställe");
await q(`update merchant_sessions set last_used_at = now() - interval '2 hours' where token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')`, [view2.token]);
await c("merchant_stats", view2.token);
ok((await v1(`select expires_at <= now() + interval '12 hours' as k from merchant_sessions where token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')`, [view2.token])).k, "visningen förlängs inte");
await q(`delete from merchant_sessions where token_hash = encode(sha256(convert_to('tok-kaffekedjan', 'UTF8')), 'hex')`);
eq((await c("merchant_stats", view2.token)).error, "bad_session", "visningen försvinner med huvudkontots session");
await q(`insert into merchant_sessions(token_hash, cafe_id, expires_at) values (encode(sha256(convert_to('tok-kaffekedjan', 'UTF8')), 'hex'), $1, now() + interval '30 days')`, [ids["kaffekedjan"]]);

// Administration: flytta ett befintligt ställe in i en kedja
await q(`insert into cafes(slug, name, type, area, city, stamps_needed, reward_text, reward_short) values
  ('solo', 'Solo', 'Kafé', 'Solna', 'Stockholm', 5, 'Kaffe', 'Kaffe'), ('solo2', 'Solo 2', 'Kafé', 'Solna', 'Stockholm', 5, 'Kaffe', 'Kaffe')`);
await q(`insert into tags(cafe_id, token) select id, slug || '-01' from cafes where slug in ('solo', 'solo2')`);
await q(`insert into merchant_sessions(token_hash, cafe_id, expires_at) select encode(sha256(convert_to('tok-' || slug, 'UTF8')), 'hex'), id, now() + interval '30 days' from cafes where slug in ('solo', 'solo2')`);
for (let i = 0; i < 5; i++) { await back("device-S1-0000000", 20); await c("tap_token", "device-S1-0000000", "solo-01"); }
const scode = (await c("save_reward", "device-S1-0000000", "solo", null)).code;
await c("tap_token", "device-S2-0000000", "solo-01");
await c("tap_token", "device-S2-0000000", "solo2-01");
await q(`select public.admin_chain_create('solokedjan', 'Solokedjan', 'Stockholm', 'Kafé', 'Kaffe', 'Kaffe', 5)`);
r = await c("admin_chain_add_store", "solo", "solokedjan");
eq([r.ok, r.moved_stamps], [true, 6], "Solos kort flyttas till kedjan");
wal = await c("load_wallet", "device-S1-0000000");
eq([wal.map((w) => w.cafe.slug), wal[0].stamps, wal[0].pending], [["solokedjan"], 5, true], "kunden har kedjekortet med sin sparade belöning");
eq((await c("current_saved_code", "device-S1-0000000", "solokedjan")).code, scode, "koden finns kvar");
eq((await c("merchant_redeem_by_code", "tok-solo", scode)).ok, true, "och löses in hos Solo");
err = "";
try { await c("admin_chain_add_store", "solo2", "solokedjan"); } catch (e) { err = e.message; }
ok(/1 kund\(er\) har kort både/.test(err), "krock: " + err);
eq((await v1(`select chain_id is null as k, (select count(*)::int from stamps where cafe_id = c.id) n from cafes c where slug = 'solo2'`)), { k: true, n: 1 }, "inget flyttades vid krock");
eq((await c("admin_chain_remove_store", "kk-vasa")).ok, true, "ta bort Vasastan ur kedjan");
r = await c("tap_token", "device-KKV-000000", "kk-vasa-01");
eq([r.cafe.slug, "place" in r], ["kk-vasa", false], "Vasastan har nu egna kort");
eq((await c("load_wallet", C1)).find((w) => w.cafe.slug === "kaffekedjan").stamps, 2, "C1:s kedjekort finns kvar (inlöst + 2 från inbjudan)");
const status = (await q(`select * from public.admin_chain_status()`)).rows;
ok(status.some((s) => s.kedja === "kaffekedjan" && s.stalle === "kk-soder" && s.taggar === "kk-soder-01" && s.inloggning), "admin_chain_status");
console.log(`Del B: ${passed - partA} kontroller`);
const partB = passed;

// ==================== Del C: behörigheter, fingeravtryck, vakt, execute ====================
const priv = async (fn) => (await v1(`select has_function_privilege('anon', $1, 'execute') as k`, [fn])).k;
for (const fn of ["merchant_chain(text)", "merchant_chain_overview(text)", "merchant_chain_view(text, text)", "tag_public_info(text)", "tap_token(text, text)", "merchant_stats(text)", "load_wallet(text)"])
  eq(await priv("public." + fn), true, "öppen: " + fn);
for (const fn of ["card_of(uuid)", "scope_places(uuid)", "scope_cards(uuid)", "stamps_set_place()", "admin_chain_create(text, text, text, text, text, text, integer, text, text)",
  "admin_chain_add_store(text, text)", "admin_chain_own_card(text, boolean)", "admin_chain_remove_store(text)", "admin_chain_status()", "tap_token_core(text, text)",
  "admin_issue_pin(text)", "cafe_visit_days(uuid, date)", "winback_eligible(uuid, uuid)", "cafe_month_stats(uuid, date)"])
  eq(await priv("public." + fn), false, "stängd: " + fn);
const after = Object.fromEntries((await db.query(`select p.proname, md5(p.prosrc) h from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`)).rows.map((x) => [x.proname, x.h]));
for (const { proname, h } of before.rows) {
  if (changed.includes(proname) || proname === "tag_public_info") ok(after[proname] !== h, "ändrad: " + proname);
  else eq(after[proname], h, "orörd: " + proname);
}
const v18md5 = Object.fromEntries([...changed, "tag_public_info", "card_of", "scope_places", "scope_cards", "stamps_set_place", "merchant_chain", "merchant_chain_overview", "merchant_chain_view",
  "admin_chain_create", "admin_chain_add_store", "admin_chain_own_card", "admin_chain_remove_store", "admin_chain_status"].sort().map((f) => [f, after[f]]));
fs.writeFileSync(new URL("./v18-md5.json", import.meta.url), JSON.stringify(v18md5, null, 1));
{
  const g = await build(["./testsetup.sql"]);
  await g.exec(`create or replace function public.merchant_stats(p_token text) returns jsonb language sql as $$ select '{}'::jsonb $$;`);
  let m = "";
  try { await g.exec(V18); } catch (e) { m = e.message; }
  ok(/v18: produktionen har inte v17-läget för merchant_stats/.test(m), "vakt: " + m);
  const h = await build(["./testsetup.sql"]);
  await h.exec(SEED);
  let tag = "run"; while (V18.includes("$" + tag)) tag += "x";
  const inner = "$" + tag + "f$";
  await h.exec("do $" + tag + "$ begin execute " + inner + V18 + inner + "; end $" + tag + "$;");
  eq((await one(h, `select count(*)::int n from information_schema.columns where table_name = 'stamps' and column_name = 'place_id'`)).n, 1, "hela filen går att köra med plpgsql execute");
}
console.log(`Del C: ${passed - partB} kontroller\nalla ${passed} kontroller gick igenom`);
