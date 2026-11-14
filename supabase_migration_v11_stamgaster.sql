-- ════════════════════════════════════════════════════════════════════
-- TapPass v11: Stamgästnivåer per ställe — kräver v10
-- Kunden får Brons, Silver eller Guld hos varje ställe utifrån sina besök där.
--   Besök  = ett svenskt dygn med minst en riktig stämpling (stamps.source = 'tap');
--            flera stämplar samma dag, dubbelstämplar och lugna timmar räknas som ett
--   Period = de senaste 12 månaderna (365 svenska dygn inklusive i dag)
--   Nivåer = Brons 3 besök, Silver 10, Guld 25
-- Samma gränser finns i appen (src/lib/levels.js) och i panelen — ändra alla tre.
--   guest_level(visits)     'brons' | 'silver' | 'guld' | null (stängd för klienter)
--   load_wallet             + visits_12m och last_visit (svenskt datum för senaste
--                           besöket) per kort — appen räknar upp efter ett tapp och
--                           visar ny nivå direkt
--   merchant_guest_levels   panelens fördelning: kunder per nivå senaste 12 månaderna
-- Bakåtkompatibel: äldre appar ignorerar de nya fälten. Kan köras flera gånger.
-- ════════════════════════════════════════════════════════════════════

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'redemptions' and column_name = 'reward_name') then
    raise exception 'Kör v10 först (supabase_migration_v10_fler_beloningar.sql)';
  end if;
end $$;

-- 1. Nivå efter antal besök ---------------------------------------------------------
create or replace function public.guest_level(p_visits int)
 returns text language sql immutable set search_path to 'public'
as $function$
  select case
    when coalesce(p_visits, 0) >= 25 then 'guld'
    when coalesce(p_visits, 0) >= 10 then 'silver'
    when coalesce(p_visits, 0) >= 3  then 'brons'
  end;
$function$;

-- 2. Plånboken: besök senaste 12 månaderna per kort ----------------------------------
-- Som v10 (pending/sparat-räknaren) + visits_12m och last_visit.
create or replace function public.load_wallet(p_device_id text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
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

-- 3. Panelen: hur många kunder har varje nivå ----------------------------------------
-- customers = kunder med minst ett besök senaste 12 månaderna.
create or replace function public.merchant_guest_levels(p_token text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
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
    where s.cafe_id = v_cafe_id and s.source = 'tap' and s.stamped_at >= v_since
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

-- 4. Behörigheter ------------------------------------------------------------------
revoke execute on function public.guest_level(int) from public, anon, authenticated;
grant execute on function public.merchant_guest_levels(text) to anon, authenticated;
