// Bygger supabase_migration_v18_kedjor.sql: produktionens funktioner (orig/, = v17-läget) + exakta ändringar.
// Varje ändring måste träffa exakt det antal gånger som anges, annars avbryts bygget.
import { readFileSync, writeFileSync } from "node:fs";
import { build } from "./chain.mjs";
const O = (f) => readFileSync(new URL(`./orig/${f}.sql`, import.meta.url), "utf8").trim();

const PL = "  v_places uuid[] := public.scope_places(v_cafe_id);\n";
const patches = {
  tap_token_core: [
    ["  v_cafe       cafes%rowtype;\n", "  v_cafe       cafes%rowtype;\n  v_place      cafes%rowtype;\n"],
    [`    return jsonb_build_object('ok', false, 'error', 'inactive_cafe');
  end if;
`, `    return jsonb_build_object('ok', false, 'error', 'inactive_cafe');
  end if;
  -- Kedjor (v18): taggen hör till ett ställe; stämpeln räknas på kedjans kort (eller ställets
  -- eget kort). Väntetiden och lugna timmar är ställets egna. Stämplarna får platsen via
  -- triggern stamps_place (taggen, annars tappass.place).
  v_place := v_cafe;
  if v_place.chain_id is not null and not v_place.own_card then
    select * into v_cafe from cafes where id = v_place.chain_id and active = true;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'inactive_cafe');
    end if;
  end if;
  perform set_config('tappass.place', v_place.id::text, true);
`],
    ["v_cafe.stamp_cooldown_seconds", "v_place.stamp_cooldown_seconds", 2],
    ["public.quiet_hours_active(v_cafe.quiet_hours, now())", "public.quiet_hours_active(v_place.quiet_hours, now())"],
    [`    'carry_over', greatest(0, v_count - v_cafe.stamps_needed));`,
     `    'carry_over', greatest(0, v_count - v_cafe.stamps_needed))
    || case when v_place.id <> v_cafe.id
            then jsonb_build_object('place', jsonb_build_object('slug', v_place.slug, 'name', v_place.name, 'area', v_place.area))
            else '{}'::jsonb end;`],
  ],
  redeem_by_tap: [
    ["  if v_tag.cafe_id <> v_cafe.id then", "  if public.card_of(v_tag.cafe_id) is distinct from v_cafe.id then  -- v18: alla ställen i kedjan"],
    ["carry_over = v_carry, redeemed_via = 'tap',\n", "carry_over = v_carry, redeemed_via = 'tap', place_id = v_tag.cafe_id,\n"],
    ["redeemed_at, carry_over, redeemed_via, reward_name, value_kr)", "redeemed_at, carry_over, redeemed_via, reward_name, value_kr, place_id)"],
    ["public.reward_label(v_cafe.id, null), public.reward_value(v_cafe.id, null));", "public.reward_label(v_cafe.id, null), public.reward_value(v_cafe.id, null), v_tag.cafe_id);"],
  ],
  redeem_birthday_by_tap: [
    ["  if v_tag.cafe_id <> v_cafe.id then", "  if public.card_of(v_tag.cafe_id) is distinct from v_cafe.id then  -- v18: alla ställen i kedjan"],
    ["redeemed_via = 'tap' where id = v_gift.id;", "redeemed_via = 'tap', place_id = v_tag.cafe_id where id = v_gift.id;"],
    ["valid_until, redeemed_at, redeemed_via)", "valid_until, redeemed_at, redeemed_via, place_id)"],
    ["public.sthlm_midnight(v_b + 7), now(), 'tap')", "public.sthlm_midnight(v_b + 7), now(), 'tap', v_tag.cafe_id)"],
    ["      set status = 'redeemed', redeemed_at = now(), redeemed_via = 'tap'\n", "      set status = 'redeemed', redeemed_at = now(), redeemed_via = 'tap', place_id = excluded.place_id\n"],
  ],
  load_wallet: [
    ["    ) as card\n", `    ) || case when c.is_chain then jsonb_build_object('stores', (   -- v18: kedjans ställen
           select coalesce(jsonb_agg(jsonb_build_object('slug', x.slug, 'name', x.name, 'area', x.area,
                    'address', x.address, 'opening_hours', x.opening_hours, 'website', x.website,
                    'logo_version', x.logo_version) order by x.name), '[]'::jsonb)
             from cafes x where x.chain_id = c.id and not x.own_card and x.active))
         else '{}'::jsonb end as card
`],
  ],
  wheel_status: [
    ["where c.active and c.wheel_enabled and nullif(btrim(c.city), '') is not null",
     "where c.active and c.wheel_enabled and (c.chain_id is null or c.own_card) and nullif(btrim(c.city), '') is not null"],
  ],
  spin_wheel: [
    ["   where c.active and c.wheel_enabled\n     and lower(", "   where c.active and c.wheel_enabled and (c.chain_id is null or c.own_card)\n     and lower("],
    ["                where c.active and c.wheel_enabled\n                  and lower(", "                where c.active and c.wheel_enabled and (c.chain_id is null or c.own_card)\n                  and lower("],
  ],
  invite_on_stamp: [
    ["    perform public.invite_grant(v_inv.id, new.cafe_id);\n",
     "    perform public.invite_grant(v_inv.id, new.cafe_id);\n    update invites set place_id = new.place_id where id = v_inv.id and status = 'rewarded';  -- v18\n"],
  ],
  merchant_session_cafe: [
    ["update merchant_sessions set last_used_at = now(), expires_at = now() + interval '30 days'",
     "update merchant_sessions set last_used_at = now(),\n           expires_at = case when via_session is null then now() + interval '30 days' else expires_at end  -- v18: huvudkontots visning förlängs inte"],
  ],
  merchant_stats: [
    ["  v_today   date;\n", "  v_today   date;\n" + PL + "  v_cards  uuid[] := public.scope_cards(v_cafe_id);\n"],
    ["from stamps where cafe_id = v_cafe_id and source = 'tap'", "from stamps where place_id = any(v_places) and source = 'tap'", 4],
    ["                              where cafe_id = v_cafe_id and source = 'tap'", "                              where place_id = any(v_places) and source = 'tap'"],
    ["from redemptions where cafe_id = v_cafe_id and status = 'saved'", "from redemptions where cafe_id = any(v_cards) and status = 'saved'"],
    ["where cafe_id = v_cafe_id and status = 'redeemed'", "where coalesce(place_id, cafe_id) = any(v_places) and status = 'redeemed'"],
  ],
  merchant_daily: [
    ["  v_result  jsonb;\n", "  v_result  jsonb;\n" + PL],
    ["cafe_id = v_cafe_id and source = 'tap'", "place_id = any(v_places) and source = 'tap'", 2],
  ],
  merchant_campaign_stats: [
    ["  v_cafe_id uuid := public.merchant_session_cafe(p_token);\n", "  v_cafe_id uuid := public.merchant_session_cafe(p_token);\n" + PL + "  v_cards  uuid[] := public.scope_cards(v_cafe_id);\n"],
    ["where cafe_id = v_cafe_id and source = 'bonus'", "where place_id = any(v_places) and source = 'bonus'", 2],
    ["where cafe_id = v_cafe_id and used_at is null and expires_at > now()", "where cafe_id = any(v_cards) and used_at is null and expires_at > now()"],
    [`    'new_customers_30d', (select count(*) from stamp_bonuses b
                           where b.cafe_id = v_cafe_id and b.used_at > now() - interval '30 days'`,
     `    'new_customers_30d', (select count(*) from stamp_bonuses b left join stamps u on u.id = b.used_stamp_id
                           where b.cafe_id = any(v_cards) and coalesce(u.place_id, b.cafe_id) = any(v_places)
                             and b.used_at > now() - interval '30 days'`],
    ["where cafe_id = v_cafe_id and status = 'redeemed'", "where coalesce(place_id, cafe_id) = any(v_places) and status = 'redeemed'"],
  ],
  merchant_get_quiet_hours: [
    ["  v_hours   jsonb;\n", "  v_hours   jsonb;\n" + PL],
    ["where cafe_id = v_cafe_id and source = 'quiet'", "where place_id = any(v_places) and source = 'quiet'", 2],
  ],
  merchant_pending_list: [
    ["where cafe_id = v_cafe_id and status = 'saved'", "where cafe_id = any(public.scope_cards(v_cafe_id)) and status = 'saved'  -- v18: hela kedjans kort"],
  ],
  merchant_recent_redemptions: [
    ["  v_result  jsonb;\n", "  v_result  jsonb;\n" + PL],
    ["where cafe_id = v_cafe_id and status = 'redeemed' and redeemed_at > now() - interval '24 hours'",
     "where coalesce(place_id, cafe_id) = any(v_places) and status = 'redeemed' and redeemed_at > now() - interval '24 hours'", 2],
    ["coalesce(reward_name, public.reward_label(cafe_id, tier_at)) as reward\n      from redemptions",
     "coalesce(reward_name, public.reward_label(cafe_id, tier_at)) as reward,\n        (select pc.name from cafes pc where pc.id = coalesce(place_id, cafe_id)) as place\n      from redemptions"],
    ["'Födelsedagspresent: ' || reward_text\n      from birthday_gifts",
     "'Födelsedagspresent: ' || reward_text,\n        (select pc.name from cafes pc where pc.id = coalesce(place_id, cafe_id))\n      from birthday_gifts"],
  ],
  merchant_redeem_by_code: [
    ["  v_carry   int;\n", "  v_carry   int;\n  v_cards   uuid[] := public.scope_cards(v_cafe_id);  -- v18: kedjans kort löses in på alla ställen\n"],
    ["  if v_gift.cafe_id <> v_cafe_id then", "  if not (v_gift.cafe_id = any(v_cards)) then"],
    ["redeemed_via = 'code' where id = v_gift.id;", "redeemed_via = 'code', place_id = v_cafe_id where id = v_gift.id;"],
    ["  if v_red.cafe_id <> v_cafe_id then", "  if not (v_red.cafe_id = any(v_cards)) then"],
    ["carry_over = v_carry, reward_name = v_red.reward_name,\n", "carry_over = v_carry, reward_name = v_red.reward_name, place_id = v_cafe_id,\n"],
  ],
  merchant_get_reward_tiers: [
    ["  select * into v_cafe from cafes where id = v_id;\n", "  select * into v_cafe from cafes where id = public.card_of(v_id);  -- v18: kedjans belöning\n"],
    ["public.reward_label(v_id, r.tier_at)", "public.reward_label(r.cafe_id, r.tier_at)"],
    ["where r.cafe_id = v_id and r.status = 'redeemed'", "where coalesce(r.place_id, r.cafe_id) = any(public.scope_places(v_id)) and r.status = 'redeemed'"],
    ["      ) t));\nend", "      ) t))\n    || case when v_cafe.id <> v_id then jsonb_build_object('managed_by_chain', true, 'chain_name', v_cafe.name) else '{}'::jsonb end;\nend"],
  ],
  merchant_set_reward_tiers: [
    ["  end if;\n  if p_reward_value_kr", "  end if;\n  if public.card_of(v_id) <> v_id then  -- v18: kedjans belöning ändras av huvudkontot\n    return jsonb_build_object('ok', false, 'error', 'chain_managed');\n  end if;\n  if p_reward_value_kr"],
  ],
  merchant_guest_levels: [
    ["where s.cafe_id = v_cafe_id and s.source = 'tap'", "where s.place_id = any(public.scope_places(v_cafe_id)) and s.source = 'tap'"],
  ],
  merchant_get_birthday: [
    ["  select * into v_cafe from cafes where id = v_id;\n", "  select * into v_cafe from cafes where id = public.card_of(v_id);  -- v18: kedjans present\n"],
    ["birthday_gifts where cafe_id = v_id and status = 'redeemed'", "birthday_gifts where coalesce(place_id, cafe_id) = any(public.scope_places(v_id)) and status = 'redeemed'", 2],
    ["s.cafe_id = v_id and s.source = 'tap'", "s.place_id = any(public.scope_places(v_id)) and s.source = 'tap'"],
    ["n.next_b - 365))));\nend", "n.next_b - 365))))\n    || case when v_cafe.id <> v_id then jsonb_build_object('managed_by_chain', true, 'chain_name', v_cafe.name) else '{}'::jsonb end;\nend"],
  ],
  merchant_set_birthday: [
    ["  end if;\n  if p_text is null", "  end if;\n  if public.card_of(v_id) <> v_id then  -- v18: kedjans present ändras av huvudkontot\n    return jsonb_build_object('ok', false, 'error', 'chain_managed');\n  end if;\n  if p_text is null"],
  ],
  merchant_invite_stats: [
    ["where cafe_id = v_cafe_id and status = 'rewarded'", "where coalesce(place_id, cafe_id) = any(public.scope_places(v_cafe_id)) and status = 'rewarded'", 3],
  ],
  cafe_visit_days: [
    ["where s.cafe_id = p_cafe_id and s.source = 'tap'", "where s.place_id = any(public.scope_places(p_cafe_id)) and s.source = 'tap'"],
  ],
  winback_eligible: [
    ["b.cafe_id = p_cafe_id", "b.cafe_id = public.card_of(p_cafe_id)", 2],
  ],
  cafe_month_stats: [
    ["  v_out   jsonb;\n", "  v_out   jsonb;\n  v_places uuid[] := public.scope_places(p_cafe_id);  -- v18\n"],
    ["where s.cafe_id = p_cafe_id and s.stamped_at >= v_from", "where s.place_id = any(v_places) and s.stamped_at >= v_from"],
    ["where s.cafe_id = p_cafe_id and s.source = 'tap'", "where s.place_id = any(v_places) and s.source = 'tap'"],
    ["where r.cafe_id = p_cafe_id and r.status = 'redeemed'", "where coalesce(r.place_id, r.cafe_id) = any(v_places) and r.status = 'redeemed'"],
  ],
  merchant_insights: [
    ["  v_tips     jsonb := '[]'::jsonb;\n", "  v_tips     jsonb := '[]'::jsonb;\n  v_card     cafes%rowtype;\n  v_places   uuid[] := public.scope_places(v_id);\n"],
    ["  select * into v_cafe from cafes where id = v_id;\n", "  select * into v_cafe from cafes where id = v_id;\n  select * into v_card from cafes where id = public.card_of(v_id);  -- v18: kortet (kedjans eller eget)\n"],
    ["where s.cafe_id = v_id and s.source = 'tap' and s.stamped_at >= public.sthlm_midnight(v_today - 89)",
     "where s.place_id = any(v_places) and s.source = 'tap' and s.stamped_at >= public.sthlm_midnight(v_today - 89)"],
    ["(select distinct s.user_id from stamps s where s.cafe_id = v_id) u", "(select distinct s.user_id from stamps s where s.place_id = any(v_places)) u"],
    ["public.stamps_since_last_redeem(u.user_id, v_id) >= v_cafe.stamps_needed", "public.stamps_since_last_redeem(u.user_id, v_card.id) >= v_card.stamps_needed"],
    ["r.user_id = u.user_id and r.cafe_id = v_id and r.status = 'saved'", "r.user_id = u.user_id and r.cafe_id = v_card.id and r.status = 'saved'"],
    ["s.user_id = u.user_id and s.cafe_id = v_id)", "s.user_id = u.user_id and s.cafe_id = v_card.id)"],
    ["jsonb_array_length(coalesce(v_cafe.reward_tiers, '[]'::jsonb)) > 0", "jsonb_array_length(coalesce(v_card.reward_tiers, '[]'::jsonb)) > 0"],
    ["if v_visits >= 30 and v_open >= 3 and", "if v_visits >= 30 and v_open >= 3 and not v_cafe.is_chain and"],
    ["if v_cafe.reward_value_kr is null then", "if v_card.reward_value_kr is null then"],
  ],
  merchant_lapsed: [
    ["  v_elig   int;\n", "  v_elig   int;\n  v_card   uuid := public.card_of(v_id);\n  v_places uuid[] := public.scope_places(v_id);\n"],
    ["public.stamps_since_last_redeem(l.user_id, v_id) as card_stamps", "public.stamps_since_last_redeem(l.user_id, v_card) as card_stamps"],
    ["b.user_id = l.user_id and b.cafe_id = v_id and b.origin = 'winback'", "b.user_id = l.user_id and b.cafe_id = v_card and b.origin = 'winback'"],
    ["(select stamps_needed from cafes where id = v_id)", "(select stamps_needed from cafes where id = v_card)"],
    ["where b.cafe_id = v_id and b.origin = 'winback' and b.created_at > now() - interval '60 days'",
     "where b.cafe_id = v_card and coalesce(b.place_id, b.cafe_id) = any(v_places) and b.origin = 'winback' and b.created_at > now() - interval '60 days'", 2],
  ],
  merchant_winback: [
    ["  v_sent    int;\n", "  v_sent    int;\n  v_card    uuid := public.card_of(v_id);  -- v18: bonusen gäller kortet (hela kedjan)\n"],
    ["'tappass:winback:' || v_id::text", "'tappass:winback:' || v_card::text"],
    ["  insert into stamp_bonuses(user_id, cafe_id, expires_at, origin)\n    select l.user_id, v_id, v_expires, 'winback'",
     "  insert into stamp_bonuses(user_id, cafe_id, expires_at, origin, place_id)\n    select l.user_id, v_card, v_expires, 'winback', v_id"],
  ],
  merchant_month_report: [
    ["from stamps s where s.cafe_id = v_id;", "from stamps s where s.place_id = any(public.scope_places(v_id));"],
  ],
  merchant_get_profile: [
    ["  v_logo cafe_logos%rowtype;\n", "  v_logo cafe_logos%rowtype;\n  v_card cafes%rowtype;\n"],
    ["  select * into v_cafe from cafes where id = v_id;\n", "  select * into v_cafe from cafes where id = v_id;\n  select * into v_card from cafes where id = public.card_of(v_id);  -- v18: kedjans belöning och färg\n"],
    ["'stamps_needed', v_cafe.stamps_needed", "'stamps_needed', v_card.stamps_needed"],
    ["'reward_text', v_cafe.reward_text, 'reward_short', v_cafe.reward_short,\n    'ink_color', v_cafe.ink_color,",
     "'reward_text', v_card.reward_text, 'reward_short', v_card.reward_short,\n    'ink_color', v_card.ink_color,"],
    ["    'updated_at', v_cafe.profile_updated_at);\nend",
     "    'updated_at', v_cafe.profile_updated_at)\n    || case when v_card.id <> v_id then jsonb_build_object('managed_by_chain', true, 'chain_name', v_card.name) else '{}'::jsonb end;\nend"],
  ],
  merchant_set_profile: [
    ["  select * into v_cafe from cafes where id = v_id for update;\n",
     "  -- Ställe i en kedja (v18): belöningen och färgen är kedjans och ändras av huvudkontot.\n  if public.card_of(v_id) <> v_id then\n    p_profile := p_profile - 'reward_text' - 'reward_short' - 'ink_color';\n  end if;\n  select * into v_cafe from cafes where id = v_id for update;\n"],
  ],
  admin_issue_pin: [
    ["    where not exists (select 1 from tags where cafe_id = v_cafe.id);", "    where not exists (select 1 from tags where cafe_id = v_cafe.id)\n      and not v_cafe.is_chain;  -- v18: huvudkontot har ingen tagg"],
  ],
};

const count = (s, a) => s.split(a).length - 1;
let fns = "", changed = [];
for (const [fn, list] of Object.entries(patches)) {
  let src = O(fn);
  for (const [a, b, n = 1] of list) {
    const c = count(src, a);
    if (c !== n) throw new Error(`${fn}: väntade ${n} träff(ar), fick ${c}: ${a.slice(0, 70)}`);
    src = src.split(a).join(b);
  }
  fns += src + ";\n\n";
  changed.push(fn);
}
// Vakten: md5 av funktionskroppen utan blanksteg i v17-läget (kopian = produktionen; kontrolleras mot den före körning)
const names = [...changed, "tag_public_info"].sort();
const gdb = await build(["./testsetup.sql"]);
const gr = await gdb.query(`select p.proname, md5(regexp_replace(p.prosrc, '\\s+', ' ', 'g')) h from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = any($1)`, [names]);
const guard = Object.fromEntries(gr.rows.map((x) => [x.proname, x.h]).sort((a, b) => a[0].localeCompare(b[0])));
if (Object.keys(guard).length !== names.length) throw new Error("vakt saknar: " + names.filter((n) => !guard[n]));
writeFileSync(new URL("./guard.json", import.meta.url), JSON.stringify(guard));

const parts = ["head", "schema", "helpers"].map((p) => readFileSync(new URL(`./parts/${p}.sql`, import.meta.url), "utf8"));
const tail = ["new", "grants"].map((p) => readFileSync(new URL(`./parts/${p}.sql`, import.meta.url), "utf8"));
const out = parts[0].replace("__GUARD__", JSON.stringify(guard).replace(/,/g, ",\n    ")) + parts[1] + parts[2]
  + "-- 4. Ändrade funktioner (produktionens v17-versioner med ändringarna markerade v18) ----------\n\n" + fns
  + tail.join("");
writeFileSync((process.env.TAPPASS_REPO || "/home/claude/tappass") + "/supabase_migration_v18_kedjor.sql", out);
writeFileSync(new URL("./changed.json", import.meta.url), JSON.stringify(changed));
console.log("ok:", changed.length, "ändrade funktioner,", out.length, "tecken");
