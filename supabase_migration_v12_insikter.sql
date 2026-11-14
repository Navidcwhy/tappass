-- ════════════════════════════════════════════════════════════════════
-- TapPass v12: Insikter i butikspanelen — kräver v11 (och därmed v10)
-- Bara panelen: statistik, tips i klartext, vinn tillbaka och månadsrapport.
--   Besök = ett svenskt dygn med minst en riktig stämpling (source = 'tap') hos
--   stället (samma definition som stamgästnivåerna i v11).
--   stamp_bonuses.origin       'wheel' (Dagens hjul) | 'winback' (butikens vinn tillbaka)
--   merchant_insights(token)   återkomst (90 dagar), typisk tid mellan besök, besök per
--                              veckodag och timme, tips (nycklar + tal, texten i panelen)
--   merchant_lapsed(token)     stamgäster (minst 3 besök på 12 mån) som slutat komma:
--                              senaste besöket längre bort än max(30 dygn, 2 × deras
--                              vanliga tid mellan besök)
--   merchant_winback(token)    ger dem en dubbelstämpel som gäller 14 dagar (appen visar
--                              den redan, "Dubbelstämpel aktiv"); högst en gång per kund
--                              och 60 dagar, aldrig om kunden redan har en aktiv bonus
--   merchant_month_report(token, 'YYYY-MM')  månadsrapport + föregående månad
-- Kunderna är anonyma i panelen ("Kund #a41f"), precis som i väntande-listan.
-- Kan köras flera gånger.
-- ════════════════════════════════════════════════════════════════════

do $$
begin
  if to_regprocedure('public.guest_level(integer)') is null then
    raise exception 'Kör v11 först (supabase_migration_v11_stamgaster.sql)';
  end if;
end $$;

-- 1. Var kommer en dubbelstämpel ifrån -----------------------------------------------
alter table public.stamp_bonuses add column if not exists origin text not null default 'wheel';
alter table public.stamp_bonuses drop constraint if exists stamp_bonuses_origin_check;
alter table public.stamp_bonuses add constraint stamp_bonuses_origin_check check (origin in ('wheel', 'winback'));
create index if not exists stamp_bonuses_origin_idx on public.stamp_bonuses (cafe_id, origin, created_at desc);

-- 2. Hjälpfunktioner (stängda för klienter) ------------------------------------------
-- Besöksdagar hos ett ställe från och med ett svenskt datum.
create or replace function public.cafe_visit_days(p_cafe_id uuid, p_from date)
 returns table(user_id uuid, d date)
 language sql stable security definer set search_path to 'public', 'extensions'
as $function$
  select s.user_id, (s.stamped_at at time zone 'Europe/Stockholm')::date as d
  from stamps s
  where s.cafe_id = p_cafe_id and s.source = 'tap'
    and s.stamped_at >= public.sthlm_midnight(p_from)
  group by 1, 2;
$function$;

-- Stamgäster som slutat komma (se huvudet).
create or replace function public.lapsed_customers(p_cafe_id uuid)
 returns table(user_id uuid, visits int, last_day date, gap_days int, days_since int)
 language sql stable security definer set search_path to 'public', 'extensions'
as $function$
  with v as (
    select * from public.cafe_visit_days(p_cafe_id, public.sthlm_today() - 364)
  ), g as (
    select v.user_id, v.d, v.d - lag(v.d) over (partition by v.user_id order by v.d) as gap from v
  ), per as (
    select g.user_id, count(*)::int as visits, max(g.d) as last_day,
           percentile_cont(0.5) within group (order by g.gap) as med
    from g group by g.user_id
  )
  select per.user_id, per.visits, per.last_day, round(per.med)::int,
         (public.sthlm_today() - per.last_day)::int
  from per
  where per.visits >= 3
    and public.sthlm_today() - per.last_day > greatest(30, 2 * coalesce(per.med, 0));
$function$;

-- Kan få vinn tillbaka nu: ingen aktiv bonus hos stället och ingen vinn tillbaka på 60 dagar.
create or replace function public.winback_eligible(p_cafe_id uuid, p_user_id uuid)
 returns boolean language sql stable security definer set search_path to 'public', 'extensions'
as $function$
  select not exists (select 1 from stamp_bonuses b
                      where b.user_id = p_user_id and b.cafe_id = p_cafe_id
                        and b.used_at is null and b.expires_at > now())
     and not exists (select 1 from stamp_bonuses b
                      where b.user_id = p_user_id and b.cafe_id = p_cafe_id
                        and b.origin = 'winback' and b.created_at > now() - interval '60 days');
$function$;

-- En månads siffror (svenska månader). p_start = månadens första dag.
create or replace function public.cafe_month_stats(p_cafe_id uuid, p_start date)
 returns jsonb language plpgsql stable security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_from  timestamptz := public.sthlm_midnight(p_start);
  v_to    timestamptz := public.sthlm_midnight((p_start + interval '1 month')::date);
  v_out   jsonb;
begin
  with t as (
    select s.user_id, s.source, s.stamped_at,
           (s.stamped_at at time zone 'Europe/Stockholm') as local
    from stamps s
    where s.cafe_id = p_cafe_id and s.stamped_at >= v_from and s.stamped_at < v_to
  ), visits as (
    select distinct t.user_id, t.local::date as d from t where t.source = 'tap'
  ), firsts as (
    select s.user_id, min(s.stamped_at) as first_at
    from stamps s
    where s.cafe_id = p_cafe_id and s.source = 'tap' and s.user_id in (select user_id from visits)
    group by s.user_id
  ), red as (
    select coalesce(r.value_kr, public.reward_value(r.cafe_id, r.tier_at)) as v
    from redemptions r
    where r.cafe_id = p_cafe_id and r.status = 'redeemed' and r.redeemed_at >= v_from and r.redeemed_at < v_to
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

-- 3. Översikt + tips ---------------------------------------------------------------
-- Tipsen är nycklar med tal; panelen skriver texten (sv/en). Högst 4, viktigast först:
--   lapsed {count}            stamgäster har slutat komma → vinn tillbaka
--   unclaimed {count}         kunder med fullt kort som inte löst in (senaste besöket > 7 dygn)
--   return_low {rate, has_tiers}  under 30 % kommer tillbaka (minst 10 kunder på 90 dagar)
--   quiet_day {dow, share}    lugnaste öppna veckodagen (≤ 60 % av snittet) och inga lugna timmar
--   no_value                  huvudbelöningen saknar värde i kronor
create or replace function public.merchant_insights(p_token text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
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
begin
  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_session');
  end if;
  select * into v_cafe from cafes where id = v_id;

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
         where s.cafe_id = v_id and s.source = 'tap' and s.stamped_at >= public.sthlm_midnight(v_today - 89)
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
  from (select distinct s.user_id from stamps s where s.cafe_id = v_id) u
  where public.stamps_since_last_redeem(u.user_id, v_id) >= v_cafe.stamps_needed
    and not exists (select 1 from redemptions r where r.user_id = u.user_id and r.cafe_id = v_id and r.status = 'saved')
    and (select max(s.stamped_at) from stamps s where s.user_id = u.user_id and s.cafe_id = v_id) < now() - interval '7 days';

  -- Tips, viktigast först
  if v_lapsed >= 3 then
    v_tips := v_tips || jsonb_build_object('key', 'lapsed', 'count', v_lapsed);
  end if;
  if v_unclaim >= 1 then
    v_tips := v_tips || jsonb_build_object('key', 'unclaimed', 'count', v_unclaim);
  end if;
  if v_cust >= 10 and v_repeat::numeric / v_cust < 0.3 then
    v_tips := v_tips || jsonb_build_object('key', 'return_low', 'rate', round(v_repeat::numeric / v_cust, 2),
                                            'has_tiers', jsonb_array_length(coalesce(v_cafe.reward_tiers, '[]'::jsonb)) > 0);
  end if;
  if v_visits >= 30 and v_open >= 3 and jsonb_array_length(coalesce(v_cafe.quiet_hours, '[]'::jsonb)) = 0
     and v_qn <= 0.6 * (v_visits::numeric / v_open) then
    v_tips := v_tips || jsonb_build_object('key', 'quiet_day', 'dow', v_qdow, 'share', round(v_qn::numeric / v_visits, 2));
  end if;
  if v_cafe.reward_value_kr is null then
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

-- 4. Vinn tillbaka ------------------------------------------------------------------
-- Listan (högst 20, flest besök först) + hur många som kan få en dubbelstämpel nu och
-- hur det gått för de senaste 60 dagarnas utskick.
create or replace function public.merchant_lapsed(p_token text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_id     uuid := public.merchant_session_cafe(p_token);
  v_list   jsonb;
  v_count  int;
  v_elig   int;
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
           public.stamps_since_last_redeem(l.user_id, v_id) as card_stamps,
           (select max(b.created_at) from stamp_bonuses b
             where b.user_id = l.user_id and b.cafe_id = v_id and b.origin = 'winback') as winback_at,
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
    'stamps_needed', (select stamps_needed from cafes where id = v_id),
    'sent_60d', (select count(*) from stamp_bonuses b
                  where b.cafe_id = v_id and b.origin = 'winback' and b.created_at > now() - interval '60 days'),
    'returned_60d', (select count(*) from stamp_bonuses b
                      where b.cafe_id = v_id and b.origin = 'winback' and b.created_at > now() - interval '60 days'
                        and exists (select 1 from stamps s where s.user_id = b.user_id and s.cafe_id = b.cafe_id
                                     and s.source = 'tap' and s.stamped_at > b.created_at)));
end $function$;

-- Ger alla som kan få det nu en dubbelstämpel (högst 50 per gång), giltig 14 dagar
-- (t.o.m. 23.59 svensk tid). Lås per butik: två tryck samtidigt ger inte dubbla bonusar.
create or replace function public.merchant_winback(p_token text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_id      uuid := public.merchant_session_cafe(p_token);
  v_expires timestamptz := public.sthlm_midnight(public.sthlm_today() + 15);
  v_sent    int;
begin
  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_session');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tappass:winback:' || v_id::text, 0));
  insert into stamp_bonuses(user_id, cafe_id, expires_at, origin)
    select l.user_id, v_id, v_expires, 'winback'
    from public.lapsed_customers(v_id) l
    where public.winback_eligible(v_id, l.user_id)
    order by l.visits desc, l.last_day desc
    limit 50;
  get diagnostics v_sent = row_count;
  return jsonb_build_object('ok', true, 'sent', v_sent, 'expires_at', v_expires);
end $function$;

-- 5. Månadsrapport -------------------------------------------------------------------
-- p_month 'YYYY-MM' (null/ogiltig/framtida = innevarande månad). months = de månader som
-- finns att välja (från butikens första stämpling, högst 12, nyast först).
create or replace function public.merchant_month_report(p_token text, p_month text default null)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
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
    from stamps s where s.cafe_id = v_id;
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

-- 6. Behörigheter ------------------------------------------------------------------
revoke execute on function public.cafe_visit_days(uuid, date) from public, anon, authenticated;
revoke execute on function public.lapsed_customers(uuid) from public, anon, authenticated;
revoke execute on function public.winback_eligible(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.cafe_month_stats(uuid, date) from public, anon, authenticated;
grant execute on function public.merchant_insights(text) to anon, authenticated;
grant execute on function public.merchant_lapsed(text) to anon, authenticated;
grant execute on function public.merchant_winback(text) to anon, authenticated;
grant execute on function public.merchant_month_report(text, text) to anon, authenticated;
