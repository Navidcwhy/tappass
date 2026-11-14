-- ════════════════════════════════════════════════════════════════════
-- TapPass v10: Fler belöningar (valfritt per butik) + belöningarnas värde
-- Butiken kan lägga till upp till 3 mindre belöningar under huvudbelöningen,
-- t.ex. "Valfri kaka" vid 5 stämplar när kortet är fullt vid 10 (kaffe).
-- Kunden väljer själv: lös in en mindre belöning — då börjar kortet om på
-- stämplarna utöver den — eller samla vidare till en större.
-- Butiken kan också ange belöningarnas värde i kronor; appen visar då vad kunden
-- fått ("Du har fått 7 belöningar = 245 kr", sparat-räknaren).
--   cafes.reward_tiers     [{"at": 5, "text": "Valfri kaka", "value_kr": 35}] —
--                          at < stamps_needed, högst 3, sorterade, value_kr valfritt;
--                          huvudbelöningen är oförändrad (stamps_needed +
--                          reward_text/reward_short)
--   cafes.reward_value_kr  huvudbelöningens värde i kronor (valfritt, 1–10 000)
--   redemptions.tier_at    null = hela kortet (huvudbelöningen), annars antalet
--                          stämplar den mindre belöningen kostar
--   redemptions.reward_name / value_kr  belöningen och värdet när kunden sparade
--                          (eller löste in direkt). Panelen visar rätt belöning även
--                          om butiken ändrar eller tar bort en nivå efteråt.
--   save_reward            tar emot vald nivå (p_tier_at); en sparad belöning kan
--                          bytas till en annan nivå (samma kod) om stämplarna räcker
--   current_saved_code     svarar även tier_at och reward
--   cancel_saved_reward    kunden ångrar en sparad belöning och samlar vidare
--   merchant_redeem_by_code / redeem_by_tap  överskott räknas från vald nivå
--   load_wallet            pending_tier/pending_reward per kort + sparat-räknaren
--                          (rewards_redeemed, saved_kr, rewards_unvalued)
--   merchant_pending_list / merchant_recent_redemptions  visar vilken belöning
--   merchant_get_reward_tiers / merchant_set_reward_tiers  panelens inställning
-- Bakåtkompatibel: äldre appar anropar save_reward(device, slug) som förut och
-- får hela kortet; butiker utan mindre belöningar fungerar exakt som innan.
-- Kan köras flera gånger.
-- ════════════════════════════════════════════════════════════════════

-- 1. Schema ------------------------------------------------------------------
alter table public.cafes add column if not exists reward_tiers jsonb not null default '[]'::jsonb;
alter table public.cafes drop constraint if exists cafes_reward_tiers_check;
alter table public.cafes add constraint cafes_reward_tiers_check
  check (jsonb_typeof(reward_tiers) = 'array' and jsonb_array_length(reward_tiers) <= 3);

alter table public.cafes add column if not exists reward_value_kr int;
alter table public.cafes drop constraint if exists cafes_reward_value_kr_check;
alter table public.cafes add constraint cafes_reward_value_kr_check
  check (reward_value_kr is null or reward_value_kr between 1 and 10000);

alter table public.redemptions add column if not exists tier_at int;
alter table public.redemptions drop constraint if exists redemptions_tier_at_check;
alter table public.redemptions add constraint redemptions_tier_at_check check (tier_at is null or tier_at > 0);

alter table public.redemptions add column if not exists reward_name text;
alter table public.redemptions add column if not exists value_kr int;
alter table public.redemptions drop constraint if exists redemptions_value_kr_check;
alter table public.redemptions add constraint redemptions_value_kr_check
  check (value_kr is null or value_kr between 1 and 10000);

-- 2. Hjälpfunktioner -----------------------------------------------------------
-- Rensar och kontrollerar butikens mindre belöningar. null = ogiltig.
-- value_kr (värde i kronor) är valfritt: saknas eller null = inget värde.
create or replace function public.reward_tiers_clean(p_tiers jsonb, p_needed int)
 returns jsonb language plpgsql immutable set search_path to 'public'
as $function$
declare
  v_out  jsonb := '[]'::jsonb;
  v_item jsonb;
  v_at   int;
  v_text text;
  v_val  int;
  v_seen int[] := '{}';
begin
  if p_tiers is null or jsonb_typeof(p_tiers) <> 'array' or jsonb_array_length(p_tiers) > 3 or p_needed is null then
    return null;
  end if;
  for v_item in select value from jsonb_array_elements(p_tiers) loop
    if jsonb_typeof(v_item) <> 'object' or jsonb_typeof(v_item->'at') is distinct from 'number'
       or (v_item->>'at') !~ '^[0-9]{1,4}$' then
      return null;
    end if;
    v_at := (v_item->>'at')::int;
    v_text := btrim(coalesce(v_item->>'text', ''));
    if v_at < 1 or v_at >= p_needed or v_at = any(v_seen) or length(v_text) < 1 or length(v_text) > 40 then
      return null;
    end if;
    v_val := null;
    if coalesce(jsonb_typeof(v_item->'value_kr'), 'null') <> 'null' then
      if jsonb_typeof(v_item->'value_kr') <> 'number' or (v_item->>'value_kr') !~ '^[0-9]{1,5}$' then
        return null;
      end if;
      v_val := (v_item->>'value_kr')::int;
      if v_val < 1 or v_val > 10000 then
        return null;
      end if;
    end if;
    v_seen := v_seen || v_at;
    v_out := v_out || jsonb_build_array(jsonb_build_object('at', v_at, 'text', v_text)
      || case when v_val is null then '{}'::jsonb else jsonb_build_object('value_kr', v_val) end);
  end loop;
  return (select coalesce(jsonb_agg(e order by (e->>'at')::int), '[]'::jsonb) from jsonb_array_elements(v_out) e);
end $function$;

-- Belöningens namn för en nivå (null eller >= stamps_needed = huvudbelöningen).
create or replace function public.reward_label(p_cafe_id uuid, p_tier_at int)
 returns text language sql stable security definer set search_path to 'public', 'extensions'
as $function$
  select coalesce(
    (select t->>'text' from jsonb_array_elements(c.reward_tiers) t
      where p_tier_at is not null and p_tier_at < c.stamps_needed and (t->>'at')::int = p_tier_at
      limit 1),
    c.reward_short, c.reward_text)
  from cafes c where c.id = p_cafe_id;
$function$;

-- Belöningens värde i kronor för en nivå enligt butikens inställning nu (null = okänt).
-- Tål ett felaktigt värde som skrivits direkt i databasen (ger då null i stället för fel,
-- så att plånboken och sparandet aldrig stoppas).
create or replace function public.reward_value(p_cafe_id uuid, p_tier_at int)
 returns int language sql stable security definer set search_path to 'public', 'extensions'
as $function$
  select case
    when p_tier_at is null or p_tier_at >= c.stamps_needed then c.reward_value_kr
    else (select x.v from (
            select case when (t->>'value_kr') ~ '^[0-9]{1,5}$' then (t->>'value_kr')::int end as v
            from jsonb_array_elements(c.reward_tiers) t
            where (t->>'at')::int = p_tier_at) x
          where x.v between 1 and 10000
          limit 1)
  end
  from cafes c where c.id = p_cafe_id;
$function$;

-- 3. Kunden: spara (välj nivå), visa, ångra -------------------------------------------
drop function if exists public.save_reward(text, text);
create or replace function public.save_reward(p_device_id text, p_cafe_slug text, p_tier_at int default null)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_user_id uuid;
  v_cafe    cafes%rowtype;
  v_red     redemptions%rowtype;
  v_tier    int;
  v_want    int;
  v_count   int;
  v_code    text;
begin
  select id into v_user_id from users where device_id = p_device_id;
  select * into v_cafe from cafes where slug = p_cafe_slug;
  if v_user_id is null or v_cafe.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_cafe.stamps_needed is null then
    return jsonb_build_object('ok', false, 'error', 'not_complete');
  end if;

  -- Vald nivå: null (ej angiven) eller stamps_needed = hela kortet; annars en av
  -- butikens mindre belöningar.
  v_tier := case when p_tier_at is null or p_tier_at >= v_cafe.stamps_needed then null else p_tier_at end;
  if v_tier is not null and not exists (
       select 1 from jsonb_array_elements(v_cafe.reward_tiers) t where (t->>'at')::int = v_tier) then
    return jsonb_build_object('ok', false, 'error', 'unknown_tier');
  end if;
  v_want := coalesce(v_tier, v_cafe.stamps_needed);

  -- Ett tryck i taget per enhet (samma lås som tap_token och redeem_by_tap)
  perform pg_advisory_xact_lock(hashtextextended('tappass:tap:' || p_device_id, 0));
  v_count := public.stamps_since_last_redeem(v_user_id, v_cafe.id);

  -- Redan sparad belöning → samma kod. Har kunden valt en annan nivå (och räcker
  -- stämplarna) byts nivån; p_tier_at null (äldre appar) behåller den sparade.
  select * into v_red from redemptions
    where user_id = v_user_id and cafe_id = v_cafe.id and status = 'saved'
    limit 1
    for update;
  if v_red.id is not null then
    if p_tier_at is not null and coalesce(v_red.tier_at, v_cafe.stamps_needed) <> v_want then
      if v_count < v_want then
        return jsonb_build_object('ok', false, 'error', 'not_complete', 'stamps', v_count, 'needed', v_want);
      end if;
      v_red.tier_at := v_tier;
      v_red.reward_name := public.reward_label(v_cafe.id, v_tier);
      update redemptions
        set tier_at = v_tier, reward_name = v_red.reward_name, value_kr = public.reward_value(v_cafe.id, v_tier)
        where id = v_red.id;
    end if;
    return jsonb_build_object('ok', true, 'code', v_red.redeem_code,
      'tier_at', coalesce(v_red.tier_at, v_cafe.stamps_needed),
      'reward', coalesce(v_red.reward_name, public.reward_label(v_cafe.id, v_red.tier_at)));
  end if;

  if v_count < v_want then
    return jsonb_build_object('ok', false, 'error', 'not_complete', 'stamps', v_count, 'needed', v_want);
  end if;
  v_code := public.gen_redeem_code();
  -- Belöningens namn och värde sparas nu: kunden har valt, och personalen ska se
  -- samma belöning även om butiken ändrar sina belöningar innan inlösen.
  insert into redemptions(user_id, cafe_id, saved_at, status, redeem_code, tier_at, reward_name, value_kr)
    values (v_user_id, v_cafe.id, now(), 'saved', v_code, v_tier,
            public.reward_label(v_cafe.id, v_tier), public.reward_value(v_cafe.id, v_tier));
  return jsonb_build_object('ok', true, 'code', v_code, 'tier_at', v_want, 'reward', public.reward_label(v_cafe.id, v_tier));
end $function$;

create or replace function public.current_saved_code(p_device_id text, p_cafe_slug text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_user_id uuid;
  v_cafe    cafes%rowtype;
  v_red     redemptions%rowtype;
begin
  select id into v_user_id from users where device_id = p_device_id;
  select * into v_cafe from cafes where slug = p_cafe_slug;
  if v_user_id is null or v_cafe.id is null then
    return jsonb_build_object('ok', false);
  end if;
  select * into v_red from redemptions
    where user_id = v_user_id and cafe_id = v_cafe.id and status = 'saved'
    limit 1;
  if v_red.id is null then
    return jsonb_build_object('ok', true, 'code', null);
  end if;
  return jsonb_build_object('ok', true, 'code', v_red.redeem_code,
    'tier_at', coalesce(v_red.tier_at, v_cafe.stamps_needed),
    'reward', coalesce(v_red.reward_name, public.reward_label(v_cafe.id, v_red.tier_at)));
end $function$;

-- Kunden ångrar en sparad belöning (t.ex. valde kakan men vill samla till kaffe).
create or replace function public.cancel_saved_reward(p_device_id text, p_cafe_slug text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_user_id uuid;
  v_cafe_id uuid;
  v_id      uuid;
begin
  select id into v_user_id from users where device_id = p_device_id;
  select id into v_cafe_id from cafes where slug = p_cafe_slug;
  if v_user_id is null or v_cafe_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tappass:tap:' || p_device_id, 0));
  update redemptions set status = 'cancelled'
    where user_id = v_user_id and cafe_id = v_cafe_id and status = 'saved'
    returning id into v_id;
  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'nothing_saved');
  end if;
  return jsonb_build_object('ok', true, 'stamps', public.stamps_since_last_redeem(v_user_id, v_cafe_id));
end $function$;

-- 4. Inlösen: överskottet räknas från vald nivå ------------------------------------------
create or replace function public.merchant_redeem_by_code(p_token text, p_code text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_cafe_id uuid := public.merchant_session_cafe(p_token);
  v_red     redemptions%rowtype;
  v_needed  int;
  v_carry   int;
begin
  if v_cafe_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_session');
  end if;
  select * into v_red from redemptions
    where redeem_code = p_code and status = 'saved'
    limit 1
    for update;
  if v_red.id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_code');
  end if;
  if v_red.cafe_id <> v_cafe_id then
    return jsonb_build_object('ok', false, 'error', 'wrong_cafe');
  end if;
  select stamps_needed into v_needed from cafes where id = v_red.cafe_id;
  v_carry := greatest(0, public.stamps_since_last_redeem(v_red.user_id, v_red.cafe_id) - coalesce(v_red.tier_at, v_needed, 0));
  -- Sparad före v10 (eller innan butiken angav ett värde): namn och värde sätts nu.
  v_red.reward_name := coalesce(v_red.reward_name, public.reward_label(v_red.cafe_id, v_red.tier_at));
  update redemptions
    set status = 'redeemed', redeemed_at = now(), carry_over = v_carry, reward_name = v_red.reward_name,
        value_kr = coalesce(value_kr, public.reward_value(cafe_id, tier_at))
    where id = v_red.id;
  return jsonb_build_object('ok', true, 'code', p_code, 'carry_over', v_carry,
    'tier_at', coalesce(v_red.tier_at, v_needed), 'reward', v_red.reward_name);
end $function$;

-- Som v9, men överskottet räknas från den sparade nivån. Utan sparad belöning löses
-- bara ett fullt kort in direkt (huvudbelöningen); har butiken mindre belöningar som
-- kunden nått men kortet inte är fullt måste kunden välja först (choose_reward).
create or replace function public.redeem_by_tap(p_device_id text, p_cafe_slug text, p_token text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
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
  if v_tag.cafe_id <> v_cafe.id then
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
      set status = 'redeemed', redeemed_at = now(), carry_over = v_carry, redeemed_via = 'tap',
          reward_name = v_red.reward_name, value_kr = coalesce(value_kr, public.reward_value(cafe_id, tier_at))
      where id = v_red.id;
    return jsonb_build_object('ok', true, 'carry_over', v_carry, 'stamps', v_carry,
      'tier_at', coalesce(v_red.tier_at, v_cafe.stamps_needed), 'reward', v_red.reward_name);
  elsif v_cafe.stamps_needed is not null and v_count >= v_cafe.stamps_needed then
    -- Fullt kort utan sparad kod: huvudbelöningen löses in direkt
    v_carry := greatest(0, v_count - v_cafe.stamps_needed);
    insert into redemptions(user_id, cafe_id, saved_at, status, redeemed_at, carry_over, redeemed_via, reward_name, value_kr)
      values (v_user_id, v_cafe.id, now(), 'redeemed', now(), v_carry, 'tap',
              public.reward_label(v_cafe.id, null), public.reward_value(v_cafe.id, null));
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

-- 5. Plånboken: vilken nivå som är sparad + sparat-räknaren --------------------------------
-- rewards_redeemed / saved_kr / rewards_unvalued: inlösta belöningar hos stället, deras
-- värde i kronor och hur många som saknar värde. Värdet är det som gällde när belöningen
-- sparades; äldre inlösen (före v10) och belöningar utan värde då räknas med butikens
-- värde nu.
create or replace function public.load_wallet(p_device_id text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_user_id uuid;
  v_result  jsonb;
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
      'bonus_expires_at', (
        select min(b.expires_at) from stamp_bonuses b
        where b.user_id = v_user_id and b.cafe_id = c.id and b.used_at is null and b.expires_at > now()
      )
    ) as card
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
    where c.active = true
      and (exists(select 1 from stamps s where s.user_id = v_user_id and s.cafe_id = c.id)
           or exists(select 1 from stamp_bonuses b
                      where b.user_id = v_user_id and b.cafe_id = c.id
                        and b.used_at is null and b.expires_at > now()))
  ) sub;

  return v_result;
end $function$;

-- 6. Butikspanelen ---------------------------------------------------------------
create or replace function public.merchant_pending_list(p_token text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
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
    where cafe_id = v_cafe_id and status = 'saved'
  ) r;
  return jsonb_build_object('ok', true, 'pending', v_result);
end $function$;

create or replace function public.merchant_recent_redemptions(p_token text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_cafe_id uuid := public.merchant_session_cafe(p_token);
  v_result  jsonb;
begin
  if v_cafe_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_session');
  end if;
  select coalesce(jsonb_agg(row_to_json(r) order by r.redeemed_at desc), '[]'::jsonb) into v_result from (
    select redeemed_at, coalesce(redeemed_via, 'code') as via,
      'Kund #' || substring(replace(user_id::text, '-', '') from 1 for 4) as customer_label,
      coalesce(reward_name, public.reward_label(cafe_id, tier_at)) as reward
    from redemptions
    where cafe_id = v_cafe_id and status = 'redeemed' and redeemed_at > now() - interval '24 hours'
    order by redeemed_at desc
    limit 10
  ) r;
  return jsonb_build_object('ok', true, 'recent', v_result);
end $function$;

-- Panelens inställning: huvudbelöningen (visas, ändras av TapPass), dess värde och de
-- mindre belöningarna (med värde), med antal inlösta per belöning senaste 30 dagarna.
create or replace function public.merchant_get_reward_tiers(p_token text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_cafe cafes%rowtype;
  v_id   uuid := public.merchant_session_cafe(p_token);
begin
  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_session');
  end if;
  select * into v_cafe from cafes where id = v_id;
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
               coalesce(r.reward_name, public.reward_label(v_id, r.tier_at)) as reward, count(*) as n
        from redemptions r
        where r.cafe_id = v_id and r.status = 'redeemed' and r.redeemed_at > now() - interval '30 days'
        group by 1, 2
      ) t));
end $function$;

-- Sparar de mindre belöningarna och huvudbelöningens värde (null = inget värde).
-- Panelen skickar alltid hela inställningen.
drop function if exists public.merchant_set_reward_tiers(text, jsonb);
create or replace function public.merchant_set_reward_tiers(p_token text, p_tiers jsonb, p_reward_value_kr int)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_id     uuid := public.merchant_session_cafe(p_token);
  v_needed int;
  v_clean  jsonb;
begin
  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_session');
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

-- 7. Behörigheter ------------------------------------------------------------------
revoke execute on function public.reward_tiers_clean(jsonb, int) from public, anon, authenticated;
revoke execute on function public.reward_label(uuid, int) from public, anon, authenticated;
revoke execute on function public.reward_value(uuid, int) from public, anon, authenticated;
grant execute on function public.save_reward(text, text, int) to anon, authenticated;
grant execute on function public.cancel_saved_reward(text, text) to anon, authenticated;
grant execute on function public.merchant_get_reward_tiers(text) to anon, authenticated;
grant execute on function public.merchant_set_reward_tiers(text, jsonb, int) to anon, authenticated;
