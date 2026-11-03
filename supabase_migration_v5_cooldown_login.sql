-- ═══════════════════════════════════════════════════════════════════════
-- TapPass v5 — väntetid per butik + säker butiksinloggning (2026-11-03)
-- STATUS: EJ KÖRD. Kräver v4 (körd). Kör HELA filen i Supabase SQL Editor.
--   Idempotent. Provkörd mot en kopia av live-schemat.
--
-- ⚠️ Den nya butikspanelen (tappass.se/m) måste publiceras direkt efter
--    körning: de gamla merchant_*-funktionerna (slug + PIN i varje anrop)
--    tas bort och ersätts av sessionsnycklar.
--
-- 1. Väntetid mellan stämplar per butik: cafes.stamp_cooldown_seconds,
--    10 s–24 h, standard 60 s. Butiken ändrar den själv i panelen.
--    tap_token svarar error "cooldown" + retry_after_seconds/_minutes.
--    Låser per enhet så att två samtidiga tryck inte båda räknas.
-- 2. Eget inloggningsnamn per butik (cafe_pins.login_name, standard = slug).
--    Ligger i den låsta tabellen — cafes är publikt läsbar.
-- 3. Inloggning ger en sessionsnyckel (30 dagar, sparas hashad). Panelen
--    sparar nyckeln i stället för PIN-koden.
-- 4. Spärr mot PIN-gissning på servern: 10 fel → ny inloggning låst 15 min.
--    Inloggade sessioner fungerar under spärren, så en angripare kan inte
--    låsa ute butiken.
-- 5. Butiken kan byta inloggningsnamn och PIN (6 siffror, inte triviala).
--    PIN-byte loggar ut övriga enheter.
-- 6. admin_issue_pin(slug): slumpad PIN vid onboarding / glömd PIN.
--    Körs bara från SQL Editor; PIN:en visas en gång och sparas aldrig i klartext.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1. Väntetid per butik ────────────────────────────────────────────
alter table public.cafes add column if not exists stamp_cooldown_seconds int not null default 60;
alter table public.cafes drop constraint if exists cafes_stamp_cooldown_range;
alter table public.cafes add constraint cafes_stamp_cooldown_range
  check (stamp_cooldown_seconds between 10 and 86400);

-- tap_token: live-versionen + enhetslås + väntetid (övrigt oförändrat)
create or replace function public.tap_token(p_device_id text, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user_id    uuid;
  v_cafe       cafes%rowtype;
  v_tag        tags%rowtype;
  v_pending    redemptions%rowtype;
  v_last_red   timestamptz;
  v_last_stamp timestamptz;
  v_wait       int;
  v_count      int;
  v_complete   boolean;
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

  -- NYTT: ett tryck i taget per enhet (stoppar dubbelräkning och dubbla användare)
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

  select coalesce(max(redeemed_at), 'epoch'::timestamptz) into v_last_red
    from redemptions where user_id = v_user_id and cafe_id = v_cafe.id and status = 'redeemed';

  -- NYTT: butikens väntetid sedan senaste stämpeln
  select max(stamped_at) into v_last_stamp from stamps
    where user_id = v_user_id and cafe_id = v_cafe.id;
  if v_last_stamp is not null
     and v_last_stamp + make_interval(secs => v_cafe.stamp_cooldown_seconds) > now() then
    v_wait := greatest(1, ceil(extract(epoch from
      v_last_stamp + make_interval(secs => v_cafe.stamp_cooldown_seconds) - now()))::int);
    select count(*) into v_count from stamps
      where user_id = v_user_id and cafe_id = v_cafe.id and stamped_at > v_last_red;
    return jsonb_build_object(
      'ok', false, 'error', 'cooldown', 'cafe', row_to_json(v_cafe), 'stamps', v_count,
      'retry_after_seconds', v_wait, 'retry_after_minutes', ceil(v_wait / 60.0)::int);
  end if;

  insert into stamps(user_id, cafe_id, tag_id) values (v_user_id, v_cafe.id, v_tag.id);

  select count(*) into v_count from stamps
    where user_id = v_user_id and cafe_id = v_cafe.id and stamped_at > v_last_red;
  v_complete := v_count >= v_cafe.stamps_needed;

  return jsonb_build_object('ok', true, 'cafe', row_to_json(v_cafe), 'stamps', v_count, 'complete', v_complete);
end $$;

-- ─── 2. Inloggningsnamn + spärrstatus (i låsta cafe_pins) ─────────────
alter table public.cafe_pins add column if not exists login_name text;
alter table public.cafe_pins add column if not exists failed_attempts int not null default 0;
alter table public.cafe_pins add column if not exists locked_until timestamptz;
update public.cafe_pins p set login_name = c.slug
  from public.cafes c where c.id = p.cafe_id and p.login_name is null;
alter table public.cafe_pins alter column login_name set not null;
alter table public.cafe_pins drop constraint if exists cafe_pins_login_name_format;
alter table public.cafe_pins add constraint cafe_pins_login_name_format
  check (login_name ~ '^[a-z0-9][a-z0-9._-]{2,31}$');
create unique index if not exists cafe_pins_login_name_key on public.cafe_pins(login_name);

-- ─── 3. Sessioner ─────────────────────────────────────────────────────
create table if not exists public.merchant_sessions (
  token_hash   text primary key,
  cafe_id      uuid not null references public.cafes(id) on delete cascade,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  expires_at   timestamptz not null
);
create index if not exists merchant_sessions_cafe_idx on public.merchant_sessions(cafe_id);
alter table public.merchant_sessions enable row level security;
revoke all on table public.merchant_sessions from public, anon, authenticated;

-- ─── Interna hjälpfunktioner (inte anropbara från klienter) ───────────
create or replace function public.merchant_token_hash(p_token text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
$$;

create or replace function public.merchant_pin_is_strong(p_pin text)
returns boolean
language sql
immutable
set search_path = public, extensions
as $$
  select coalesce(p_pin, '') ~ '^[0-9]{6}$'
     and p_pin !~ '^(.)\1{5}$'
     and p_pin not in ('012345', '123456', '234567', '345678', '456789',
                       '987654', '876543', '765432', '654321', '543210');
$$;

-- Giltig session → butikens id (förlänger sessionen högst en gång i timmen)
create or replace function public.merchant_session_cafe(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
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
    update merchant_sessions set last_used_at = now(), expires_at = now() + interval '30 days'
      where token_hash = v_hash;
  end if;
  return v_cafe_id;
end $$;

-- PIN-kontroll med spärr: 10 fel → låst 15 min. Raden låses (FOR UPDATE) så
-- att parallella gissningar inte kan passera spärren samtidigt.
create or replace function public.merchant_check_pin(p_cafe_id uuid, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row cafe_pins%rowtype;
begin
  select * into v_row from cafe_pins where cafe_id = p_cafe_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'bad_pin');
  end if;
  if v_row.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'locked',
      'retry_after_seconds', greatest(1, ceil(extract(epoch from v_row.locked_until - now()))::int));
  end if;
  if coalesce(v_row.pin_hash = crypt(coalesce(p_pin, ''), v_row.pin_hash), false) then
    update cafe_pins set failed_attempts = 0, locked_until = null where cafe_id = p_cafe_id;
    return jsonb_build_object('ok', true);
  end if;
  if v_row.failed_attempts + 1 >= 10 then
    update cafe_pins set failed_attempts = 0, locked_until = now() + interval '15 minutes'
      where cafe_id = p_cafe_id;
    return jsonb_build_object('ok', false, 'error', 'locked', 'retry_after_seconds', 900);
  end if;
  update cafe_pins set failed_attempts = failed_attempts + 1 where cafe_id = p_cafe_id;
  return jsonb_build_object('ok', false, 'error', 'bad_pin');
end $$;

revoke execute on function public.merchant_token_hash(text) from public, anon, authenticated;
revoke execute on function public.merchant_pin_is_strong(text) from public, anon, authenticated;
revoke execute on function public.merchant_session_cafe(text) from public, anon, authenticated;
revoke execute on function public.merchant_check_pin(uuid, text) from public, anon, authenticated;

-- ─── 4. Bort med de gamla PIN-i-varje-anrop-funktionerna ──────────────
drop function if exists public.merchant_login(text, text);
drop function if exists public.merchant_stats(text, text);
drop function if exists public.merchant_daily(text, text);
drop function if exists public.merchant_pending_list(text, text);
drop function if exists public.merchant_redeem_by_code(text, text, text);

-- ─── 5. Butikspanelens API ────────────────────────────────────────────
-- Inloggning. Okänt namn och fel PIN ger samma svar ("bad_login") och samma
-- svarstid, så att ingen kan pröva fram vilka inloggningsnamn som finns.
create function public.merchant_login(p_login text, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_cafe_id uuid;
  v_name    text;
  v_login   text;
  v_auth    jsonb;
  v_token   text;
begin
  select c.id, c.name, p.login_name into v_cafe_id, v_name, v_login
    from cafe_pins p join cafes c on c.id = p.cafe_id
    where p.login_name = lower(trim(coalesce(p_login, ''))) and c.active = true;
  if v_cafe_id is null then
    perform crypt(coalesce(p_pin, ''), gen_salt('bf'));
    return jsonb_build_object('ok', false, 'error', 'bad_login');
  end if;

  v_auth := public.merchant_check_pin(v_cafe_id, p_pin);
  if v_auth ->> 'error' = 'bad_pin' then
    return jsonb_build_object('ok', false, 'error', 'bad_login');
  elsif not (v_auth ->> 'ok')::boolean then
    return v_auth;  -- locked + retry_after_seconds
  end if;

  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into merchant_sessions(token_hash, cafe_id, expires_at)
    values (public.merchant_token_hash(v_token), v_cafe_id, now() + interval '30 days');
  update cafe_pins set last_login = now() where cafe_id = v_cafe_id;
  delete from merchant_sessions where expires_at < now();

  return jsonb_build_object('ok', true, 'token', v_token, 'cafe_name', v_name, 'login_name', v_login);
end $$;

create or replace function public.merchant_logout(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  delete from merchant_sessions where token_hash = public.merchant_token_hash(p_token);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.merchant_stats(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_cafe_id uuid := public.merchant_session_cafe(p_token);
begin
  if v_cafe_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_session');
  end if;
  return jsonb_build_object(
    'ok', true,
    'today',   (select count(*) from stamps where cafe_id = v_cafe_id and stamped_at >= date_trunc('day', now())),
    'week',    (select count(*) from stamps where cafe_id = v_cafe_id and stamped_at >= date_trunc('week', now())),
    'month',   (select count(*) from stamps where cafe_id = v_cafe_id and stamped_at >= date_trunc('month', now())),
    'total',   (select count(*) from stamps where cafe_id = v_cafe_id),
    'pending', (select count(*) from redemptions where cafe_id = v_cafe_id and status = 'saved'),
    'unique_customers_30d', (select count(distinct user_id) from stamps
                              where cafe_id = v_cafe_id and stamped_at > now() - interval '30 days'),
    'redeemed_30d', (select count(*) from redemptions
                      where cafe_id = v_cafe_id and status = 'redeemed' and redeemed_at > now() - interval '30 days')
  );
end $$;

create or replace function public.merchant_daily(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
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
    where cafe_id = v_cafe_id and stamped_at > now() - interval '30 days'
    group by date_trunc('day', stamped_at)
  ) d;
  return jsonb_build_object('ok', true, 'days', v_result);
end $$;

create or replace function public.merchant_pending_list(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_cafe_id uuid := public.merchant_session_cafe(p_token);
  v_result  jsonb;
begin
  if v_cafe_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_session');
  end if;
  select coalesce(jsonb_agg(row_to_json(r) order by r.saved_at desc), '[]'::jsonb) into v_result from (
    select redeem_code as code, saved_at,
      'Kund #' || substring(replace(user_id::text, '-', '') from 1 for 4) as customer_label
    from redemptions
    where cafe_id = v_cafe_id and status = 'saved'
  ) r;
  return jsonb_build_object('ok', true, 'pending', v_result);
end $$;

create or replace function public.merchant_redeem_by_code(p_token text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_cafe_id  uuid := public.merchant_session_cafe(p_token);
  v_red_id   uuid;
  v_red_cafe uuid;
begin
  if v_cafe_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_session');
  end if;
  select id, cafe_id into v_red_id, v_red_cafe from redemptions
    where redeem_code = p_code and status = 'saved'
    limit 1;
  if v_red_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_code');
  end if;
  if v_red_cafe <> v_cafe_id then
    return jsonb_build_object('ok', false, 'error', 'wrong_cafe');
  end if;
  update redemptions set status = 'redeemed', redeemed_at = now() where id = v_red_id;
  return jsonb_build_object('ok', true, 'code', p_code);
end $$;

create or replace function public.merchant_get_settings(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_cafe_id uuid := public.merchant_session_cafe(p_token);
  v_result  jsonb;
begin
  if v_cafe_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_session');
  end if;
  select jsonb_build_object(
      'ok', true, 'cafe_name', c.name, 'login_name', p.login_name,
      'stamp_cooldown_seconds', c.stamp_cooldown_seconds,
      'cooldown_min_seconds', 10, 'cooldown_max_seconds', 86400)
    into v_result
    from cafes c join cafe_pins p on p.cafe_id = c.id
    where c.id = v_cafe_id;
  return v_result;
end $$;

create or replace function public.merchant_set_cooldown(p_token text, p_seconds int)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_cafe_id uuid := public.merchant_session_cafe(p_token);
begin
  if v_cafe_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_session');
  end if;
  if p_seconds is null or p_seconds < 10 or p_seconds > 86400 then
    return jsonb_build_object('ok', false, 'error', 'invalid_cooldown',
      'min_seconds', 10, 'max_seconds', 86400);
  end if;
  update cafes set stamp_cooldown_seconds = p_seconds where id = v_cafe_id;
  return jsonb_build_object('ok', true, 'stamp_cooldown_seconds', p_seconds);
end $$;

create or replace function public.merchant_change_login(p_token text, p_pin text, p_new_login text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_cafe_id uuid := public.merchant_session_cafe(p_token);
  v_new     text := lower(trim(coalesce(p_new_login, '')));
  v_auth    jsonb;
begin
  if v_cafe_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_session');
  end if;
  v_auth := public.merchant_check_pin(v_cafe_id, p_pin);
  if not (v_auth ->> 'ok')::boolean then
    return v_auth;  -- bad_pin | locked
  end if;
  if v_new !~ '^[a-z0-9][a-z0-9._-]{2,31}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_login');
  end if;
  if exists (select 1 from cafe_pins where login_name = v_new and cafe_id <> v_cafe_id) then
    return jsonb_build_object('ok', false, 'error', 'login_taken');
  end if;
  begin
    update cafe_pins set login_name = v_new where cafe_id = v_cafe_id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'login_taken');
  end;
  return jsonb_build_object('ok', true, 'login_name', v_new);
end $$;

create or replace function public.merchant_change_pin(p_token text, p_pin text, p_new_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_cafe_id uuid := public.merchant_session_cafe(p_token);
  v_auth    jsonb;
begin
  if v_cafe_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_session');
  end if;
  v_auth := public.merchant_check_pin(v_cafe_id, p_pin);
  if not (v_auth ->> 'ok')::boolean then
    return v_auth;  -- bad_pin | locked
  end if;
  if not public.merchant_pin_is_strong(p_new_pin) then
    return jsonb_build_object('ok', false, 'error', 'weak_pin');
  end if;
  update cafe_pins set pin_hash = crypt(p_new_pin, gen_salt('bf')) where cafe_id = v_cafe_id;
  -- Logga ut alla andra enheter
  delete from merchant_sessions
    where cafe_id = v_cafe_id and token_hash <> public.merchant_token_hash(p_token);
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.merchant_login(text, text) to anon, authenticated;
grant execute on function public.merchant_logout(text) to anon, authenticated;
grant execute on function public.merchant_stats(text) to anon, authenticated;
grant execute on function public.merchant_daily(text) to anon, authenticated;
grant execute on function public.merchant_pending_list(text) to anon, authenticated;
grant execute on function public.merchant_redeem_by_code(text, text) to anon, authenticated;
grant execute on function public.merchant_get_settings(text) to anon, authenticated;
grant execute on function public.merchant_set_cooldown(text, int) to anon, authenticated;
grant execute on function public.merchant_change_login(text, text, text) to anon, authenticated;
grant execute on function public.merchant_change_pin(text, text, text) to anon, authenticated;

-- ─── 6. Onboarding / glömd PIN (bara SQL Editor) ──────────────────────
-- Användning:  select public.admin_issue_pin('butikens-slug');
-- Ger ny slumpad 6-siffrig PIN (visas EN gång — lämna den till butiken, spara
-- den aldrig i repo/chatt/dokument), skapar inloggning (namn = slug om ledigt)
-- och tagg <slug>-01 om de saknas, nollställer spärr och loggar ut alla enheter.
create or replace function public.admin_issue_pin(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
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
    where not exists (select 1 from tags where cafe_id = v_cafe.id);
  select token into v_tag from tags where cafe_id = v_cafe.id order by created_at limit 1;

  return jsonb_build_object('slug', v_cafe.slug, 'login_name', v_login, 'pin', v_pin, 'tag_token', v_tag);
end $$;
revoke execute on function public.admin_issue_pin(text) from public, anon, authenticated;
