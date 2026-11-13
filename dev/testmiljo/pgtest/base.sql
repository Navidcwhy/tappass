-- Kopia av live-schemat i produktion (hämtat 2026-11-04 via pg_get_functiondef / list_tables).
-- Endast det som v6 berör eller anropar.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema if not exists extensions;

create table public.cafes (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  type text not null,
  area text not null,
  symbol text not null default '',
  ink_color text not null default '#1B6371',
  soft_color text not null default '#D3E8EC',
  deep_color text not null default '#1B6371',
  reward_text text not null default '',
  reward_short text not null default '',
  stamps_needed integer not null constraint cafes_stamps_needed_check check (stamps_needed > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  stamp_cooldown_seconds integer not null default 60 constraint cafes_stamp_cooldown_range check (stamp_cooldown_seconds >= 10 and stamp_cooldown_seconds <= 86400)
);
create table public.tags (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references public.cafes(id) on delete cascade,
  token text not null unique,
  label text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.users (
  id uuid primary key default gen_random_uuid(),
  device_id text not null unique,
  created_at timestamptz not null default now()
);
create table public.stamps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  cafe_id uuid not null references public.cafes(id) on delete cascade,
  tag_id uuid references public.tags(id) on delete set null,
  stamped_at timestamptz not null default now()
);
create index stamps_user_cafe_idx on public.stamps (user_id, cafe_id, stamped_at desc);
create index stamps_cafe_time_idx on public.stamps (cafe_id, stamped_at desc);
create table public.redemptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  cafe_id uuid not null references public.cafes(id) on delete cascade,
  saved_at timestamptz,
  redeemed_at timestamptz,
  status text not null default 'saved' check (status = any (array['saved','redeemed','cancelled'])),
  redeem_code text unique
);
create index redemptions_user_cafe_idx on public.redemptions (user_id, cafe_id, status);
create unique index redemptions_one_saved_per_card on public.redemptions (user_id, cafe_id) where status = 'saved';
create table public.merchant_sessions (
  token_hash text primary key,
  cafe_id uuid not null references public.cafes(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  expires_at timestamptz not null
);

alter table public.cafes enable row level security;
alter table public.tags enable row level security;
alter table public.users enable row level security;
alter table public.stamps enable row level security;
alter table public.redemptions enable row level security;
alter table public.merchant_sessions enable row level security;
create policy cafes_read on public.cafes for select using (active = true);

-- ---------- funktioner (produktion, oförändrad logik) ----------
create or replace function public.stamps_since_last_redeem(p_user_id uuid, p_cafe_id uuid)
 returns integer language sql stable security definer set search_path to 'public', 'extensions'
as $function$
  select count(*)::int
    from stamps s
   where s.user_id = p_user_id
     and s.cafe_id = p_cafe_id
     and s.stamped_at > coalesce(
           (select max(r.redeemed_at) from redemptions r
             where r.user_id = p_user_id and r.cafe_id = p_cafe_id and r.status = 'redeemed'),
           'epoch'::timestamptz);
$function$;

create or replace function public.gen_redeem_code()
 returns text language plpgsql set search_path to 'public', 'extensions'
as $function$
declare
  v_code  text;
  v_tries int := 0;
begin
  loop
    v_code := (1 + floor(random() * 9))::int::text;
    for i in 1..5 loop
      v_code := v_code || floor(random() * 10)::int::text;
    end loop;
    if not exists (select 1 from redemptions where redeem_code = v_code) then
      return v_code;
    end if;
    v_tries := v_tries + 1;
    if v_tries > 50 then
      raise exception 'Could not generate unique code';
    end if;
  end loop;
end $function$;

create or replace function public.merchant_token_hash(p_token text)
 returns text language sql immutable set search_path to 'public', 'extensions'
as $function$
  select encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
$function$;

create or replace function public.merchant_session_cafe(p_token text)
 returns uuid language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
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
end $function$;

create or replace function public.tap_token(p_device_id text, p_token text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
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
end $function$;

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
      'stamps', (
        select count(*) from stamps s
        where s.user_id = v_user_id and s.cafe_id = c.id
          and s.stamped_at > coalesce(
            (select max(redeemed_at) from redemptions where user_id = v_user_id and cafe_id = c.id and status = 'redeemed'),
            'epoch'::timestamptz)
      ),
      'pending', exists(
        select 1 from redemptions r
        where r.user_id = v_user_id and r.cafe_id = c.id and r.status = 'saved'
      )
    ) as card
    from cafes c
    where exists(select 1 from stamps s where s.user_id = v_user_id and s.cafe_id = c.id)
      and c.active = true
  ) sub;
  return v_result;
end $function$;

create or replace function public.save_reward(p_device_id text, p_cafe_slug text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_user_id uuid;
  v_cafe    cafes%rowtype;
  v_code    text;
begin
  select id into v_user_id from users where device_id = p_device_id;
  select * into v_cafe from cafes where slug = p_cafe_slug;
  if v_user_id is null or v_cafe.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  select redeem_code into v_code from redemptions
    where user_id = v_user_id and cafe_id = v_cafe.id and status = 'saved'
    limit 1;
  if v_code is not null then
    return jsonb_build_object('ok', true, 'code', v_code);
  end if;
  if v_cafe.stamps_needed is null
     or public.stamps_since_last_redeem(v_user_id, v_cafe.id) < v_cafe.stamps_needed then
    return jsonb_build_object('ok', false, 'error', 'not_complete');
  end if;
  v_code := public.gen_redeem_code();
  insert into redemptions(user_id, cafe_id, saved_at, status, redeem_code)
    values (v_user_id, v_cafe.id, now(), 'saved', v_code);
  return jsonb_build_object('ok', true, 'code', v_code);
end $function$;

create or replace function public.current_saved_code(p_device_id text, p_cafe_slug text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_user_id uuid;
  v_cafe_id uuid;
  v_code    text;
begin
  select id into v_user_id from users where device_id = p_device_id;
  select id into v_cafe_id from cafes where slug = p_cafe_slug;
  if v_user_id is null or v_cafe_id is null then
    return jsonb_build_object('ok', false);
  end if;
  select redeem_code into v_code from redemptions
    where user_id = v_user_id and cafe_id = v_cafe_id and status = 'saved'
    limit 1;
  return jsonb_build_object('ok', true, 'code', v_code);
end $function$;

create or replace function public.merchant_redeem_by_code(p_token text, p_code text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
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
end $function$;

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
    where cafe_id = v_cafe_id and stamped_at > now() - interval '30 days'
    group by date_trunc('day', stamped_at)
  ) d;
  return jsonb_build_object('ok', true, 'days', v_result);
end $function$;

-- Behörigheter som i produktion
revoke all on function public.stamps_since_last_redeem(uuid, uuid) from public;
grant execute on function public.stamps_since_last_redeem(uuid, uuid) to service_role;
revoke all on function public.gen_redeem_code() from public;
revoke all on function public.merchant_token_hash(text) from public;
revoke all on function public.merchant_session_cafe(text) from public;
grant execute on function public.tap_token(text, text), public.load_wallet(text), public.save_reward(text, text),
  public.current_saved_code(text, text), public.merchant_redeem_by_code(text, text), public.merchant_stats(text),
  public.merchant_daily(text) to anon, authenticated, service_role;
