-- TapPass v7: buggfixar efter genomgången 2026-11-11.
--  1. merchant_stats / merchant_daily räknar svenska dygn (förut UTC: en stämpel
--     00.30 hamnade på gårdagen och "Idag" började 01.00/02.00).
--  2. merchant_daily returnerar de senaste 30 dagarna äldst först med 0 för tomma
--     dagar (förut nyast först utan tomma dagar → panelens diagram gick baklänges
--     och "7D" visade de äldsta dagarna).
--  3. Dagens hjul: wheel_status visar per stad hur många ställen kunden kan vinna
--     (available), och spin_wheel svarar all_bonused i stället för no_places när
--     kunden redan har en aktiv dubbelstämpel hos alla ställen i staden.
-- Funktionernas signaturer och behörigheter är oförändrade. Tål att köras flera gånger.

-- Butikspanelens statistik: svenska dygn i stället för UTC, och dagserien
-- i stigande ordning med nollor för dagar utan stämplar.

-- merchant_stats: idag/vecka/månad räknas från midnatt svensk tid.
create or replace function public.merchant_stats(p_token text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_cafe_id uuid := public.merchant_session_cafe(p_token);
  v_today   date;
begin
  if v_cafe_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_session');
  end if;
  v_today := public.sthlm_today();
  return jsonb_build_object(
    'ok', true,
    'today',   (select count(*) from stamps where cafe_id = v_cafe_id and source = 'tap'
                  and stamped_at >= public.sthlm_midnight(v_today)),
    'week',    (select count(*) from stamps where cafe_id = v_cafe_id and source = 'tap'
                  and stamped_at >= public.sthlm_midnight(date_trunc('week', v_today::timestamp)::date)),
    'month',   (select count(*) from stamps where cafe_id = v_cafe_id and source = 'tap'
                  and stamped_at >= public.sthlm_midnight(date_trunc('month', v_today::timestamp)::date)),
    'total',   (select count(*) from stamps where cafe_id = v_cafe_id and source = 'tap'),
    'pending', (select count(*) from redemptions where cafe_id = v_cafe_id and status = 'saved'),
    'unique_customers_30d', (select count(distinct user_id) from stamps
                              where cafe_id = v_cafe_id and source = 'tap' and stamped_at > now() - interval '30 days'),
    'redeemed_30d', (select count(*) from redemptions
                      where cafe_id = v_cafe_id and status = 'redeemed' and redeemed_at > now() - interval '30 days')
  );
end $function$;

-- merchant_daily: de senaste 30 svenska dygnen, äldst först, med 0 för tomma dagar.
-- Tom lista om butiken inte har några stämplar alls under perioden (panelens tomläge).
create or replace function public.merchant_daily(p_token text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_cafe_id uuid := public.merchant_session_cafe(p_token);
  v_today   date;
  v_from    timestamptz;
  v_result  jsonb;
begin
  if v_cafe_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_session');
  end if;
  v_today := public.sthlm_today();
  v_from  := public.sthlm_midnight(v_today - 29);
  if not exists (select 1 from stamps where cafe_id = v_cafe_id and source = 'tap' and stamped_at >= v_from) then
    return jsonb_build_object('ok', true, 'days', '[]'::jsonb);
  end if;
  select jsonb_agg(jsonb_build_object('day', to_char(v_today - 29 + k, 'YYYY-MM-DD'),
                                      'stamps', coalesce(s.n, 0)) order by k)
    into v_result
    from generate_series(0, 29) as k
    left join (select (stamped_at at time zone 'Europe/Stockholm')::date as day, count(*) as n
                 from stamps
                where cafe_id = v_cafe_id and source = 'tap' and stamped_at >= v_from
                group by 1) s on s.day = v_today - 29 + k;
  return jsonb_build_object('ok', true, 'days', v_result);
end $function$;

create or replace function public.wheel_status(p_device_id text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
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
           where c.active and c.wheel_enabled and nullif(btrim(c.city), '') is not null
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

create or replace function public.spin_wheel(p_device_id text, p_city text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
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
   where c.active and c.wheel_enabled
     and lower(btrim(coalesce(c.city, ''))) = v_city
     and not exists (select 1 from stamp_bonuses b
                      where b.user_id = v_user_id and b.cafe_id = c.id
                        and b.used_at is null and b.expires_at > now());
  if v_elig is null then
    -- Inget att vinna i staden: snurret förbrukas inte. all_bonused = staden har
    -- ställen, men kunden har redan en aktiv dubbelstämpel hos vart och ett.
    if exists (select 1 from cafes c
                where c.active and c.wheel_enabled
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
