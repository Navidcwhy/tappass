-- =====================================================================
-- TapPass v6 — Dagens hjul (dubbelstämplar) + överskott vid inlösen
-- =====================================================================
-- Kräver att v4 och v5 är körda. Skriven mot live-schemat (pg_get_functiondef
-- 2026-11-04) och testad i PGlite mot en kopia av det innan körning.
-- Körs via Supabase-kopplingen (apply_migration) — se CLAUDE.md.
--
-- Regler (samma som i användarvillkoren § 6):
--   * Ett gratis snurr per enhet och svensk kalenderdag (nytt kl. 00.00).
--   * Servern avgör utfallet: 10 fält, fält 0, 3, 5 och 8 vinner (40 %).
--   * Vinst: kunden väljer 1 av 3 slumpade ställen i vald stad. Minst ett
--     ställe där kunden saknar stämplar om det finns. Ställen där kunden
--     redan har en aktiv bonus erbjuds inte.
--   * Bonusen gäller vinstdagen + 2 dagar t.o.m. 23.59 svensk tid och ger
--     två stämplar vid nästa stämpling hos stället.
--   * Överskott när kortet blir fullt följer med till nästa kort
--     (redemptions.carry_over).
--   * Staden lagras inte på servern (utlovat i integritetspolicyn).
-- =====================================================================

-- 1. Nya kolumner -------------------------------------------------------
alter table public.cafes
  add column if not exists city text,
  add column if not exists wheel_enabled boolean not null default true;

-- Dagens butiker (Lidingö och Södermalm) ligger i Stockholmsområdet.
update public.cafes set city = 'Stockholm' where city is null;

alter table public.stamps
  add column if not exists source text not null default 'tap';
alter table public.stamps drop constraint if exists stamps_source_check;
alter table public.stamps add constraint stamps_source_check check (source in ('tap', 'bonus'));

alter table public.redemptions
  add column if not exists carry_over integer not null default 0;
alter table public.redemptions drop constraint if exists redemptions_carry_over_check;
alter table public.redemptions add constraint redemptions_carry_over_check check (carry_over >= 0);

-- 2. Nya tabeller ---------------------------------------------------------
create table if not exists public.wheel_spins (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  spin_date       date not null,
  segment         smallint not null check (segment between 0 and 9),
  won             boolean not null,
  offers          uuid[] not null default '{}',
  claimed_cafe_id uuid references public.cafes(id) on delete set null,
  claimed_at      timestamptz,
  created_at      timestamptz not null default now(),
  constraint wheel_spins_one_per_day unique (user_id, spin_date)
);

create table if not exists public.stamp_bonuses (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  cafe_id       uuid not null references public.cafes(id) on delete cascade,
  spin_id       uuid references public.wheel_spins(id) on delete set null,
  kind          text not null default 'double' check (kind in ('double')),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  used_at       timestamptz,
  used_stamp_id uuid references public.stamps(id) on delete set null
);
create index if not exists stamp_bonuses_user_cafe_idx on public.stamp_bonuses (user_id, cafe_id, used_at);
create index if not exists stamp_bonuses_cafe_idx on public.stamp_bonuses (cafe_id, created_at desc);
create index if not exists stamp_bonuses_spin_idx on public.stamp_bonuses (spin_id);
create index if not exists stamp_bonuses_stamp_idx on public.stamp_bonuses (used_stamp_id);
create index if not exists wheel_spins_cafe_idx on public.wheel_spins (claimed_cafe_id);

-- Bara RPC:er (security definer) når tabellerna.
alter table public.wheel_spins enable row level security;
alter table public.stamp_bonuses enable row level security;
revoke all on public.wheel_spins from anon, authenticated;
revoke all on public.stamp_bonuses from anon, authenticated;

-- 3. Hjälpfunktioner (inte för klienter) -----------------------------------
create or replace function public.sthlm_today()
 returns date language sql stable set search_path to 'public', 'extensions'
as $function$
  select (now() at time zone 'Europe/Stockholm')::date;
$function$;

create or replace function public.sthlm_midnight(p_day date)
 returns timestamptz language sql stable set search_path to 'public', 'extensions'
as $function$
  select (p_day::timestamp at time zone 'Europe/Stockholm');
$function$;

-- Kortets stämplar = stämplar sedan senaste inlösen + överskott från den inlösen.
create or replace function public.stamps_since_last_redeem(p_user_id uuid, p_cafe_id uuid)
 returns integer language sql stable security definer set search_path to 'public', 'extensions'
as $function$
  with last_red as (
    select r.redeemed_at, r.carry_over
      from redemptions r
     where r.user_id = p_user_id and r.cafe_id = p_cafe_id and r.status = 'redeemed'
     order by r.redeemed_at desc nulls last
     limit 1
  )
  select (coalesce((select carry_over from last_red), 0)
          + (select count(*) from stamps s
              where s.user_id = p_user_id
                and s.cafe_id = p_cafe_id
                and s.stamped_at > coalesce((select redeemed_at from last_red), 'epoch'::timestamptz)))::int;
$function$;

-- Erbjudna ställen som JSON (bara aktiva och utan aktiv bonus för kunden).
create or replace function public.wheel_offer_json(p_user_id uuid, p_offers uuid[])
 returns jsonb language sql stable security definer set search_path to 'public', 'extensions'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'cafe', row_to_json(c),
           'stamps', case when p_user_id is null then 0 else public.stamps_since_last_redeem(p_user_id, c.id) end,
           'is_new', p_user_id is null
                     or not exists (select 1 from stamps s where s.user_id = p_user_id and s.cafe_id = c.id)
         ) order by array_position(p_offers, c.id)), '[]'::jsonb)
    from cafes c
   where c.id = any(p_offers)
     and c.active = true
     and not exists (select 1 from stamp_bonuses b
                      where b.user_id = p_user_id and b.cafe_id = c.id
                        and b.used_at is null and b.expires_at > now());
$function$;

-- 4. Befintliga RPC:er ------------------------------------------------------
-- tap_token: aktiv dubbelstämpel ger en extra stämpel (source = 'bonus').
-- Svaret är bakåtkompatibelt (nya fält: stamps_added, bonus_applied, carry_over).
create or replace function public.tap_token(p_device_id text, p_token text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_user_id    uuid;
  v_cafe       cafes%rowtype;
  v_tag        tags%rowtype;
  v_pending    redemptions%rowtype;
  v_last_stamp timestamptz;
  v_wait       int;
  v_count      int;
  v_complete   boolean;
  v_stamp_id   uuid;
  v_bonus_id   uuid;
  v_added      int := 1;
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
     and v_last_stamp + make_interval(secs => v_cafe.stamp_cooldown_seconds) > now() then
    v_wait := greatest(1, ceil(extract(epoch from
      v_last_stamp + make_interval(secs => v_cafe.stamp_cooldown_seconds) - now()))::int);
    v_count := public.stamps_since_last_redeem(v_user_id, v_cafe.id);
    return jsonb_build_object(
      'ok', false, 'error', 'cooldown', 'cafe', row_to_json(v_cafe), 'stamps', v_count,
      'retry_after_seconds', v_wait, 'retry_after_minutes', ceil(v_wait / 60.0)::int);
  end if;

  insert into stamps(user_id, cafe_id, tag_id) values (v_user_id, v_cafe.id, v_tag.id)
    returning id into v_stamp_id;

  -- Dagens hjul: aktiv dubbelstämpel hos butiken ger en extra stämpel
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

  v_count := public.stamps_since_last_redeem(v_user_id, v_cafe.id);
  v_complete := v_count >= v_cafe.stamps_needed;

  return jsonb_build_object(
    'ok', true, 'cafe', row_to_json(v_cafe), 'stamps', v_count, 'complete', v_complete,
    'stamps_added', v_added, 'bonus_applied', v_bonus_id is not null,
    'carry_over', greatest(0, v_count - v_cafe.stamps_needed));
end $function$;

-- load_wallet: räknar med överskott, visar aktiv bonus och tar med ställen
-- där kunden har en bonus men ännu inga stämplar.
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
      'pending', exists(
        select 1 from redemptions r
        where r.user_id = v_user_id and r.cafe_id = c.id and r.status = 'saved'
      ),
      'bonus_expires_at', (
        select min(b.expires_at) from stamp_bonuses b
        where b.user_id = v_user_id and b.cafe_id = c.id and b.used_at is null and b.expires_at > now()
      )
    ) as card
    from cafes c
    where c.active = true
      and (exists(select 1 from stamps s where s.user_id = v_user_id and s.cafe_id = c.id)
           or exists(select 1 from stamp_bonuses b
                      where b.user_id = v_user_id and b.cafe_id = c.id
                        and b.used_at is null and b.expires_at > now()))
  ) sub;

  return v_result;
end $function$;

-- merchant_redeem_by_code: sparar överskottet så att nästa kort börjar på det.
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
  v_carry := greatest(0, public.stamps_since_last_redeem(v_red.user_id, v_red.cafe_id) - coalesce(v_needed, 0));
  update redemptions set status = 'redeemed', redeemed_at = now(), carry_over = v_carry where id = v_red.id;
  return jsonb_build_object('ok', true, 'code', p_code, 'carry_over', v_carry);
end $function$;

-- merchant_stats / merchant_daily: räknar bara riktiga tryck (source = 'tap').
-- Bonusstämplar redovisas separat i merchant_campaign_stats.
create or replace function public.merchant_stats(p_token text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_cafe_id uuid := public.merchant_session_cafe(p_token);
begin
  if v_cafe_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_session');
  end if;
  return jsonb_build_object(
    'ok', true,
    'today',   (select count(*) from stamps where cafe_id = v_cafe_id and source = 'tap' and stamped_at >= date_trunc('day', now())),
    'week',    (select count(*) from stamps where cafe_id = v_cafe_id and source = 'tap' and stamped_at >= date_trunc('week', now())),
    'month',   (select count(*) from stamps where cafe_id = v_cafe_id and source = 'tap' and stamped_at >= date_trunc('month', now())),
    'total',   (select count(*) from stamps where cafe_id = v_cafe_id and source = 'tap'),
    'pending', (select count(*) from redemptions where cafe_id = v_cafe_id and status = 'saved'),
    'unique_customers_30d', (select count(distinct user_id) from stamps
                              where cafe_id = v_cafe_id and source = 'tap' and stamped_at > now() - interval '30 days'),
    'redeemed_30d', (select count(*) from redemptions
                      where cafe_id = v_cafe_id and status = 'redeemed' and redeemed_at > now() - interval '30 days')
  );
end $function$;

create or replace function public.merchant_daily(p_token text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_cafe_id uuid := public.merchant_session_cafe(p_token);
  v_result  jsonb;
begin
  if v_cafe_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_session');
  end if;
  select coalesce(jsonb_agg(row_to_json(d) order by d.day desc), '[]'::jsonb) into v_result from (
    select to_char(date_trunc('day', stamped_at), 'YYYY-MM-DD') as day, count(*) as stamps
    from stamps
    where cafe_id = v_cafe_id and source = 'tap' and stamped_at > now() - interval '30 days'
    group by date_trunc('day', stamped_at)
  ) d;
  return jsonb_build_object('ok', true, 'days', v_result);
end $function$;

-- 5. Nya RPC:er ---------------------------------------------------------------
-- Läget för hjulet: kan kunden snurra, oupphämtad vinst, aktiva bonusar, städer.
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
  select coalesce(jsonb_agg(jsonb_build_object('city', t.city, 'places', t.n) order by t.n desc, t.city), '[]'::jsonb)
    into v_cities
    from (select btrim(c.city) as city, count(*) as n
            from cafes c
           where c.active and c.wheel_enabled and nullif(btrim(c.city), '') is not null
           group by btrim(c.city)) t;

  select id into v_user_id from users where device_id = p_device_id;
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

-- Snurra: ett per enhet och svensk kalenderdag. Utfallet avgörs här.
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
    -- Inget att vinna i staden: snurret förbrukas inte.
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

-- Hämta vinsten: kunden väljer ett av de erbjudna ställena.
create or replace function public.claim_wheel_prize(p_device_id text, p_spin_id uuid, p_cafe_slug text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_user_id uuid;
  v_spin    wheel_spins%rowtype;
  v_cafe    cafes%rowtype;
  v_expires timestamptz;
begin
  select id into v_user_id from users where device_id = p_device_id;
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('tappass:wheel:' || p_device_id, 0));

  select * into v_spin from wheel_spins where id = p_spin_id and user_id = v_user_id for update;
  if not found or not v_spin.won then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_spin.claimed_cafe_id is not null then
    return jsonb_build_object('ok', false, 'error', 'already_claimed');
  end if;
  v_expires := public.sthlm_midnight(v_spin.spin_date + 3);
  if v_expires <= now() then
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;

  select * into v_cafe from cafes where slug = p_cafe_slug and active = true;
  if not found or not (v_cafe.id = any(v_spin.offers)) then
    return jsonb_build_object('ok', false, 'error', 'not_offered');
  end if;
  if exists (select 1 from stamp_bonuses b
              where b.user_id = v_user_id and b.cafe_id = v_cafe.id
                and b.used_at is null and b.expires_at > now()) then
    return jsonb_build_object('ok', false, 'error', 'bonus_exists');
  end if;

  insert into stamp_bonuses(user_id, cafe_id, spin_id, expires_at)
    values (v_user_id, v_cafe.id, v_spin.id, v_expires);
  update wheel_spins set claimed_cafe_id = v_cafe.id, claimed_at = now() where id = v_spin.id;

  return jsonb_build_object(
    'ok', true, 'cafe', row_to_json(v_cafe), 'expires_at', v_expires,
    'stamps', public.stamps_since_last_redeem(v_user_id, v_cafe.id));
end $function$;

-- Butikspanelen: kampanj- och bonusstämplar (utlovat i köpvillkoren § 5).
create or replace function public.merchant_campaign_stats(p_token text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_cafe_id uuid := public.merchant_session_cafe(p_token);
begin
  if v_cafe_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_session');
  end if;
  return jsonb_build_object(
    'ok', true,
    'bonus_stamps_30d', (select count(*) from stamps
                          where cafe_id = v_cafe_id and source = 'bonus' and stamped_at > now() - interval '30 days'),
    'bonus_stamps_total', (select count(*) from stamps where cafe_id = v_cafe_id and source = 'bonus'),
    'active_bonuses', (select count(*) from stamp_bonuses
                        where cafe_id = v_cafe_id and used_at is null and expires_at > now()),
    'new_customers_30d', (select count(*) from stamp_bonuses b
                           where b.cafe_id = v_cafe_id and b.used_at > now() - interval '30 days'
                             and not exists (select 1 from stamps s
                                              where s.user_id = b.user_id and s.cafe_id = b.cafe_id
                                                and s.stamped_at < b.used_at)),
    'carried_over_30d', (select coalesce(sum(carry_over), 0) from redemptions
                          where cafe_id = v_cafe_id and status = 'redeemed'
                            and redeemed_at > now() - interval '30 days')
  );
end $function$;

-- 6. Behörigheter ---------------------------------------------------------------
revoke all on function public.sthlm_today() from public, anon, authenticated;
revoke all on function public.sthlm_midnight(date) from public, anon, authenticated;
revoke all on function public.wheel_offer_json(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.sthlm_today(), public.sthlm_midnight(date),
  public.wheel_offer_json(uuid, uuid[]) to service_role;

revoke all on function public.wheel_status(text) from public;
revoke all on function public.spin_wheel(text, text) from public;
revoke all on function public.claim_wheel_prize(text, uuid, text) from public;
revoke all on function public.merchant_campaign_stats(text) from public;
grant execute on function public.wheel_status(text), public.spin_wheel(text, text),
  public.claim_wheel_prize(text, uuid, text), public.merchant_campaign_stats(text)
  to anon, authenticated, service_role;
