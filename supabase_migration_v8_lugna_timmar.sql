-- ════════════════════════════════════════════════════════════════════
-- TapPass v8: Lugna timmar
-- Butiken väljer dagar och tider (svensk tid) då varje stämpling ger 2 stämplar,
-- för att fylla timmar med få kunder. Ställs in i tappass.se/m.
--   cafes.quiet_hours  [{"days":[1..7] (ISO, 1 = måndag), "from":"HH:MM", "to":"HH:MM"}]
--                      högst 7 perioder; from < to samma dag ("to" får vara 24:00)
--   stamps.source      ny källa 'quiet' (extrastämpeln under en lugn timme)
--   tap_token          ger 'quiet'-stämpeln och svarar quiet_applied; hjulets
--                      dubbelstämpel används inte samtidigt (sparas till nästa besök)
--   merchant_get_quiet_hours / merchant_set_quiet_hours  panelens läs/skriv + statistik
-- Bakåtkompatibel: äldre appar ignorerar quiet_applied och visar 2 stämplar som vanligt.
-- Kan köras flera gånger. Hämta pg_get_functiondef('public.tap_token'::regproc) från
-- produktion och jämför med v6-versionen innan körning (tap_token skrivs om här).
-- ════════════════════════════════════════════════════════════════════

-- 1. Schema ------------------------------------------------------------------
alter table public.cafes add column if not exists quiet_hours jsonb not null default '[]'::jsonb;
alter table public.cafes drop constraint if exists cafes_quiet_hours_check;
alter table public.cafes add constraint cafes_quiet_hours_check
  check (jsonb_typeof(quiet_hours) = 'array' and jsonb_array_length(quiet_hours) <= 7);

alter table public.stamps drop constraint if exists stamps_source_check;
alter table public.stamps add constraint stamps_source_check check (source in ('tap', 'bonus', 'quiet'));

-- 2. Hjälpfunktioner -----------------------------------------------------------
-- Rensar och kontrollerar en inställning. null = ogiltig. Dagarna sorteras och
-- dubbletter tas bort.
create or replace function public.quiet_hours_clean(p_hours jsonb)
 returns jsonb language plpgsql immutable set search_path to 'public'
as $function$
declare
  v_out  jsonb := '[]'::jsonb;
  v_item jsonb;
  v_days int[];
  v_from text;
  v_to   text;
begin
  if p_hours is null or jsonb_typeof(p_hours) <> 'array' or jsonb_array_length(p_hours) > 7 then
    return null;
  end if;
  for v_item in select value from jsonb_array_elements(p_hours) loop
    if jsonb_typeof(v_item) <> 'object' or jsonb_typeof(v_item->'days') is distinct from 'array' then
      return null;
    end if;
    if exists (select 1 from jsonb_array_elements(v_item->'days') e
               where jsonb_typeof(e) <> 'number' or e::text !~ '^[1-7]$') then
      return null;
    end if;
    select array_agg(distinct (e::text)::int order by (e::text)::int) into v_days
      from jsonb_array_elements(v_item->'days') e;
    if v_days is null then
      return null;
    end if;
    v_from := v_item->>'from';
    v_to   := v_item->>'to';
    if coalesce(v_from, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or coalesce(v_to, '') !~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$'
       or v_from::time >= v_to::time then
      return null;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('days', to_jsonb(v_days), 'from', v_from, 'to', v_to));
  end loop;
  return v_out;
end $function$;

-- Är det lugn timme vid tidpunkten p_at (svensk tid, oberoende av databasens tidszon)?
create or replace function public.quiet_hours_active(p_hours jsonb, p_at timestamptz default now())
 returns boolean language sql stable set search_path to 'public'
as $function$
  select exists (
    select 1
    from jsonb_array_elements(case when jsonb_typeof(p_hours) = 'array' then p_hours else '[]'::jsonb end) h
    where (h->'days') @> to_jsonb(extract(isodow from (p_at at time zone 'Europe/Stockholm'))::int)
      and (p_at at time zone 'Europe/Stockholm')::time >= (h->>'from')::time
      and (p_at at time zone 'Europe/Stockholm')::time <  (h->>'to')::time
  );
$function$;

-- 3. Stämpling -----------------------------------------------------------------
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

  -- Lugna timmar (v8): butikens valda tider ger en extra stämpel (source = 'quiet').
  -- En trasig inställning får aldrig stoppa en stämpling.
  begin
    v_quiet := coalesce(public.quiet_hours_active(v_cafe.quiet_hours, now()), false);
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
    'carry_over', greatest(0, v_count - v_cafe.stamps_needed));
end $function$;

-- 4. Butikspanelen ---------------------------------------------------------------
create or replace function public.merchant_get_quiet_hours(p_token text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_cafe_id uuid := public.merchant_session_cafe(p_token);
  v_hours   jsonb;
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
    'visits_30d', (select count(*) from stamps where cafe_id = v_cafe_id and source = 'quiet'
                    and stamped_at > now() - interval '30 days'),
    'visits_total', (select count(*) from stamps where cafe_id = v_cafe_id and source = 'quiet'));
end $function$;

create or replace function public.merchant_set_quiet_hours(p_token text, p_hours jsonb)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_cafe_id uuid := public.merchant_session_cafe(p_token);
  v_clean   jsonb := public.quiet_hours_clean(p_hours);
begin
  if v_cafe_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_session');
  end if;
  if v_clean is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_quiet_hours', 'max_periods', 7);
  end if;
  update cafes set quiet_hours = v_clean where id = v_cafe_id;
  return jsonb_build_object('ok', true, 'quiet_hours', v_clean,
    'active_now', public.quiet_hours_active(v_clean, now()));
end $function$;

-- 5. Behörigheter ------------------------------------------------------------------
revoke execute on function public.quiet_hours_clean(jsonb) from public, anon, authenticated;
revoke execute on function public.quiet_hours_active(jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.merchant_get_quiet_hours(text) to anon, authenticated;
grant execute on function public.merchant_set_quiet_hours(text, jsonb) to anon, authenticated;
