-- ============================================================================================
-- TapPass v18: kedjekort och huvudkonto
-- ============================================================================================
-- En kedja = en rad i cafes med is_chain = true (huvudkontot). Den äger kortet: namn, färg,
-- belöning, mindre belöningar, födelsedagspresent, inbjudningar och hjulet. Ställena är vanliga
-- rader i cafes med chain_id = kedjan och har egna taggar, inloggningar, profiler (adress,
-- öppettider, logga), väntetid och lugna timmar.
--
-- * Stämplar hos alla ställen räknas på samma kort: stamps.cafe_id = kedjan, stamps.place_id =
--   stället (för vanliga ställen är båda samma rad). Kundernas funktioner (load_wallet,
--   save_reward, current_saved_code, födelsedag, nivåer …) arbetar som förut på kortet.
-- * Belöningen löses in på vilket ställe som helst: redeem_by_tap och merchant_redeem_by_code
--   godtar kedjans alla ställen. Var den löstes in sparas i redemptions.place_id.
-- * Varje ställe ser bara sina egna siffror: panelens funktioner räknar på place_id
--   (scope_places). Huvudkontot ser hela kedjan, och merchant_chain_overview ger en rad per
--   ställe. merchant_chain_view ger huvudkontot en visning av ett ställe (12 timmar).
-- * Egen belöning för ett ställe: TapPass sätter own_card (admin_chain_own_card). Då räknas
--   ställets nya stämplar på ställets eget kort; huvudkontot ser fortfarande stället.
-- * Administration (stängd för klienter, innehåller inga hemligheter): admin_chain_create,
--   admin_chain_add_store, admin_chain_own_card, admin_chain_remove_store, admin_chain_status.
--   Huvudkontots inloggning skapas som förut med admin_issue_pin i SQL Editor (aldrig via AI).
--
-- Vanliga ställen påverkas inte: alla deras siffror och svar är desamma (testat i PGlite mot
-- produktionens funktioner), med tre nya fält i cafes-raden och place i "Senast inlösta".
-- Körs efter v17. Allt nedan går att köra igen.

-- 0. Vakt: produktionen ska ha exakt v17-läget för funktionerna som skrivs om (md5 av koden utan
--    blanksteg; tag_public_info har annan indragning i produktionen än i v4-filen) ----------------
do $$
declare
  v_expected jsonb := '{"admin_issue_pin":"a6a23ee170443f6051a3ae3f3b1045f7",
    "cafe_month_stats":"a165e4705ee50bf21e2daffda601d60b",
    "cafe_visit_days":"e8e7a089caa522ac92c4cc39e7b8af20",
    "invite_on_stamp":"fd792b125f2daefa4b4213c7590394e4",
    "load_wallet":"e0ac6af1f566c26257dc4e7247be19e0",
    "merchant_campaign_stats":"898daafbae2bc4658bc925ba12d2d0e5",
    "merchant_daily":"1b43465205ae03ff30f89d85729b8372",
    "merchant_get_birthday":"765f3a6fedfab57b642cad2673ff3bd3",
    "merchant_get_profile":"2b58d5f38c04d3320a25b822a7eed397",
    "merchant_get_quiet_hours":"f8c691559ef8d628bc488e1b54afb82e",
    "merchant_get_reward_tiers":"a4babea7012be6de49dd8c9e5a5304ad",
    "merchant_guest_levels":"1e601ecc41ec0908d1f4d7b708e97f49",
    "merchant_insights":"9a8ac6106ac9ebdabd929a57ec1c935c",
    "merchant_invite_stats":"5ae677ae6cbf36fef624aaaf1733bf46",
    "merchant_lapsed":"ca289110e50eba76fef46fa95570d7bc",
    "merchant_month_report":"cc895f4a8906df9f505d53d4cfc0de2b",
    "merchant_pending_list":"56c94062398b66a1e3a7104258f692b8",
    "merchant_recent_redemptions":"69966a9dec98e295b8612e94a388d599",
    "merchant_redeem_by_code":"86da2b192d85b0d929ab2abf84b391fa",
    "merchant_session_cafe":"987d1daa5f2dc0e288fed1b7866c544e",
    "merchant_set_birthday":"c7517136df8bb68cd35492ab79465426",
    "merchant_set_profile":"d27a7fcd1e900a2254c312e5cb47bd64",
    "merchant_set_reward_tiers":"9ad4d50e7002178130cc9e0a12d9a00a",
    "merchant_stats":"4d60abd9aad3554400d86c97a8beba22",
    "merchant_winback":"0fcc29c3468be9a309d52c8787133985",
    "redeem_birthday_by_tap":"f333e51c69a6b62419c6317da23764fd",
    "redeem_by_tap":"1d8e5d142ca0e9e6d653477d30d298dd",
    "spin_wheel":"cccf0a996b25b739ec28a2bf37436312",
    "tag_public_info":"32227f3af45b98c27318b40761c43e98",
    "tap_token_core":"2653bf5927c7817ca0c0046979528837",
    "wheel_status":"9afe013a5b77322b660e0bd6be0576c4",
    "winback_eligible":"ea4cb2f1825be8ea2ab9202ab5bdf636"}';
  v_bad text;
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'cafes' and column_name = 'is_chain') then
    return;  -- v18 har redan körts
  end if;
  select string_agg(e.key, ', ') into v_bad
    from jsonb_each_text(v_expected) e
    left join pg_proc p on p.proname = e.key and p.pronamespace = 'public'::regnamespace
   where p.oid is null or md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) <> e.value;
  if v_bad is not null then
    raise exception 'v18: produktionen har inte v17-läget för %. Hämta pg_get_functiondef och jämför.', v_bad;
  end if;
end $$;

-- 1. Schema ----------------------------------------------------------------------------------
alter table public.cafes add column if not exists is_chain boolean not null default false;
alter table public.cafes add column if not exists chain_id uuid references public.cafes(id) on delete restrict;
alter table public.cafes add column if not exists own_card boolean not null default false;
alter table public.cafes drop constraint if exists cafes_chain_check;
alter table public.cafes add constraint cafes_chain_check check (
      not (is_chain and chain_id is not null)
  and (chain_id is not null or not own_card)
  and chain_id is distinct from id);
create index if not exists cafes_chain_idx on public.cafes (chain_id) where chain_id is not null;

-- Var stämpeln gjordes (stället). Sätts av triggern stamps_place; befintliga = kortets ställe.
alter table public.stamps add column if not exists place_id uuid references public.cafes(id);
update public.stamps set place_id = cafe_id where place_id is null;
alter table public.stamps alter column place_id set not null;
create index if not exists stamps_place_idx on public.stamps (place_id, stamped_at desc);

-- Var belöningen, presenten och inbjudningen löstes in eller belönades.
alter table public.redemptions add column if not exists place_id uuid references public.cafes(id) on delete set null;
update public.redemptions set place_id = cafe_id where place_id is null and status = 'redeemed';
create index if not exists redemptions_place_idx on public.redemptions (place_id, redeemed_at desc) where place_id is not null;
alter table public.birthday_gifts add column if not exists place_id uuid references public.cafes(id) on delete set null;
update public.birthday_gifts set place_id = cafe_id where place_id is null and status = 'redeemed';
alter table public.invites add column if not exists place_id uuid references public.cafes(id) on delete set null;
update public.invites set place_id = cafe_id where place_id is null and cafe_id is not null;
-- Vinn tillbaka: vilket ställe (eller huvudkontot) som skickade dubbelstämpeln.
alter table public.stamp_bonuses add column if not exists place_id uuid references public.cafes(id) on delete set null;
update public.stamp_bonuses set place_id = cafe_id where place_id is null and origin = 'winback';

-- Huvudkontots visning av ett ställe: försvinner med huvudkontots egen session.
alter table public.merchant_sessions add column if not exists via_session text
  references public.merchant_sessions(token_hash) on delete cascade;

-- 2. Hjälpfunktioner (stängda för klienter) ----------------------------------------------------
-- Kortet som stämplar hos ett ställe räknas på: kedjan, eller stället självt.
create or replace function public.card_of(p_cafe uuid)
 returns uuid language sql stable set search_path to 'public'
as $function$
  select case when c.chain_id is not null and not c.own_card then c.chain_id else c.id end
    from cafes c where c.id = p_cafe;
$function$;

-- Ställena vars siffror en inloggning ser: huvudkontot = kedjans alla ställen (och sig självt),
-- annars stället självt.
create or replace function public.scope_places(p_cafe uuid)
 returns uuid[] language sql stable set search_path to 'public'
as $function$
  select case when c.is_chain then array(select x.id from cafes x where x.chain_id = c.id) || c.id
              else array[c.id] end
    from cafes c where c.id = p_cafe;
$function$;

-- Korten vars belöningar en inloggning löser in: huvudkontot = kedjans kort och ställen med eget
-- kort, ett ställe = kortet det stämplar på.
create or replace function public.scope_cards(p_cafe uuid)
 returns uuid[] language sql stable set search_path to 'public'
as $function$
  select case when c.is_chain then array(select x.id from cafes x where x.chain_id = c.id and x.own_card) || c.id
              else array[public.card_of(c.id)] end
    from cafes c where c.id = p_cafe;
$function$;

-- Stämpelns ställe: taggens ställe, annars stället i samma tryck (tappass.place, sätts av
-- tap_token_core – används av bonus- och inbjudningsstämplar), annars kortet. Ett ställe som
-- inte hör till kortet godtas aldrig.
create or replace function public.stamps_set_place()
 returns trigger language plpgsql set search_path to 'public'
as $function$
declare
  v uuid;
begin
  if new.place_id is null then
    select t.cafe_id into v from tags t where t.id = new.tag_id;
    if v is null then
      v := nullif(current_setting('tappass.place', true), '')::uuid;
    end if;
    if v is null or public.card_of(v) is distinct from new.cafe_id then
      v := new.cafe_id;
    end if;
    new.place_id := v;
  end if;
  return new;
end $function$;
drop trigger if exists stamps_place on public.stamps;
create trigger stamps_place before insert on public.stamps
  for each row execute function public.stamps_set_place();

-- 3. tappass.se/t/<token>: ställets namn, kortets belöning ------------------------------------
create or replace function public.tag_public_info(p_token text)
 returns jsonb language plpgsql stable security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_place cafes%rowtype;
  v_card  cafes%rowtype;
begin
  select c.* into v_place
    from tags t join cafes c on c.id = t.cafe_id
   where t.token = lower(coalesce(p_token, '')) and t.active = true and c.active = true;
  if v_place.id is null then
    return jsonb_build_object('ok', false);
  end if;
  select * into v_card from cafes where id = public.card_of(v_place.id) and active = true;
  if v_card.id is null then
    return jsonb_build_object('ok', false);
  end if;
  return jsonb_build_object('ok', true, 'name', v_place.name,
                            'reward_short', v_card.reward_short, 'stamps_needed', v_card.stamps_needed)
    || case when v_card.id <> v_place.id then jsonb_build_object('chain', v_card.name) else '{}'::jsonb end;
end $function$;

-- 4. Ändrade funktioner (produktionens v17-versioner med ändringarna markerade v18) ----------

CREATE OR REPLACE FUNCTION public.tap_token_core(p_device_id text, p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_user_id    uuid;
  v_cafe       cafes%rowtype;
  v_place      cafes%rowtype;
  v_tag        tags%rowtype;
  v_pending    redemptions%rowtype;
  v_last_stamp timestamptz;
  v_wait       int;
  v_count      int;
  v_complete   boolean;
  v_stamp_id   uuid;
  v_bonus_id   uuid;
  v_added      int := 1;
  v_quiet      boolean := false;
begin
  if coalesce(length(p_device_id), 0) < 8 then
    return jsonb_build_object('ok', false, 'error', 'bad_device');
  end if;

  select * into v_tag from tags where token = lower(p_token) and active = true;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'unknown_tag', 'token', p_token);
  end if;
  select * into v_cafe from cafes where id = v_tag.cafe_id and active = true;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'inactive_cafe');
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

  -- Ett tryck i taget per enhet (stoppar dubbelräkning och dubbla användare)
  perform pg_advisory_xact_lock(hashtextextended('tappass:tap:' || p_device_id, 0));

  select id into v_user_id from users where device_id = p_device_id;
  if v_user_id is null then
    insert into users(device_id) values (p_device_id) returning id into v_user_id;
  end if;

  select * into v_pending from redemptions
    where user_id = v_user_id and cafe_id = v_cafe.id and status = 'saved'
    limit 1;
  if found then
    return jsonb_build_object('ok', false, 'error', 'pending_reward', 'cafe', row_to_json(v_cafe));
  end if;

  -- Butikens väntetid sedan senaste stämpeln
  select max(stamped_at) into v_last_stamp from stamps
    where user_id = v_user_id and cafe_id = v_cafe.id;
  if v_last_stamp is not null
     and v_last_stamp + make_interval(secs => v_place.stamp_cooldown_seconds) > now() then
    v_wait := greatest(1, ceil(extract(epoch from
      v_last_stamp + make_interval(secs => v_place.stamp_cooldown_seconds) - now()))::int);
    v_count := public.stamps_since_last_redeem(v_user_id, v_cafe.id);
    return jsonb_build_object(
      'ok', false, 'error', 'cooldown', 'cafe', row_to_json(v_cafe), 'stamps', v_count,
      'retry_after_seconds', v_wait, 'retry_after_minutes', ceil(v_wait / 60.0)::int);
  end if;

  insert into stamps(user_id, cafe_id, tag_id) values (v_user_id, v_cafe.id, v_tag.id)
    returning id into v_stamp_id;

  -- Lugna timmar (v8): butikens valda tider ger en extra stämpel (source = 'quiet').
  -- En trasig inställning får aldrig stoppa en stämpling.
  begin
    v_quiet := coalesce(public.quiet_hours_active(v_place.quiet_hours, now()), false);
  exception when others then
    v_quiet := false;
  end;

  if v_quiet then
    insert into stamps(user_id, cafe_id, tag_id, source) values (v_user_id, v_cafe.id, v_tag.id, 'quiet');
    v_added := 2;
  else
    -- Dagens hjul: aktiv dubbelstämpel hos butiken ger en extra stämpel. Under en
    -- lugn timme används den inte (tappet ger redan 2) utan sparas till nästa besök.
    select id into v_bonus_id from stamp_bonuses
      where user_id = v_user_id and cafe_id = v_cafe.id and used_at is null and expires_at > now()
      order by created_at
      limit 1
      for update;
    if v_bonus_id is not null then
      insert into stamps(user_id, cafe_id, tag_id, source) values (v_user_id, v_cafe.id, v_tag.id, 'bonus');
      update stamp_bonuses set used_at = now(), used_stamp_id = v_stamp_id where id = v_bonus_id;
      v_added := 2;
    end if;
  end if;

  v_count := public.stamps_since_last_redeem(v_user_id, v_cafe.id);
  v_complete := v_count >= v_cafe.stamps_needed;

  return jsonb_build_object(
    'ok', true, 'cafe', row_to_json(v_cafe), 'stamps', v_count, 'complete', v_complete,
    'stamps_added', v_added, 'bonus_applied', v_bonus_id is not null, 'quiet_applied', v_quiet,
    'carry_over', greatest(0, v_count - v_cafe.stamps_needed))
    || case when v_place.id <> v_cafe.id
            then jsonb_build_object('place', jsonb_build_object('slug', v_place.slug, 'name', v_place.name, 'area', v_place.area))
            else '{}'::jsonb end;
end $function$;

CREATE OR REPLACE FUNCTION public.redeem_by_tap(p_device_id text, p_cafe_slug text, p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_user_id uuid;
  v_cafe    cafes%rowtype;
  v_tag     tags%rowtype;
  v_other   text;
  v_red     redemptions%rowtype;
  v_count   int;
  v_carry   int;
begin
  if coalesce(length(p_device_id), 0) < 8 then
    return jsonb_build_object('ok', false, 'error', 'bad_device');
  end if;
  select * into v_cafe from cafes where slug = p_cafe_slug and active = true;
  if v_cafe.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  select * into v_tag from tags where token = lower(trim(coalesce(p_token, ''))) and active = true;
  if v_tag.id is null then
    return jsonb_build_object('ok', false, 'error', 'unknown_tag', 'expected', v_cafe.name);
  end if;
  if public.card_of(v_tag.cafe_id) is distinct from v_cafe.id then  -- v18: alla ställen i kedjan
    select name into v_other from cafes where id = v_tag.cafe_id;
    return jsonb_build_object('ok', false, 'error', 'wrong_tag', 'expected', v_cafe.name, 'got', v_other);
  end if;
  select id into v_user_id from users where device_id = p_device_id;
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  -- Ett tryck i taget per enhet (samma lås som tap_token)
  perform pg_advisory_xact_lock(hashtextextended('tappass:tap:' || p_device_id, 0));

  select * into v_red from redemptions
    where user_id = v_user_id and cafe_id = v_cafe.id and status = 'saved'
    limit 1
    for update;
  v_count := public.stamps_since_last_redeem(v_user_id, v_cafe.id);

  if v_red.id is not null then
    v_carry := greatest(0, v_count - coalesce(v_red.tier_at, v_cafe.stamps_needed, 0));
    v_red.reward_name := coalesce(v_red.reward_name, public.reward_label(v_cafe.id, v_red.tier_at));
    update redemptions
      set status = 'redeemed', redeemed_at = now(), carry_over = v_carry, redeemed_via = 'tap', place_id = v_tag.cafe_id,
          reward_name = v_red.reward_name, value_kr = coalesce(value_kr, public.reward_value(cafe_id, tier_at))
      where id = v_red.id;
    return jsonb_build_object('ok', true, 'carry_over', v_carry, 'stamps', v_carry,
      'tier_at', coalesce(v_red.tier_at, v_cafe.stamps_needed), 'reward', v_red.reward_name);
  elsif v_cafe.stamps_needed is not null and v_count >= v_cafe.stamps_needed then
    -- Fullt kort utan sparad kod: huvudbelöningen löses in direkt
    v_carry := greatest(0, v_count - v_cafe.stamps_needed);
    insert into redemptions(user_id, cafe_id, saved_at, status, redeemed_at, carry_over, redeemed_via, reward_name, value_kr, place_id)
      values (v_user_id, v_cafe.id, now(), 'redeemed', now(), v_carry, 'tap',
              public.reward_label(v_cafe.id, null), public.reward_value(v_cafe.id, null), v_tag.cafe_id);
    return jsonb_build_object('ok', true, 'carry_over', v_carry, 'stamps', v_carry,
      'tier_at', v_cafe.stamps_needed, 'reward', public.reward_label(v_cafe.id, null));
  elsif exists (select 1 from redemptions
                  where user_id = v_user_id and cafe_id = v_cafe.id and status = 'redeemed'
                    and redeemed_at > now() - interval '2 minutes') then
    -- Nyss inlöst på annat sätt (personalen skrev in koden samtidigt)
    return jsonb_build_object('ok', true, 'already', true, 'carry_over', v_count, 'stamps', v_count);
  elsif exists (select 1 from jsonb_array_elements(v_cafe.reward_tiers) t
                  where (t->>'at')::int <= v_count and (t->>'at')::int < v_cafe.stamps_needed) then
    return jsonb_build_object('ok', false, 'error', 'choose_reward', 'stamps', v_count);
  else
    return jsonb_build_object('ok', false, 'error', 'not_complete', 'stamps', v_count, 'needed', v_cafe.stamps_needed);
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.redeem_birthday_by_tap(p_device_id text, p_cafe_slug text, p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_user  uuid;
  v_cafe  cafes%rowtype;
  v_tag   tags%rowtype;
  v_other text;
  v_b     date;
  v_gift  birthday_gifts%rowtype;
begin
  if coalesce(length(p_device_id), 0) < 8 then
    return jsonb_build_object('ok', false, 'error', 'bad_device');
  end if;
  select * into v_cafe from cafes where slug = p_cafe_slug and active = true;
  if v_cafe.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  select * into v_tag from tags where token = lower(trim(coalesce(p_token, ''))) and active = true;
  if v_tag.id is null then
    return jsonb_build_object('ok', false, 'error', 'unknown_tag', 'expected', v_cafe.name);
  end if;
  if public.card_of(v_tag.cafe_id) is distinct from v_cafe.id then  -- v18: alla ställen i kedjan
    select name into v_other from cafes where id = v_tag.cafe_id;
    return jsonb_build_object('ok', false, 'error', 'wrong_tag', 'expected', v_cafe.name, 'got', v_other);
  end if;
  select id into v_user from users where device_id = p_device_id;
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tappass:tap:' || p_device_id, 0));

  select * into v_gift from birthday_gifts
   where user_id = v_user and cafe_id = v_cafe.id
   order by gift_year desc limit 1
   for update;
  if v_gift.status = 'redeemed' and v_gift.redeemed_at > now() - interval '2 minutes' then
    -- Nyss inlöst (personalen skrev in koden samtidigt)
    return jsonb_build_object('ok', true, 'already', true, 'reward', v_gift.reward_text, 'redeemed_at', v_gift.redeemed_at);
  end if;
  if v_gift.status = 'saved' and v_gift.valid_until > now() then
    update birthday_gifts set status = 'redeemed', redeemed_at = now(), redeemed_via = 'tap', place_id = v_tag.cafe_id where id = v_gift.id;
    return jsonb_build_object('ok', true, 'reward', v_gift.reward_text, 'redeemed_at', now());
  end if;
  -- Ingen kod sparad än: lös in direkt om kunden har en present hos stället den här veckan
  select o.birthday into v_b from public.birthday_offers(v_user) o where o.cafe_id = v_cafe.id;
  if v_b is null or exists (select 1 from birthday_gifts where user_id = v_user and cafe_id = v_cafe.id
                              and gift_year = extract(year from v_b)::int and status = 'redeemed') then
    return jsonb_build_object('ok', false, 'error', 'not_eligible');
  end if;
  insert into birthday_gifts(user_id, cafe_id, gift_year, code, status, reward_text, value_kr, valid_until, redeemed_at, redeemed_via, place_id)
    values (v_user, v_cafe.id, extract(year from v_b)::int, public.gen_gift_code(), 'redeemed', v_cafe.birthday_text,
            v_cafe.birthday_value_kr, public.sthlm_midnight(v_b + 7), now(), 'tap', v_tag.cafe_id)
    on conflict (user_id, cafe_id, gift_year) do update
      set status = 'redeemed', redeemed_at = now(), redeemed_via = 'tap', place_id = excluded.place_id
    returning * into v_gift;
  return jsonb_build_object('ok', true, 'reward', v_gift.reward_text, 'redeemed_at', v_gift.redeemed_at);
end $function$;

CREATE OR REPLACE FUNCTION public.load_wallet(p_device_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_user_id uuid;
  v_result  jsonb;
  v_today   date := public.sthlm_today();
  v_since   timestamptz := public.sthlm_midnight(public.sthlm_today() - 364);
begin
  select id into v_user_id from users where device_id = p_device_id;
  if v_user_id is null then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(card), '[]'::jsonb) into v_result
  from (
    select jsonb_build_object(
      'cafe', row_to_json(c),
      'stamps', public.stamps_since_last_redeem(v_user_id, c.id),
      'pending', p.id is not null,
      'pending_tier', case when p.id is not null then coalesce(p.tier_at, c.stamps_needed) end,
      'pending_reward', case when p.id is not null then coalesce(p.reward_name, public.reward_label(c.id, p.tier_at)) end,
      'rewards_redeemed', sv.n,
      'saved_kr', sv.kr,
      'rewards_unvalued', sv.unvalued,
      'visits_12m', gv.visits,
      'last_visit', gv.last_day,
      'bonus_expires_at', (
        select min(b.expires_at) from stamp_bonuses b
        where b.user_id = v_user_id and b.cafe_id = c.id and b.used_at is null and b.expires_at > now()
      )
    ) || case when c.is_chain then jsonb_build_object('stores', (   -- v18: kedjans ställen
           select coalesce(jsonb_agg(jsonb_build_object('slug', x.slug, 'name', x.name, 'area', x.area,
                    'address', x.address, 'opening_hours', x.opening_hours, 'website', x.website,
                    'logo_version', x.logo_version) order by x.name), '[]'::jsonb)
             from cafes x where x.chain_id = c.id and not x.own_card and x.active))
         else '{}'::jsonb end as card
    from cafes c
    left join lateral (
      select r.id, r.tier_at, r.reward_name from redemptions r
      where r.user_id = v_user_id and r.cafe_id = c.id and r.status = 'saved'
      limit 1
    ) p on true
    cross join lateral (
      select count(*)::int as n, coalesce(sum(x.v), 0)::int as kr, (count(*) - count(x.v))::int as unvalued
      from (select coalesce(r.value_kr, public.reward_value(c.id, r.tier_at)) as v
              from redemptions r
             where r.user_id = v_user_id and r.cafe_id = c.id and r.status = 'redeemed') x
    ) sv
    cross join lateral (
      select count(distinct y.d)::int as visits, max(y.d) as last_day
      from (select (s.stamped_at at time zone 'Europe/Stockholm')::date as d
              from stamps s
             where s.user_id = v_user_id and s.cafe_id = c.id and s.source = 'tap'
               and s.stamped_at >= v_since) y
      where y.d <= v_today
    ) gv
    where c.active = true
      and (exists(select 1 from stamps s where s.user_id = v_user_id and s.cafe_id = c.id)
           or exists(select 1 from stamp_bonuses b
                      where b.user_id = v_user_id and b.cafe_id = c.id
                        and b.used_at is null and b.expires_at > now()))
  ) sub;

  return v_result;
end $function$;

CREATE OR REPLACE FUNCTION public.wheel_status(p_device_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_user_id    uuid;
  v_today      date := public.sthlm_today();
  v_spin       wheel_spins%rowtype;
  v_prize      wheel_spins%rowtype;
  v_cities     jsonb;
  v_bonuses    jsonb := '[]'::jsonb;
  v_offers     jsonb;
  v_today_json jsonb;
  v_prize_json jsonb;
begin
  select id into v_user_id from users where device_id = p_device_id;

  -- available = ställen i staden där kunden inte redan har en aktiv dubbelstämpel.
  -- 0 betyder att ett snurr inte kan ge något att välja (spin_wheel svarar all_bonused).
  select coalesce(jsonb_agg(jsonb_build_object('city', t.city, 'places', t.n, 'available', t.avail)
                            order by t.n desc, t.city), '[]'::jsonb)
    into v_cities
    from (select btrim(c.city) as city, count(*) as n,
                 count(*) filter (where not exists (
                   select 1 from stamp_bonuses b
                    where b.user_id = v_user_id and b.cafe_id = c.id
                      and b.used_at is null and b.expires_at > now())) as avail
            from cafes c
           where c.active and c.wheel_enabled and (c.chain_id is null or c.own_card) and nullif(btrim(c.city), '') is not null
           group by btrim(c.city)) t;
  if v_user_id is not null then
    select * into v_spin from wheel_spins where user_id = v_user_id and spin_date = v_today;
    if found then
      v_today_json := jsonb_build_object('spin_id', v_spin.id, 'won', v_spin.won, 'segment', v_spin.segment);
    end if;

    select * into v_prize from wheel_spins
     where user_id = v_user_id and won and claimed_cafe_id is null
       and public.sthlm_midnight(spin_date + 3) > now()
     order by spin_date desc
     limit 1;
    if found then
      v_offers := public.wheel_offer_json(v_user_id, v_prize.offers);
      if jsonb_array_length(v_offers) > 0 then
        v_prize_json := jsonb_build_object(
          'spin_id', v_prize.id,
          'claim_until', public.sthlm_midnight(v_prize.spin_date + 3),
          'offers', v_offers);
      end if;
    end if;

    select coalesce(jsonb_agg(jsonb_build_object('cafe', row_to_json(c), 'expires_at', b.expires_at)
                              order by b.expires_at), '[]'::jsonb)
      into v_bonuses
      from stamp_bonuses b join cafes c on c.id = b.cafe_id
     where b.user_id = v_user_id and b.used_at is null and b.expires_at > now() and c.active;
  end if;

  return jsonb_build_object(
    'ok', true,
    'can_spin', v_today_json is null,
    'next_spin_at', public.sthlm_midnight(v_today + 1),
    'today', v_today_json,
    'prize', v_prize_json,
    'bonuses', v_bonuses,
    'cities', v_cities);
end $function$;

CREATE OR REPLACE FUNCTION public.spin_wheel(p_device_id text, p_city text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_user_id uuid;
  v_today   date := public.sthlm_today();
  v_city    text := lower(btrim(coalesce(p_city, '')));
  v_elig    uuid[];
  v_offers  uuid[] := '{}';
  v_pick    uuid[];
  v_segment int;
  v_won     boolean;
  v_spin_id uuid;
begin
  if coalesce(length(p_device_id), 0) < 8 then
    return jsonb_build_object('ok', false, 'error', 'bad_device');
  end if;
  if v_city = '' then
    return jsonb_build_object('ok', false, 'error', 'no_city');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('tappass:wheel:' || p_device_id, 0));

  select id into v_user_id from users where device_id = p_device_id;
  if v_user_id is not null
     and exists (select 1 from wheel_spins where user_id = v_user_id and spin_date = v_today) then
    return jsonb_build_object('ok', false, 'error', 'already_spun',
      'next_spin_at', public.sthlm_midnight(v_today + 1));
  end if;

  select array_agg(c.id) into v_elig
    from cafes c
   where c.active and c.wheel_enabled and (c.chain_id is null or c.own_card)
     and lower(btrim(coalesce(c.city, ''))) = v_city
     and not exists (select 1 from stamp_bonuses b
                      where b.user_id = v_user_id and b.cafe_id = c.id
                        and b.used_at is null and b.expires_at > now());
  if v_elig is null then
    -- Inget att vinna i staden: snurret förbrukas inte. all_bonused = staden har
    -- ställen, men kunden har redan en aktiv dubbelstämpel hos vart och ett.
    if exists (select 1 from cafes c
                where c.active and c.wheel_enabled and (c.chain_id is null or c.own_card)
                  and lower(btrim(coalesce(c.city, ''))) = v_city) then
      return jsonb_build_object('ok', false, 'error', 'all_bonused');
    end if;
    return jsonb_build_object('ok', false, 'error', 'no_places');
  end if;

  if v_user_id is null then
    insert into users(device_id) values (p_device_id) on conflict (device_id) do nothing;
    select id into v_user_id from users where device_id = p_device_id;
  end if;

  v_segment := floor(random() * 10)::int;
  v_won := v_segment in (0, 3, 5, 8);

  if v_won then
    -- Minst ett ställe där kunden saknar stämplar (om det finns), resten slumpas.
    select array_agg(x.id) into v_pick from (
      select u.id from unnest(v_elig) as u(id)
       where not exists (select 1 from stamps s where s.user_id = v_user_id and s.cafe_id = u.id)
       order by random()
       limit 1) x;
    v_offers := coalesce(v_pick, '{}'::uuid[]);
    select array_agg(x.id) into v_pick from (
      select u.id from unnest(v_elig) as u(id)
       where not (u.id = any(v_offers))
       order by random()
       limit greatest(0, 3 - cardinality(v_offers))) x;
    v_offers := v_offers || coalesce(v_pick, '{}'::uuid[]);
  end if;

  insert into wheel_spins(user_id, spin_date, segment, won, offers)
    values (v_user_id, v_today, v_segment, v_won, v_offers)
    returning id into v_spin_id;

  return jsonb_build_object(
    'ok', true,
    'spin_id', v_spin_id,
    'won', v_won,
    'segment', v_segment,
    'next_spin_at', public.sthlm_midnight(v_today + 1),
    'claim_until', case when v_won then public.sthlm_midnight(v_today + 3) end,
    'offers', case when v_won then public.wheel_offer_json(v_user_id, v_offers) else '[]'::jsonb end);
end $function$;

CREATE OR REPLACE FUNCTION public.invite_on_stamp()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_inv invites%rowtype;
begin
  select * into v_inv from invites where friend_id = new.user_id and status = 'pending';
  if v_inv.id is null then
    return new;
  end if;
  if new.stamped_at > v_inv.window_until then
    update invites set status = 'expired' where id = v_inv.id;
    return new;
  end if;
  if exists (select 1 from cafes where id = new.cafe_id and active and invite_enabled) then
    perform public.invite_grant(v_inv.id, new.cafe_id);
    update invites set place_id = new.place_id where id = v_inv.id and status = 'rewarded';  -- v18
  end if;
  return new;
exception when others then
  return new;   -- en inbjudan får aldrig stoppa en stämpling
end $function$;

CREATE OR REPLACE FUNCTION public.merchant_session_cafe(p_token text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_hash    text := public.merchant_token_hash(p_token);
  v_cafe_id uuid;
  v_last    timestamptz;
begin
  select s.cafe_id, s.last_used_at into v_cafe_id, v_last
    from merchant_sessions s join cafes c on c.id = s.cafe_id
    where s.token_hash = v_hash and s.expires_at > now() and c.active = true;
  if v_cafe_id is null then
    return null;
  end if;
  if v_last < now() - interval '1 hour' then
    update merchant_sessions set last_used_at = now(),
           expires_at = case when via_session is null then now() + interval '30 days' else expires_at end  -- v18: huvudkontots visning förlängs inte
      where token_hash = v_hash;
  end if;
  return v_cafe_id;
end $function$;

CREATE OR REPLACE FUNCTION public.merchant_stats(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_cafe_id uuid := public.merchant_session_cafe(p_token);
  v_today   date;
  v_places uuid[] := public.scope_places(v_cafe_id);
  v_cards  uuid[] := public.scope_cards(v_cafe_id);
begin
  if v_cafe_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_session');
  end if;
  v_today := public.sthlm_today();
  return jsonb_build_object(
    'ok', true,
    'today',   (select count(*) from stamps where place_id = any(v_places) and source = 'tap'
                  and stamped_at >= public.sthlm_midnight(v_today)),
    'week',    (select count(*) from stamps where place_id = any(v_places) and source = 'tap'
                  and stamped_at >= public.sthlm_midnight(date_trunc('week', v_today::timestamp)::date)),
    'month',   (select count(*) from stamps where place_id = any(v_places) and source = 'tap'
                  and stamped_at >= public.sthlm_midnight(date_trunc('month', v_today::timestamp)::date)),
    'total',   (select count(*) from stamps where place_id = any(v_places) and source = 'tap'),
    'pending', (select count(*) from redemptions where cafe_id = any(v_cards) and status = 'saved'),
    'unique_customers_30d', (select count(distinct user_id) from stamps
                              where place_id = any(v_places) and source = 'tap' and stamped_at > now() - interval '30 days'),
    'redeemed_30d', (select count(*) from redemptions
                      where coalesce(place_id, cafe_id) = any(v_places) and status = 'redeemed' and redeemed_at > now() - interval '30 days')
  );
end $function$;

CREATE OR REPLACE FUNCTION public.merchant_daily(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_cafe_id uuid := public.merchant_session_cafe(p_token);
  v_today   date;
  v_from    timestamptz;
  v_result  jsonb;
  v_places uuid[] := public.scope_places(v_cafe_id);
begin
  if v_cafe_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_session');
  end if;
  v_today := public.sthlm_today();
  v_from  := public.sthlm_midnight(v_today - 29);
  if not exists (select 1 from stamps where place_id = any(v_places) and source = 'tap' and stamped_at >= v_from) then
    return jsonb_build_object('ok', true, 'days', '[]'::jsonb);
  end if;
  select jsonb_agg(jsonb_build_object('day', to_char(v_today - 29 + k, 'YYYY-MM-DD'),
                                      'stamps', coalesce(s.n, 0)) order by k)
    into v_result
    from generate_series(0, 29) as k
    left join (select (stamped_at at time zone 'Europe/Stockholm')::date as day, count(*) as n
                 from stamps
                where place_id = any(v_places) and source = 'tap' and stamped_at >= v_from
                group by 1) s on s.day = v_today - 29 + k;
  return jsonb_build_object('ok', true, 'days', v_result);
end $function$;

CREATE OR REPLACE FUNCTION public.merchant_campaign_stats(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_cafe_id uuid := public.merchant_session_cafe(p_token);
  v_places uuid[] := public.scope_places(v_cafe_id);
  v_cards  uuid[] := public.scope_cards(v_cafe_id);
begin
  if v_cafe_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_session');
  end if;
  return jsonb_build_object(
    'ok', true,
    'bonus_stamps_30d', (select count(*) from stamps
                          where place_id = any(v_places) and source = 'bonus' and stamped_at > now() - interval '30 days'),
    'bonus_stamps_total', (select count(*) from stamps where place_id = any(v_places) and source = 'bonus'),
    'active_bonuses', (select count(*) from stamp_bonuses
                        where cafe_id = any(v_cards) and used_at is null and expires_at > now()),
    'new_customers_30d', (select count(*) from stamp_bonuses b left join stamps u on u.id = b.used_stamp_id
                           where b.cafe_id = any(v_cards) and coalesce(u.place_id, b.cafe_id) = any(v_places)
                             and b.used_at > now() - interval '30 days'
                             and not exists (select 1 from stamps s
                                              where s.user_id = b.user_id and s.cafe_id = b.cafe_id
                                                and s.stamped_at < b.used_at)),
    'carried_over_30d', (select coalesce(sum(carry_over), 0) from redemptions
                          where coalesce(place_id, cafe_id) = any(v_places) and status = 'redeemed'
                            and redeemed_at > now() - interval '30 days')
  );
end $function$;

CREATE OR REPLACE FUNCTION public.merchant_get_quiet_hours(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_cafe_id uuid := public.merchant_session_cafe(p_token);
  v_hours   jsonb;
  v_places uuid[] := public.scope_places(v_cafe_id);
begin
  if v_cafe_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_session');
  end if;
  select quiet_hours into v_hours from cafes where id = v_cafe_id;
  return jsonb_build_object(
    'ok', true,
    'quiet_hours', coalesce(v_hours, '[]'::jsonb),
    'active_now', coalesce(public.quiet_hours_active(v_hours, now()), false),
    -- Besök under lugna timmar (varje sådant besök gav en extrastämpel)
    'visits_30d', (select count(*) from stamps where place_id = any(v_places) and source = 'quiet'
                    and stamped_at > now() - interval '30 days'),
    'visits_total', (select count(*) from stamps where place_id = any(v_places) and source = 'quiet'));
end $function$;

CREATE OR REPLACE FUNCTION public.merchant_pending_list(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_cafe_id uuid := public.merchant_session_cafe(p_token);
  v_result  jsonb;
begin
  if v_cafe_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_session');
  end if;
  select coalesce(jsonb_agg(row_to_json(r) order by r.saved_at desc), '[]'::jsonb) into v_result from (
    select redeem_code as code, saved_at,
      'Kund #' || substring(replace(user_id::text, '-', '') from 1 for 4) as customer_label,
      coalesce(reward_name, public.reward_label(cafe_id, tier_at)) as reward
    from redemptions
    where cafe_id = any(public.scope_cards(v_cafe_id)) and status = 'saved'  -- v18: hela kedjans kort
  ) r;
  return jsonb_build_object('ok', true, 'pending', v_result);
end $function$;

CREATE OR REPLACE FUNCTION public.merchant_recent_redemptions(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_cafe_id uuid := public.merchant_session_cafe(p_token);
  v_result  jsonb;
  v_places uuid[] := public.scope_places(v_cafe_id);
begin
  if v_cafe_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_session');
  end if;
  select coalesce(jsonb_agg(row_to_json(r) order by r.redeemed_at desc), '[]'::jsonb) into v_result from (
    select * from (
      select redeemed_at, coalesce(redeemed_via, 'code') as via,
        'Kund #' || substring(replace(user_id::text, '-', '') from 1 for 4) as customer_label,
        coalesce(reward_name, public.reward_label(cafe_id, tier_at)) as reward,
        (select pc.name from cafes pc where pc.id = coalesce(place_id, cafe_id)) as place
      from redemptions
      where coalesce(place_id, cafe_id) = any(v_places) and status = 'redeemed' and redeemed_at > now() - interval '24 hours'
      union all
      select redeemed_at, coalesce(redeemed_via, 'code'),
        'Kund #' || substring(replace(user_id::text, '-', '') from 1 for 4),
        'Födelsedagspresent: ' || reward_text,
        (select pc.name from cafes pc where pc.id = coalesce(place_id, cafe_id))
      from birthday_gifts
      where coalesce(place_id, cafe_id) = any(v_places) and status = 'redeemed' and redeemed_at > now() - interval '24 hours'
    ) x
    order by redeemed_at desc
    limit 10
  ) r;
  return jsonb_build_object('ok', true, 'recent', v_result);
end $function$;

CREATE OR REPLACE FUNCTION public.merchant_redeem_by_code(p_token text, p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_cafe_id uuid := public.merchant_session_cafe(p_token);
  v_red     redemptions%rowtype;
  v_gift    birthday_gifts%rowtype;
  v_needed  int;
  v_carry   int;
  v_cards   uuid[] := public.scope_cards(v_cafe_id);  -- v18: kedjans kort löses in på alla ställen
begin
  if v_cafe_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_session');
  end if;
  -- Födelsedagspresent (koden börjar med 0)
  if p_code ~ '^0[0-9]{5}$' then
    select * into v_gift from birthday_gifts where code = p_code and status = 'saved' limit 1 for update;
    if v_gift.id is null then
      return jsonb_build_object('ok', false, 'error', 'invalid_code');
    end if;
    if not (v_gift.cafe_id = any(v_cards)) then
      return jsonb_build_object('ok', false, 'error', 'wrong_cafe');
    end if;
    if v_gift.valid_until <= now() then
      return jsonb_build_object('ok', false, 'error', 'expired');
    end if;
    update birthday_gifts set status = 'redeemed', redeemed_at = now(), redeemed_via = 'code', place_id = v_cafe_id where id = v_gift.id;
    return jsonb_build_object('ok', true, 'code', p_code, 'kind', 'birthday', 'carry_over', null, 'tier_at', null,
      'reward', 'Födelsedagspresent: ' || v_gift.reward_text);
  end if;
  select * into v_red from redemptions
    where redeem_code = p_code and status = 'saved'
    limit 1
    for update;
  if v_red.id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_code');
  end if;
  if not (v_red.cafe_id = any(v_cards)) then
    return jsonb_build_object('ok', false, 'error', 'wrong_cafe');
  end if;
  select stamps_needed into v_needed from cafes where id = v_red.cafe_id;
  v_carry := greatest(0, public.stamps_since_last_redeem(v_red.user_id, v_red.cafe_id) - coalesce(v_red.tier_at, v_needed, 0));
  -- Sparad före v10 (eller innan butiken angav ett värde): namn och värde sätts nu.
  v_red.reward_name := coalesce(v_red.reward_name, public.reward_label(v_red.cafe_id, v_red.tier_at));
  update redemptions
    set status = 'redeemed', redeemed_at = now(), carry_over = v_carry, reward_name = v_red.reward_name, place_id = v_cafe_id,
        value_kr = coalesce(value_kr, public.reward_value(cafe_id, tier_at))
    where id = v_red.id;
  return jsonb_build_object('ok', true, 'code', p_code, 'carry_over', v_carry,
    'tier_at', coalesce(v_red.tier_at, v_needed), 'reward', v_red.reward_name);
end $function$;

CREATE OR REPLACE FUNCTION public.merchant_get_reward_tiers(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_cafe cafes%rowtype;
  v_id   uuid := public.merchant_session_cafe(p_token);
begin
  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_session');
  end if;
  select * into v_cafe from cafes where id = public.card_of(v_id);  -- v18: kedjans belöning
  return jsonb_build_object(
    'ok', true,
    'stamps_needed', v_cafe.stamps_needed,
    'reward_text', v_cafe.reward_text,
    'reward_short', v_cafe.reward_short,
    'reward_value_kr', v_cafe.reward_value_kr,
    -- Bara nivåer under huvudbelöningen (om TapPass sänkt antalet stämplar döljs resten)
    'tiers', (select coalesce(jsonb_agg(t order by (t->>'at')::int), '[]'::jsonb)
                from jsonb_array_elements(v_cafe.reward_tiers) t where (t->>'at')::int < v_cafe.stamps_needed),
    'max_tiers', 3,
    'redeemed_30d', (
      select coalesce(jsonb_agg(jsonb_build_object('tier_at', t.tier_at, 'reward', t.reward, 'count', t.n) order by t.tier_at, t.reward), '[]'::jsonb)
      from (
        select coalesce(r.tier_at, v_cafe.stamps_needed) as tier_at,
               coalesce(r.reward_name, public.reward_label(r.cafe_id, r.tier_at)) as reward, count(*) as n
        from redemptions r
        where coalesce(r.place_id, r.cafe_id) = any(public.scope_places(v_id)) and r.status = 'redeemed' and r.redeemed_at > now() - interval '30 days'
        group by 1, 2
      ) t))
    || case when v_cafe.id <> v_id then jsonb_build_object('managed_by_chain', true, 'chain_name', v_cafe.name) else '{}'::jsonb end;
end $function$;

CREATE OR REPLACE FUNCTION public.merchant_set_reward_tiers(p_token text, p_tiers jsonb, p_reward_value_kr integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_id     uuid := public.merchant_session_cafe(p_token);
  v_needed int;
  v_clean  jsonb;
begin
  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_session');
  end if;
  if public.card_of(v_id) <> v_id then  -- v18: kedjans belöning ändras av huvudkontot
    return jsonb_build_object('ok', false, 'error', 'chain_managed');
  end if;
  if p_reward_value_kr is not null and (p_reward_value_kr < 1 or p_reward_value_kr > 10000) then
    return jsonb_build_object('ok', false, 'error', 'invalid_value');
  end if;
  select stamps_needed into v_needed from cafes where id = v_id;
  v_clean := public.reward_tiers_clean(p_tiers, v_needed);
  if v_clean is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_tiers', 'max_tiers', 3, 'stamps_needed', v_needed);
  end if;
  update cafes set reward_tiers = v_clean, reward_value_kr = p_reward_value_kr where id = v_id;
  return jsonb_build_object('ok', true, 'tiers', v_clean, 'stamps_needed', v_needed, 'reward_value_kr', p_reward_value_kr);
end $function$;

CREATE OR REPLACE FUNCTION public.merchant_guest_levels(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_cafe_id uuid := public.merchant_session_cafe(p_token);
  v_since   timestamptz := public.sthlm_midnight(public.sthlm_today() - 364);
  v_counts  jsonb;
  v_total   int;
begin
  if v_cafe_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_session');
  end if;
  with per_customer as (
    select s.user_id, count(distinct (s.stamped_at at time zone 'Europe/Stockholm')::date)::int as visits
    from stamps s
    where s.place_id = any(public.scope_places(v_cafe_id)) and s.source = 'tap' and s.stamped_at >= v_since
    group by s.user_id
  )
  select jsonb_build_object(
           'brons',  count(*) filter (where public.guest_level(visits) = 'brons'),
           'silver', count(*) filter (where public.guest_level(visits) = 'silver'),
           'guld',   count(*) filter (where public.guest_level(visits) = 'guld')),
         count(*)::int
    into v_counts, v_total
  from per_customer;
  return jsonb_build_object(
    'ok', true,
    'levels', jsonb_build_array(
      jsonb_build_object('key', 'brons',  'name', 'Brons',  'visits', 3,  'customers', v_counts->'brons'),
      jsonb_build_object('key', 'silver', 'name', 'Silver', 'visits', 10, 'customers', v_counts->'silver'),
      jsonb_build_object('key', 'guld',   'name', 'Guld',   'visits', 25, 'customers', v_counts->'guld')),
    'customers', v_total,
    'period_days', 365);
end $function$;

CREATE OR REPLACE FUNCTION public.merchant_get_birthday(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_id    uuid := public.merchant_session_cafe(p_token);
  v_cafe  cafes%rowtype;
  v_today date := public.sthlm_today();
begin
  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_session');
  end if;
  select * into v_cafe from cafes where id = public.card_of(v_id);  -- v18: kedjans present
  return jsonb_build_object('ok', true,
    'text', v_cafe.birthday_text,
    'value_kr', v_cafe.birthday_value_kr,
    'redeemed_30d', (select count(*) from birthday_gifts where coalesce(place_id, cafe_id) = any(public.scope_places(v_id)) and status = 'redeemed'
                       and redeemed_at > now() - interval '30 days'),
    'redeemed_total', (select count(*) from birthday_gifts where coalesce(place_id, cafe_id) = any(public.scope_places(v_id)) and status = 'redeemed'),
    'upcoming_30d', (
      select count(*) from (
        select a.user_id,
               (select min(b) from unnest(array[public.birthday_in_year(a.birth_month, a.birth_day, extract(year from v_today)::int),
                                               public.birthday_in_year(a.birth_month, a.birth_day, extract(year from v_today)::int + 1)]) b
                 where b >= v_today) as next_b,
               (a.birthday_set_at at time zone 'Europe/Stockholm')::date as set_on
          from accounts a
         where a.birth_month is not null
      ) n
      where n.next_b <= v_today + 30 and n.set_on <= n.next_b - 30
        and exists (select 1 from stamps s where s.user_id = n.user_id and s.place_id = any(public.scope_places(v_id)) and s.source = 'tap'
                      and s.stamped_at >= public.sthlm_midnight(n.next_b - 365))))
    || case when v_cafe.id <> v_id then jsonb_build_object('managed_by_chain', true, 'chain_name', v_cafe.name) else '{}'::jsonb end;
end $function$;

CREATE OR REPLACE FUNCTION public.merchant_set_birthday(p_token text, p_text text, p_value_kr integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_id  uuid := public.merchant_session_cafe(p_token);
  v_txt text;
begin
  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_session');
  end if;
  if public.card_of(v_id) <> v_id then  -- v18: kedjans present ändras av huvudkontot
    return jsonb_build_object('ok', false, 'error', 'chain_managed');
  end if;
  if p_text is null or btrim(p_text) = '' then
    update cafes set birthday_text = null, birthday_value_kr = null where id = v_id;
    return public.merchant_get_birthday(p_token);
  end if;
  v_txt := public.profile_text(to_jsonb(p_text), 2, 60);
  if v_txt is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_text');
  end if;
  if p_value_kr is not null and p_value_kr not between 1 and 10000 then
    return jsonb_build_object('ok', false, 'error', 'invalid_value');
  end if;
  update cafes set birthday_text = v_txt, birthday_value_kr = p_value_kr where id = v_id;
  return public.merchant_get_birthday(p_token);
end $function$;

CREATE OR REPLACE FUNCTION public.merchant_invite_stats(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_cafe_id uuid := public.merchant_session_cafe(p_token);
begin
  if v_cafe_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_session');
  end if;
  return jsonb_build_object('ok', true,
    'friends_30d', (select count(*) from invites where coalesce(place_id, cafe_id) = any(public.scope_places(v_cafe_id)) and status = 'rewarded' and rewarded_at > now() - interval '30 days'),
    'friends_total', (select count(*) from invites where coalesce(place_id, cafe_id) = any(public.scope_places(v_cafe_id)) and status = 'rewarded'),
    'stamps_30d', (select coalesce(sum(friend_stamps + inviter_stamps), 0) from invites
                    where coalesce(place_id, cafe_id) = any(public.scope_places(v_cafe_id)) and status = 'rewarded' and rewarded_at > now() - interval '30 days'));
end $function$;

CREATE OR REPLACE FUNCTION public.cafe_visit_days(p_cafe_id uuid, p_from date)
 RETURNS TABLE(user_id uuid, d date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  select s.user_id, (s.stamped_at at time zone 'Europe/Stockholm')::date as d
  from stamps s
  where s.place_id = any(public.scope_places(p_cafe_id)) and s.source = 'tap'
    and s.stamped_at >= public.sthlm_midnight(p_from)
  group by 1, 2;
$function$;

CREATE OR REPLACE FUNCTION public.winback_eligible(p_cafe_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  select not exists (select 1 from stamp_bonuses b
                      where b.user_id = p_user_id and b.cafe_id = public.card_of(p_cafe_id)
                        and b.used_at is null and b.expires_at > now())
     and not exists (select 1 from stamp_bonuses b
                      where b.user_id = p_user_id and b.cafe_id = public.card_of(p_cafe_id)
                        and b.origin = 'winback' and b.created_at > now() - interval '60 days');
$function$;

CREATE OR REPLACE FUNCTION public.cafe_month_stats(p_cafe_id uuid, p_start date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_from  timestamptz := public.sthlm_midnight(p_start);
  v_to    timestamptz := public.sthlm_midnight((p_start + interval '1 month')::date);
  v_out   jsonb;
  v_places uuid[] := public.scope_places(p_cafe_id);  -- v18
begin
  with t as (
    select s.user_id, s.source, s.stamped_at,
           (s.stamped_at at time zone 'Europe/Stockholm') as local
    from stamps s
    where s.place_id = any(v_places) and s.stamped_at >= v_from and s.stamped_at < v_to
  ), visits as (
    select distinct t.user_id, t.local::date as d from t where t.source = 'tap'
  ), firsts as (
    select s.user_id, min(s.stamped_at) as first_at
    from stamps s
    where s.place_id = any(v_places) and s.source = 'tap' and s.user_id in (select user_id from visits)
    group by s.user_id
  ), red as (
    select coalesce(r.value_kr, public.reward_value(r.cafe_id, r.tier_at)) as v
    from redemptions r
    where coalesce(r.place_id, r.cafe_id) = any(v_places) and r.status = 'redeemed' and r.redeemed_at >= v_from and r.redeemed_at < v_to
  )
  select jsonb_build_object(
    'month', to_char(p_start, 'YYYY-MM'),
    'stamps', (select count(*) from t where t.source = 'tap'),
    'extra_stamps', (select count(*) from t where t.source <> 'tap'),
    'visits', (select count(*) from visits),
    'customers', (select count(distinct user_id) from visits),
    'new_customers', (select count(*) from firsts where first_at >= v_from),
    'returning_customers', (select count(*) from firsts where first_at < v_from),
    'rewards', (select count(*) from red),
    'rewards_value_kr', (select coalesce(sum(v), 0) from red),
    'rewards_unvalued', (select count(*) - count(v) from red),
    'busiest_dow', (select extract(isodow from d)::int from visits group by 1 order by count(*) desc, 1 limit 1),
    'busiest_hour', (select extract(hour from local)::int from t where t.source = 'tap' group by 1 order by count(*) desc, 1 limit 1)
  ) into v_out;
  return v_out;
end $function$;

CREATE OR REPLACE FUNCTION public.merchant_insights(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_id       uuid := public.merchant_session_cafe(p_token);
  v_cafe     cafes%rowtype;
  v_today    date := public.sthlm_today();
  v_cust     int;
  v_repeat   int;
  v_visits   int;
  v_med      numeric;
  v_pairs    int;
  v_heat     jsonb;
  v_busy     jsonb;
  v_days     jsonb;
  v_taps     int;
  v_open     int;
  v_qdow     int;
  v_qn       int;
  v_lapsed   int;
  v_unclaim  int;
  v_tips     jsonb := '[]'::jsonb;
  v_card     cafes%rowtype;
  v_places   uuid[] := public.scope_places(v_id);
begin
  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_session');
  end if;
  select * into v_cafe from cafes where id = v_id;
  select * into v_card from cafes where id = public.card_of(v_id);  -- v18: kortet (kedjans eller eget)

  -- Återkomst: kunder med besök senaste 90 dagarna, och hur många av dem kom mer än en gång
  select count(*), count(*) filter (where n >= 2), coalesce(sum(n), 0)
    into v_cust, v_repeat, v_visits
  from (select user_id, count(*) as n from public.cafe_visit_days(v_id, v_today - 89) group by user_id) a;

  -- Typisk tid mellan besök (median av alla tider mellan två besök, senaste 12 månaderna)
  select percentile_cont(0.5) within group (order by gap), count(gap)
    into v_med, v_pairs
  from (select d - lag(d) over (partition by user_id order by d) as gap
          from public.cafe_visit_days(v_id, v_today - 364)) g
  where gap is not null;

  -- Stämplingar per veckodag (1 = måndag) och timme, senaste 90 dagarna, svensk tid
  select coalesce(jsonb_agg(jsonb_build_array(dow, hr, n) order by dow, hr), '[]'::jsonb),
         (array_agg(jsonb_build_object('dow', dow, 'hour', hr, 'stamps', n) order by n desc, dow, hr))[1],
         coalesce(sum(n), 0)
    into v_heat, v_busy, v_taps
  from (select extract(isodow from s.stamped_at at time zone 'Europe/Stockholm')::int as dow,
               extract(hour from s.stamped_at at time zone 'Europe/Stockholm')::int as hr,
               count(*)::int as n
          from stamps s
         where s.place_id = any(v_places) and s.source = 'tap' and s.stamped_at >= public.sthlm_midnight(v_today - 89)
         group by 1, 2) h;

  -- Besök per veckodag (för lugnaste dagen)
  select coalesce(jsonb_object_agg(dow, n), '{}'::jsonb), count(*)
    into v_days, v_open
  from (select extract(isodow from d)::int as dow, count(*)::int as n
          from public.cafe_visit_days(v_id, v_today - 89) group by 1) w;
  select (key)::int, (value)::int into v_qdow, v_qn
    from jsonb_each_text(v_days) order by (value)::int, (key)::int limit 1;

  select count(*) into v_lapsed from public.lapsed_customers(v_id);
  select count(*) into v_unclaim
  from (select distinct s.user_id from stamps s where s.place_id = any(v_places)) u
  where public.stamps_since_last_redeem(u.user_id, v_card.id) >= v_card.stamps_needed
    and not exists (select 1 from redemptions r where r.user_id = u.user_id and r.cafe_id = v_card.id and r.status = 'saved')
    and (select max(s.stamped_at) from stamps s where s.user_id = u.user_id and s.cafe_id = v_card.id) < now() - interval '7 days';

  -- Tips, viktigast först
  if v_lapsed >= 3 then
    v_tips := v_tips || jsonb_build_object('key', 'lapsed', 'count', v_lapsed);
  end if;
  if v_unclaim >= 1 then
    v_tips := v_tips || jsonb_build_object('key', 'unclaimed', 'count', v_unclaim);
  end if;
  if v_cust >= 10 and v_repeat::numeric / v_cust < 0.3 then
    v_tips := v_tips || jsonb_build_object('key', 'return_low', 'rate', round(v_repeat::numeric / v_cust, 2),
                                            'has_tiers', jsonb_array_length(coalesce(v_card.reward_tiers, '[]'::jsonb)) > 0);
  end if;
  if v_visits >= 30 and v_open >= 3 and not v_cafe.is_chain and jsonb_array_length(coalesce(v_cafe.quiet_hours, '[]'::jsonb)) = 0
     and v_qn <= 0.6 * (v_visits::numeric / v_open) then
    v_tips := v_tips || jsonb_build_object('key', 'quiet_day', 'dow', v_qdow, 'share', round(v_qn::numeric / v_visits, 2));
  end if;
  if v_card.reward_value_kr is null then
    v_tips := v_tips || jsonb_build_object('key', 'no_value');
  end if;

  return jsonb_build_object(
    'ok', true,
    'customers_90d', v_cust,
    'repeat_90d', v_repeat,
    'repeat_rate', case when v_cust > 0 then round(v_repeat::numeric / v_cust, 2) end,
    'visits_90d', v_visits,
    'median_gap_days', case when v_pairs >= 5 then round(v_med)::int end,
    'gap_pairs', v_pairs,
    'heatmap', v_heat,
    'busiest', v_busy,
    'stamps_90d', v_taps,
    'lapsed_count', v_lapsed,
    'tips', (select coalesce(jsonb_agg(t), '[]'::jsonb) from (select t from jsonb_array_elements(v_tips) t limit 4) x));
end $function$;

CREATE OR REPLACE FUNCTION public.merchant_lapsed(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_id     uuid := public.merchant_session_cafe(p_token);
  v_list   jsonb;
  v_count  int;
  v_elig   int;
  v_card   uuid := public.card_of(v_id);
  v_places uuid[] := public.scope_places(v_id);
begin
  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_session');
  end if;
  select count(*), count(*) filter (where public.winback_eligible(v_id, l.user_id)) into v_count, v_elig
    from public.lapsed_customers(v_id) l;
  select coalesce(jsonb_agg(row_to_json(x) order by x.visits desc, x.last_visit desc), '[]'::jsonb) into v_list
  from (
    select 'Kund #' || substring(replace(l.user_id::text, '-', '') from 1 for 4) as customer_label,
           l.visits, l.last_day as last_visit, l.gap_days, l.days_since,
           public.stamps_since_last_redeem(l.user_id, v_card) as card_stamps,
           (select max(b.created_at) from stamp_bonuses b
             where b.user_id = l.user_id and b.cafe_id = v_card and b.origin = 'winback') as winback_at,
           public.winback_eligible(v_id, l.user_id) as eligible
    from public.lapsed_customers(v_id) l
    order by l.visits desc, l.last_day desc
    limit 20
  ) x;
  return jsonb_build_object(
    'ok', true,
    'count', v_count,
    'eligible', v_elig,
    'customers', v_list,
    'stamps_needed', (select stamps_needed from cafes where id = v_card),
    'sent_60d', (select count(*) from stamp_bonuses b
                  where b.cafe_id = v_card and coalesce(b.place_id, b.cafe_id) = any(v_places) and b.origin = 'winback' and b.created_at > now() - interval '60 days'),
    'returned_60d', (select count(*) from stamp_bonuses b
                      where b.cafe_id = v_card and coalesce(b.place_id, b.cafe_id) = any(v_places) and b.origin = 'winback' and b.created_at > now() - interval '60 days'
                        and exists (select 1 from stamps s where s.user_id = b.user_id and s.cafe_id = b.cafe_id
                                     and s.source = 'tap' and s.stamped_at > b.created_at)));
end $function$;

CREATE OR REPLACE FUNCTION public.merchant_winback(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_id      uuid := public.merchant_session_cafe(p_token);
  v_expires timestamptz := public.sthlm_midnight(public.sthlm_today() + 15);
  v_sent    int;
  v_card    uuid := public.card_of(v_id);  -- v18: bonusen gäller kortet (hela kedjan)
begin
  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_session');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tappass:winback:' || v_card::text, 0));
  insert into stamp_bonuses(user_id, cafe_id, expires_at, origin, place_id)
    select l.user_id, v_card, v_expires, 'winback', v_id
    from public.lapsed_customers(v_id) l
    where public.winback_eligible(v_id, l.user_id)
    order by l.visits desc, l.last_day desc
    limit 50;
  get diagnostics v_sent = row_count;
  return jsonb_build_object('ok', true, 'sent', v_sent, 'expires_at', v_expires);
end $function$;

CREATE OR REPLACE FUNCTION public.merchant_month_report(p_token text, p_month text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_id     uuid := public.merchant_session_cafe(p_token);
  v_now    date := date_trunc('month', public.sthlm_today())::date;
  v_start  date;
  v_first  date;
begin
  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_session');
  end if;
  v_start := case when p_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then to_date(p_month || '-01', 'YYYY-MM-DD') end;
  if v_start is null or v_start > v_now then
    v_start := v_now;
  end if;
  select date_trunc('month', min(s.stamped_at at time zone 'Europe/Stockholm'))::date into v_first
    from stamps s where s.place_id = any(public.scope_places(v_id));
  v_first := greatest(coalesce(v_first, v_now), (v_now - interval '11 months')::date);
  return jsonb_build_object(
    'ok', true,
    'month', to_char(v_start, 'YYYY-MM'),
    'current', public.cafe_month_stats(v_id, v_start),
    'previous', public.cafe_month_stats(v_id, (v_start - interval '1 month')::date),
    'complete', v_start < v_now,
    'months', (select coalesce(jsonb_agg(to_char(m, 'YYYY-MM') order by m desc), '[]'::jsonb)
                 from generate_series(v_first, v_now, interval '1 month') m));
end $function$;

CREATE OR REPLACE FUNCTION public.merchant_get_profile(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_id   uuid := public.merchant_session_cafe(p_token);
  v_cafe cafes%rowtype;
  v_logo cafe_logos%rowtype;
  v_card cafes%rowtype;
begin
  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_session');
  end if;
  select * into v_cafe from cafes where id = v_id;
  select * into v_card from cafes where id = public.card_of(v_id);  -- v18: kedjans belöning och färg
  select * into v_logo from cafe_logos where cafe_id = v_id;
  return jsonb_build_object(
    'ok', true,
    -- TapPass ändrar dessa
    'name', v_cafe.name, 'slug', v_cafe.slug, 'city', v_cafe.city, 'stamps_needed', v_card.stamps_needed,
    -- butiken ändrar resten
    'type', v_cafe.type, 'area', v_cafe.area,
    'reward_text', v_card.reward_text, 'reward_short', v_card.reward_short,
    'ink_color', v_card.ink_color,
    'address', coalesce(v_cafe.address, ''), 'description', coalesce(v_cafe.description, ''),
    'website', coalesce(v_cafe.website, ''), 'instagram', coalesce(v_cafe.instagram, ''),
    'opening_hours', v_cafe.opening_hours,
    'logo_version', v_cafe.logo_version,
    'logo', case when v_logo.cafe_id is not null
                 then jsonb_build_object('mime', v_logo.mime, 'data', encode(v_logo.data, 'base64')) end,
    'updated_at', v_cafe.profile_updated_at)
    || case when v_card.id <> v_id then jsonb_build_object('managed_by_chain', true, 'chain_name', v_card.name) else '{}'::jsonb end;
end $function$;

CREATE OR REPLACE FUNCTION public.merchant_set_profile(p_token text, p_profile jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_id     uuid := public.merchant_session_cafe(p_token);
  v_cafe   cafes%rowtype;
  v_txt    text;
  v_colors jsonb;
  v_hours  jsonb;
  f        record;
begin
  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_session');
  end if;
  if p_profile is null or jsonb_typeof(p_profile) <> 'object' then
    return jsonb_build_object('ok', false, 'error', 'invalid_field', 'field', 'profile');
  end if;
  -- Ställe i en kedja (v18): belöningen och färgen är kedjans och ändras av huvudkontot.
  if public.card_of(v_id) <> v_id then
    p_profile := p_profile - 'reward_text' - 'reward_short' - 'ink_color';
  end if;
  select * into v_cafe from cafes where id = v_id for update;

  -- Textfälten: (nyckel, min, max)
  for f in select * from (values ('type', 1, 30), ('area', 1, 40), ('reward_text', 1, 60), ('reward_short', 1, 40),
                                 ('address', 0, 120), ('description', 0, 160)) as t(k, lo, hi) loop
    if p_profile ? f.k then
      v_txt := public.profile_text(p_profile->f.k, f.lo, f.hi);
      if v_txt is null then
        return jsonb_build_object('ok', false, 'error', 'invalid_field', 'field', f.k);
      end if;
      case f.k
        when 'type' then v_cafe.type := v_txt;
        when 'area' then v_cafe.area := v_txt;
        when 'reward_text' then v_cafe.reward_text := v_txt;
        when 'reward_short' then v_cafe.reward_short := v_txt;
        when 'address' then v_cafe.address := nullif(v_txt, '');
        when 'description' then v_cafe.description := nullif(v_txt, '');
      end case;
    end if;
  end loop;

  if p_profile ? 'website' then
    v_txt := public.profile_text(p_profile->'website', 0, 200);
    if v_txt is null or (v_txt <> '' and v_txt !~* '^https?://[^\s/?#]+\.[^\s/?#]+([/?#][^\s]*)?$') then
      return jsonb_build_object('ok', false, 'error', 'invalid_field', 'field', 'website');
    end if;
    v_cafe.website := nullif(v_txt, '');
  end if;

  if p_profile ? 'instagram' then
    v_txt := public.profile_text(p_profile->'instagram', 0, 31);
    if v_txt is null or (v_txt <> '' and v_txt !~ '^@?[A-Za-z0-9._]{1,30}$') then
      return jsonb_build_object('ok', false, 'error', 'invalid_field', 'field', 'instagram');
    end if;
    v_cafe.instagram := nullif(ltrim(v_txt, '@'), '');
  end if;

  if p_profile ? 'ink_color' then
    v_colors := public.color_variants(p_profile->>'ink_color');
    if jsonb_typeof(p_profile->'ink_color') <> 'string' or v_colors is null then
      return jsonb_build_object('ok', false, 'error', 'invalid_field', 'field', 'ink_color');
    end if;
    v_cafe.ink_color := v_colors->>'ink';
    v_cafe.soft_color := v_colors->>'soft';
    v_cafe.deep_color := v_colors->>'deep';
  end if;

  if p_profile ? 'opening_hours' then
    v_hours := public.opening_hours_clean(p_profile->'opening_hours');
    if v_hours is null then
      return jsonb_build_object('ok', false, 'error', 'invalid_field', 'field', 'opening_hours');
    end if;
    v_cafe.opening_hours := v_hours;
  end if;

  update cafes set type = v_cafe.type, area = v_cafe.area, reward_text = v_cafe.reward_text,
                   reward_short = v_cafe.reward_short, ink_color = v_cafe.ink_color,
                   soft_color = v_cafe.soft_color, deep_color = v_cafe.deep_color,
                   address = v_cafe.address, description = v_cafe.description, website = v_cafe.website,
                   instagram = v_cafe.instagram, opening_hours = v_cafe.opening_hours,
                   profile_updated_at = now()
   where id = v_id;
  return public.merchant_get_profile(p_token);
end $function$;

CREATE OR REPLACE FUNCTION public.admin_issue_pin(p_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_cafe  cafes%rowtype;
  v_pin   text;
  v_login text;
  v_tag   text;
begin
  select * into v_cafe from cafes where slug = lower(trim(coalesce(p_slug, '')));
  if v_cafe.id is null then
    raise exception 'Okänd butik: %', p_slug;
  end if;

  loop  -- kryptografiskt slumpad (gen_random_uuid), aldrig en svag PIN
    v_pin := lpad(((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint
                    % 1000000))::text, 6, '0');
    exit when public.merchant_pin_is_strong(v_pin);
  end loop;

  select login_name into v_login from cafe_pins where cafe_id = v_cafe.id;
  if v_login is null then
    v_login := v_cafe.slug;
    while exists (select 1 from cafe_pins where login_name = v_login) loop
      v_login := v_cafe.slug || '-' || (100 + floor(random() * 900))::int;
    end loop;
  end if;

  insert into cafe_pins(cafe_id, pin_hash, login_name)
    values (v_cafe.id, crypt(v_pin, gen_salt('bf')), v_login)
  on conflict (cafe_id) do update
    set pin_hash = excluded.pin_hash, failed_attempts = 0, locked_until = null;
  delete from merchant_sessions where cafe_id = v_cafe.id;

  insert into tags(cafe_id, token)
    select v_cafe.id, v_cafe.slug || '-01'
    where not exists (select 1 from tags where cafe_id = v_cafe.id)
      and not v_cafe.is_chain;  -- v18: huvudkontot har ingen tagg
  select token into v_tag from tags where cafe_id = v_cafe.id order by created_at limit 1;

  return jsonb_build_object('slug', v_cafe.slug, 'login_name', v_login, 'pin', v_pin, 'tag_token', v_tag);
end $function$;

-- 5. Panelen: roll, huvudkontots översikt och visning av ett ställe --------------------------
-- role: 'standalone' (vanligt ställe), 'main' (kedjans huvudkonto) eller 'store' (ställe i kedja).
create or replace function public.merchant_chain(p_token text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_id  uuid := public.merchant_session_cafe(p_token);
  v_me  cafes%rowtype;
  v_hq  cafes%rowtype;
begin
  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_session');
  end if;
  select * into v_me from cafes where id = v_id;
  if v_me.is_chain then
    v_hq := v_me;
  elsif v_me.chain_id is not null then
    select * into v_hq from cafes where id = v_me.chain_id;
  else
    return jsonb_build_object('ok', true, 'role', 'standalone');
  end if;
  return jsonb_build_object('ok', true,
    'role', case when v_me.is_chain then 'main' else 'store' end,
    'own_card', v_me.own_card,
    'viewing', exists (select 1 from merchant_sessions
                        where token_hash = public.merchant_token_hash(p_token) and via_session is not null),
    'chain', jsonb_build_object('slug', v_hq.slug, 'name', v_hq.name,
                                'reward_short', v_hq.reward_short, 'stamps_needed', v_hq.stamps_needed),
    'place', case when not v_me.is_chain
                  then jsonb_build_object('slug', v_me.slug, 'name', v_me.name, 'area', v_me.area) end,
    'stores', (select coalesce(jsonb_agg(jsonb_build_object('slug', x.slug, 'name', x.name, 'area', x.area,
                                 'own_card', x.own_card, 'active', x.active) order by x.name), '[]'::jsonb)
                 from cafes x where x.chain_id = v_hq.id));
end $function$;

-- Huvudkontot: hela kedjan och en rad per ställe (stämplar i dag / 7 / 30 dagar, kunder och
-- inlösta belöningar 30 dagar, senaste stämpeln). Kunder räknas en gång i kedjans summa.
create or replace function public.merchant_chain_overview(p_token text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_id     uuid := public.merchant_session_cafe(p_token);
  v_hq     cafes%rowtype;
  v_today  date := public.sthlm_today();
  v_t0     timestamptz;
  v_t7     timestamptz;
  v_t30    timestamptz := now() - interval '30 days';
  v_places uuid[];
  v_rows   jsonb;
  v_tot    jsonb;
begin
  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_session');
  end if;
  select * into v_hq from cafes where id = v_id;
  if not v_hq.is_chain then
    return jsonb_build_object('ok', false, 'error', 'not_main');
  end if;
  v_t0 := public.sthlm_midnight(v_today);
  v_t7 := public.sthlm_midnight(v_today - 6);
  v_places := public.scope_places(v_id);

  with p as (
    select x.id, x.slug, x.name, x.area, x.own_card, x.active from cafes x where x.chain_id = v_hq.id
  ), s as (
    select st.place_id,
           count(*) filter (where st.stamped_at >= v_t0) as today,
           count(*) filter (where st.stamped_at >= v_t7) as d7,
           count(*) filter (where st.stamped_at > v_t30) as d30,
           count(distinct st.user_id) filter (where st.stamped_at > v_t30) as cust30,
           max(st.stamped_at) as last_at
      from stamps st
     where st.place_id in (select id from p) and st.source = 'tap'
     group by st.place_id
  ), r as (
    select rd.place_id, count(*) as n
      from redemptions rd
     where rd.place_id in (select id from p) and rd.status = 'redeemed' and rd.redeemed_at > v_t30
     group by rd.place_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'slug', p.slug, 'name', p.name, 'area', p.area, 'own_card', p.own_card, 'active', p.active,
           'stamps_today', coalesce(s.today, 0), 'stamps_7d', coalesce(s.d7, 0), 'stamps_30d', coalesce(s.d30, 0),
           'customers_30d', coalesce(s.cust30, 0), 'redeemed_30d', coalesce(r.n, 0), 'last_stamp_at', s.last_at)
         order by coalesce(s.d30, 0) desc, p.name), '[]'::jsonb)
    into v_rows
    from p left join s on s.place_id = p.id left join r on r.place_id = p.id;

  select jsonb_build_object(
           'stamps_today', count(*) filter (where st.stamped_at >= v_t0),
           'stamps_7d', count(*) filter (where st.stamped_at >= v_t7),
           'stamps_30d', count(*) filter (where st.stamped_at > v_t30),
           'customers_30d', count(distinct st.user_id) filter (where st.stamped_at > v_t30),
           'redeemed_30d', (select count(*) from redemptions rd
                             where coalesce(rd.place_id, rd.cafe_id) = any(v_places)
                               and rd.status = 'redeemed' and rd.redeemed_at > v_t30))
    into v_tot
    from stamps st
   where st.place_id = any(v_places) and st.source = 'tap';

  return jsonb_build_object('ok', true,
    'chain', jsonb_build_object('slug', v_hq.slug, 'name', v_hq.name),
    'totals', v_tot, 'stores', v_rows);
end $function$;

-- Huvudkontot öppnar ett ställes panel: en session för stället i 12 timmar som försvinner med
-- huvudkontots session (utloggning, PIN-byte). En visning per ställe och huvudkontosession.
create or replace function public.merchant_chain_view(p_token text, p_slug text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_id    uuid := public.merchant_session_cafe(p_token);
  v_hash  text := public.merchant_token_hash(p_token);
  v_hq    cafes%rowtype;
  v_store cafes%rowtype;
  v_token text;
begin
  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_session');
  end if;
  select * into v_hq from cafes where id = v_id;
  if not v_hq.is_chain then
    return jsonb_build_object('ok', false, 'error', 'not_main');
  end if;
  select * into v_store from cafes
   where slug = lower(trim(coalesce(p_slug, ''))) and chain_id = v_hq.id and active = true;
  if v_store.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  delete from merchant_sessions where cafe_id = v_store.id and via_session = v_hash;
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into merchant_sessions(token_hash, cafe_id, expires_at, via_session)
    values (public.merchant_token_hash(v_token), v_store.id, now() + interval '12 hours', v_hash);
  return jsonb_build_object('ok', true, 'token', v_token,
    'place', jsonb_build_object('slug', v_store.slug, 'name', v_store.name, 'area', v_store.area));
end $function$;

-- 6. Administration (TapPass; stängd för klienter, inga hemligheter) --------------------------
-- Ny kedja: huvudkontots rad. Inloggningen skapas sedan med admin_issue_pin('<slug>') i SQL Editor.
create or replace function public.admin_chain_create(p_slug text, p_name text, p_city text, p_type text,
    p_reward_text text, p_reward_short text, p_stamps_needed int,
    p_ink text default '#1B5A66', p_symbol text default 'coffee')
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_slug text := lower(trim(coalesce(p_slug, '')));
  v_col  jsonb := public.color_variants(p_ink);
begin
  if v_slug !~ '^[a-z0-9][a-z0-9-]{1,39}$' then
    raise exception 'Ogiltig slug: %', p_slug;
  end if;
  if exists (select 1 from cafes where slug = v_slug) then
    raise exception 'Slugen finns redan: %', v_slug;
  end if;
  if v_col is null then
    raise exception 'Färgen ska skrivas #RRGGBB: %', p_ink;
  end if;
  if coalesce(p_stamps_needed, 0) not between 2 and 20 then
    raise exception 'Antal stämplar ska vara 2–20: %', p_stamps_needed;
  end if;
  insert into cafes(slug, name, type, area, city, symbol, ink_color, soft_color, deep_color,
                    reward_text, reward_short, stamps_needed, is_chain)
    values (v_slug, btrim(p_name), btrim(p_type), 'Flera ställen', nullif(btrim(p_city), ''), p_symbol,
            v_col->>'ink', v_col->>'soft', v_col->>'deep', btrim(p_reward_text), btrim(p_reward_short),
            p_stamps_needed, true);
  return jsonb_build_object('ok', true, 'chain', v_slug);
end $function$;

-- Lägg ett ställe i en kedja. Har stället redan kunder flyttas deras kort till kedjans kort
-- (stämplar, sparade och inlösta belöningar, bonusar, presenter, inbjudningar; platsen behålls).
-- Har någon kund kort både hos stället och hos kedjan avbryts allt (inget flyttas).
create or replace function public.admin_chain_add_store(p_store text, p_chain text)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_store   cafes%rowtype;
  v_hq      cafes%rowtype;
  v_overlap int;
  v_moved   int;
begin
  select * into v_store from cafes where slug = lower(trim(coalesce(p_store, ''))) for update;
  select * into v_hq from cafes where slug = lower(trim(coalesce(p_chain, ''))) for update;
  if v_store.id is null or v_hq.id is null then
    raise exception 'Okänt ställe (%) eller kedja (%)', p_store, p_chain;
  end if;
  if not v_hq.is_chain then
    raise exception '% är ingen kedja – skapa den med admin_chain_create', v_hq.slug;
  end if;
  if v_store.is_chain then
    raise exception 'En kedja kan inte läggas i en annan kedja';
  end if;
  if v_store.chain_id = v_hq.id then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  if v_store.chain_id is not null then
    raise exception '% hör redan till en annan kedja – ta bort det därifrån först', v_store.slug;
  end if;
  select count(*) into v_overlap from (
    (select user_id from stamps where cafe_id = v_store.id
     union select user_id from redemptions where cafe_id = v_store.id
     union select user_id from stamp_bonuses where cafe_id = v_store.id
     union select user_id from birthday_gifts where cafe_id = v_store.id)
    intersect
    (select user_id from stamps where cafe_id = v_hq.id
     union select user_id from redemptions where cafe_id = v_hq.id
     union select user_id from stamp_bonuses where cafe_id = v_hq.id
     union select user_id from birthday_gifts where cafe_id = v_hq.id)) o;
  if v_overlap > 0 then
    raise exception '% kund(er) har kort både hos % och %. Inget flyttades.', v_overlap, v_store.slug, v_hq.slug;
  end if;
  update stamps set cafe_id = v_hq.id where cafe_id = v_store.id;
  get diagnostics v_moved = row_count;
  update redemptions set cafe_id = v_hq.id,
         place_id = coalesce(place_id, case when status = 'redeemed' then v_store.id end)
   where cafe_id = v_store.id;
  update stamp_bonuses set cafe_id = v_hq.id where cafe_id = v_store.id;
  update birthday_gifts set cafe_id = v_hq.id,
         place_id = coalesce(place_id, case when status = 'redeemed' then v_store.id end)
   where cafe_id = v_store.id;
  update invites set cafe_id = v_hq.id, place_id = coalesce(place_id, v_store.id) where cafe_id = v_store.id;
  update cafes set chain_id = v_hq.id, own_card = false where id = v_store.id;
  return jsonb_build_object('ok', true, 'store', v_store.slug, 'chain', v_hq.slug, 'moved_stamps', v_moved);
end $function$;

-- Egen belöning för ett ställe i kedjan (p_on = true): ställets nya stämplar räknas på ställets
-- eget kort med belöningen i ställets rad (reward_text, reward_short, stamps_needed). Kortet
-- som kunderna redan har hos kedjan påverkas inte.
create or replace function public.admin_chain_own_card(p_store text, p_on boolean)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_slug text;
begin
  update cafes set own_card = coalesce(p_on, false)
   where slug = lower(trim(coalesce(p_store, ''))) and chain_id is not null
  returning slug into v_slug;
  if v_slug is null then
    raise exception 'Inget ställe i en kedja: %', p_store;
  end if;
  return jsonb_build_object('ok', true, 'store', v_slug, 'own_card', coalesce(p_on, false));
end $function$;

-- Ta bort ett ställe ur kedjan. Kundernas kort stannar hos kedjan; stället blir ett vanligt
-- ställe med nya kort (kontrollera ställets belöning och färg efteråt).
create or replace function public.admin_chain_remove_store(p_store text)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  update cafes set chain_id = null, own_card = false
   where slug = lower(trim(coalesce(p_store, ''))) and chain_id is not null
  returning id into v_id;
  if v_id is null then
    raise exception 'Inget ställe i en kedja: %', p_store;
  end if;
  delete from merchant_sessions where cafe_id = v_id and via_session is not null;
  return jsonb_build_object('ok', true);
end $function$;

create or replace function public.admin_chain_status()
 returns table(kedja text, stalle text, namn text, eget_kort boolean, aktivt boolean, taggar text, inloggning boolean)
 language sql stable security definer set search_path to 'public'
as $function$
  select h.slug, s.slug, coalesce(s.name, h.name), s.own_card, coalesce(s.active, h.active),
         (select string_agg(t.token, ', ' order by t.token) from tags t where t.cafe_id = coalesce(s.id, h.id)),
         exists (select 1 from cafe_pins p where p.cafe_id = coalesce(s.id, h.id))
    from cafes h left join cafes s on s.chain_id = h.id
   where h.is_chain
   order by h.slug, s.slug nulls first;
$function$;

-- 7. Behörigheter -----------------------------------------------------------------------------
revoke execute on function public.card_of(uuid) from public, anon, authenticated;
revoke execute on function public.scope_places(uuid) from public, anon, authenticated;
revoke execute on function public.scope_cards(uuid) from public, anon, authenticated;
revoke execute on function public.stamps_set_place() from public, anon, authenticated;
revoke execute on function public.admin_chain_create(text, text, text, text, text, text, int, text, text) from public, anon, authenticated;
revoke execute on function public.admin_chain_add_store(text, text) from public, anon, authenticated;
revoke execute on function public.admin_chain_own_card(text, boolean) from public, anon, authenticated;
revoke execute on function public.admin_chain_remove_store(text) from public, anon, authenticated;
revoke execute on function public.admin_chain_status() from public, anon, authenticated;
grant execute on function public.merchant_chain(text) to anon, authenticated;
grant execute on function public.merchant_chain_overview(text) to anon, authenticated;
grant execute on function public.merchant_chain_view(text, text) to anon, authenticated;
grant execute on function public.tag_public_info(text) to anon, authenticated;
