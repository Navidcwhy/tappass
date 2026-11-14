-- ════════════════════════════════════════════════════════════════════
-- TapPass v15: Födelsedagspresent — kräver v14 (konto)
-- Butiken väljer själv om den erbjuder en present (panelen: text + valfritt värde).
-- Kunden anger dag och månad (aldrig året) på sitt konto. På födelsedagen och sex dagar
-- till får kunden presenten hos varje ställe som erbjuder den och där kunden stämplat
-- (riktig stämpling) senaste året. Presenten löses in som en belöning — med butikens
-- stämpel eller med en kod — men rör inte stämpelkortet.
--   cafes.birthday_text / birthday_value_kr   butikens present (null = erbjuds inte)
--   accounts.birth_month / birth_day / birthday_set_at
--   birthday_gifts                             en present per kund, ställe och år
--   account_set_birthday, birthday_status, birthday_claim, birthday_code,
--   redeem_birthday_by_tap                     appen
--   merchant_get_birthday, merchant_set_birthday   panelen
--   merchant_redeem_by_code, merchant_recent_redemptions   som v10 + presenterna
-- Fusk: födelsedagen måste vara sparad minst 30 dagar före födelsedagen (en ändring räknas
-- som ny), högst en present per ställe och år, och kunden måste ha stämplat hos stället.
-- Presentkoder börjar alltid med 0 — vanliga koder (gen_redeem_code) börjar aldrig med 0,
-- så de två slagen kan aldrig krocka och personalen skriver in båda i samma ruta.
-- Kan köras flera gånger.
-- ════════════════════════════════════════════════════════════════════

do $$
declare
  v_redeem text;
  v_recent text;
begin
  if to_regprocedure('public.account_link(text)') is null then
    raise exception 'Kör v14 först (supabase_migration_v14_konto.sql)';
  end if;
  select md5(prosrc) into v_redeem from pg_proc where oid = 'public.merchant_redeem_by_code(text,text)'::regprocedure;
  select md5(prosrc) into v_recent from pg_proc where oid = 'public.merchant_recent_redemptions(text)'::regprocedure;
  -- v10-versionerna (eller den här filens, om den redan körts)
  if v_redeem not in ('82149d260ec19df0356813b10b648b28', '882d170fef5c6af06f0f07032d12408a') then
    raise exception 'merchant_redeem_by_code är inte v10-versionen (md5 %) — jämför med produktion först', v_redeem;
  end if;
  if v_recent not in ('e343cd8ab0c2d24cb03467a9d858b5f2', '393d8ae8790c493b4470d3d767bd234b') then
    raise exception 'merchant_recent_redemptions är inte v10-versionen (md5 %) — jämför med produktion först', v_recent;
  end if;
end $$;

-- 1. Schema ------------------------------------------------------------------------
alter table public.cafes add column if not exists birthday_text text;
alter table public.cafes add column if not exists birthday_value_kr int;
alter table public.cafes drop constraint if exists cafes_birthday_check;
alter table public.cafes add constraint cafes_birthday_check check (
  (birthday_text is null or length(btrim(birthday_text)) between 2 and 60)
  and (birthday_value_kr is null or birthday_value_kr between 1 and 10000));

alter table public.accounts add column if not exists birth_month smallint;
alter table public.accounts add column if not exists birth_day smallint;
alter table public.accounts add column if not exists birthday_set_at timestamptz;
alter table public.accounts drop constraint if exists accounts_birthday_check;
alter table public.accounts add constraint accounts_birthday_check check (
  (birth_month is null and birth_day is null)
  or (birth_month between 1 and 12 and birth_day >= 1 and birth_day <=
      case when birth_month = 2 then 29 when birth_month in (4, 6, 9, 11) then 30 else 31 end));

create table if not exists public.birthday_gifts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  cafe_id      uuid not null references public.cafes(id) on delete cascade,
  gift_year    int not null,
  code         text not null unique check (code ~ '^0[0-9]{5}$'),
  status       text not null default 'saved' check (status in ('saved', 'redeemed')),
  reward_text  text not null,
  value_kr     int,
  valid_until  timestamptz not null,
  created_at   timestamptz not null default now(),
  redeemed_at  timestamptz,
  redeemed_via text check (redeemed_via in ('tap', 'code')),
  constraint birthday_gifts_one_per_year unique (user_id, cafe_id, gift_year)
);
create index if not exists birthday_gifts_cafe_idx on public.birthday_gifts (cafe_id, redeemed_at desc);
alter table public.birthday_gifts enable row level security;
revoke all on public.birthday_gifts from anon, authenticated;

-- 2. Hjälpfunktioner (stängda för klienter) -----------------------------------------
-- Födelsedagen ett visst år (29 februari firas 28 februari andra år)
create or replace function public.birthday_in_year(p_month int, p_day int, p_year int)
 returns date language sql immutable set search_path to 'public'
as $function$
  select case when p_month = 2 and p_day = 29
                   and not (p_year % 4 = 0 and (p_year % 100 <> 0 or p_year % 400 = 0))
              then make_date(p_year, 2, 28)
              else make_date(p_year, p_month, p_day) end;
$function$;

-- Pågående födelsedagsvecka: födelsedagens datum, eller null. Kräver konto med
-- födelsedag sparad minst 30 dagar före födelsedagen.
create or replace function public.birthday_window(p_user uuid, p_today date default null)
 returns date language plpgsql stable set search_path to 'public', 'extensions'
as $function$
declare
  v_acc   accounts%rowtype;
  v_today date := coalesce(p_today, public.sthlm_today());
  v_year  int;
  v_b     date;
begin
  select * into v_acc from accounts where user_id = p_user;
  if v_acc.birth_month is null then
    return null;
  end if;
  foreach v_year in array array[extract(year from v_today)::int, extract(year from v_today)::int - 1] loop
    v_b := public.birthday_in_year(v_acc.birth_month, v_acc.birth_day, v_year);
    if v_today between v_b and v_b + 6
       and (v_acc.birthday_set_at at time zone 'Europe/Stockholm')::date <= v_b - 30 then
      return v_b;
    end if;
  end loop;
  return null;
end $function$;

-- Nästa födelsedag som ger present (en pågående vecka räknas): minst 30 dagar efter att
-- födelsedagen sparades (p_set_on, svenskt datum).
create or replace function public.birthday_next_gift(p_month int, p_day int, p_set_on date, p_today date default null)
 returns date language plpgsql stable set search_path to 'public', 'extensions'
as $function$
declare
  v_today date := coalesce(p_today, public.sthlm_today());
  v_b     date;
begin
  if p_month is null then
    return null;
  end if;
  for v_year in extract(year from v_today)::int - 1 .. extract(year from v_today)::int + 2 loop
    v_b := public.birthday_in_year(p_month, p_day, v_year);
    if v_b + 6 >= v_today and v_b - 30 >= coalesce(p_set_on, v_today) then
      return v_b;
    end if;
  end loop;
  return null;
end $function$;

-- Ställen som ger kunden en present den här veckan: aktiva, erbjuder present och kunden
-- har minst en riktig stämpling där senaste året (räknat från födelsedagen).
create or replace function public.birthday_offers(p_user uuid)
 returns table (cafe_id uuid, birthday date)
 language sql stable set search_path to 'public', 'extensions'
as $function$
  select c.id, w.b
    from (select public.birthday_window(p_user) as b) w
    join cafes c on c.active and c.birthday_text is not null
   where w.b is not null
     and exists (select 1 from stamps s
                  where s.user_id = p_user and s.cafe_id = c.id and s.source = 'tap'
                    and s.stamped_at >= public.sthlm_midnight(w.b - 365));
$function$;

-- Presentkod: "0" + fem siffror, unik bland presenterna
create or replace function public.gen_gift_code()
 returns text language plpgsql set search_path to 'public', 'extensions'
as $function$
declare
  v_code  text;
  v_tries int := 0;
begin
  loop
    v_code := '0' || lpad(floor(random() * 100000)::int::text, 5, '0');
    if not exists (select 1 from birthday_gifts where code = v_code) then
      return v_code;
    end if;
    v_tries := v_tries + 1;
    if v_tries > 50 then
      raise exception 'Could not generate unique gift code';
    end if;
  end loop;
end $function$;

-- Presentens svar till appen
create or replace function public.birthday_gift_json(p_user uuid, p_cafe uuid, p_birthday date)
 returns jsonb language sql stable set search_path to 'public', 'extensions'
as $function$
  select jsonb_build_object(
    'cafe_slug', c.slug, 'cafe_name', c.name,
    'reward', coalesce(g.reward_text, c.birthday_text),
    'value_kr', coalesce(g.value_kr, c.birthday_value_kr),
    'status', case when g.status = 'redeemed' then 'redeemed' when g.status = 'saved' then 'saved' else 'available' end,
    'code', case when g.status = 'saved' then g.code end,
    'redeemed_at', g.redeemed_at,
    'valid_until', public.sthlm_midnight(p_birthday + 7))
  from cafes c
  left join birthday_gifts g on g.user_id = p_user and g.cafe_id = c.id and g.gift_year = extract(year from p_birthday)::int
  where c.id = p_cafe;
$function$;

-- 3. Appen -------------------------------------------------------------------------
-- Spara, ändra eller ta bort födelsedagen (dag + månad). Bara konton.
-- { ok, birthday: { month, day } | null, next_gift } eller { ok: false, error: not_linked | invalid_date }
create or replace function public.account_set_birthday(p_device_id text, p_month int, p_day int)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_acc accounts%rowtype;
begin
  select a.* into v_acc from accounts a join users u on u.id = a.user_id where u.device_id = p_device_id;
  if v_acc.auth_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_linked');
  end if;
  if p_month is null and p_day is null then
    update accounts set birth_month = null, birth_day = null, birthday_set_at = null where auth_uid = v_acc.auth_uid;
    return jsonb_build_object('ok', true, 'birthday', null, 'next_gift', null);
  end if;
  if p_month is null or p_day is null or p_month not between 1 and 12 or p_day < 1
     or p_day > (case when p_month = 2 then 29 when p_month in (4, 6, 9, 11) then 30 else 31 end) then
    return jsonb_build_object('ok', false, 'error', 'invalid_date');
  end if;
  if v_acc.birth_month is distinct from p_month or v_acc.birth_day is distinct from p_day then
    update accounts set birth_month = p_month, birth_day = p_day, birthday_set_at = now() where auth_uid = v_acc.auth_uid;
    v_acc.birthday_set_at := now();
  end if;
  return jsonb_build_object('ok', true, 'birthday', jsonb_build_object('month', p_month, 'day', p_day),
    'next_gift', public.birthday_next_gift(p_month, p_day, (v_acc.birthday_set_at at time zone 'Europe/Stockholm')::date));
end $function$;

-- Födelsedagen och veckans presenter.
-- { ok, linked, birthday: { month, day } | null, next_gift, window: { from, to } | null,
--   gifts: [{ cafe_slug, cafe_name, reward, value_kr, status: available|saved|redeemed, code, redeemed_at, valid_until }] }
create or replace function public.birthday_status(p_device_id text)
 returns jsonb language plpgsql stable security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_user  uuid;
  v_acc   accounts%rowtype;
  v_b     date;
  v_gifts jsonb;
begin
  select u.id into v_user from users u where u.device_id = p_device_id;
  select * into v_acc from accounts where user_id = v_user;
  if v_user is null or v_acc.auth_uid is null then
    return jsonb_build_object('ok', true, 'linked', false, 'birthday', null, 'window', null, 'gifts', '[]'::jsonb);
  end if;
  v_b := public.birthday_window(v_user);
  select coalesce(jsonb_agg(public.birthday_gift_json(v_user, o.cafe_id, o.birthday) order by c.name), '[]'::jsonb)
    into v_gifts
    from public.birthday_offers(v_user) o join cafes c on c.id = o.cafe_id;
  return jsonb_build_object('ok', true, 'linked', true,
    'birthday', case when v_acc.birth_month is null then null
                     else jsonb_build_object('month', v_acc.birth_month, 'day', v_acc.birth_day) end,
    'next_gift', case when v_acc.birth_month is null then null
                      else public.birthday_next_gift(v_acc.birth_month, v_acc.birth_day,
                             (v_acc.birthday_set_at at time zone 'Europe/Stockholm')::date) end,
    'window', case when v_b is null then null else jsonb_build_object('from', v_b, 'to', v_b + 6) end,
    'gifts', v_gifts);
end $function$;

-- Kunden trycker "Lös in": presenten får en kod (samma kod om den redan finns).
-- { ok, code, reward, valid_until } eller { ok: false, error: not_eligible | already_redeemed (+ redeemed_at) }
create or replace function public.birthday_claim(p_device_id text, p_cafe_slug text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_user uuid;
  v_cafe cafes%rowtype;
  v_b    date;
  v_gift birthday_gifts%rowtype;
begin
  select id into v_user from users where device_id = p_device_id;
  select * into v_cafe from cafes where slug = p_cafe_slug;
  if v_user is null or v_cafe.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_eligible');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tappass:tap:' || p_device_id, 0));
  select o.birthday into v_b from public.birthday_offers(v_user) o where o.cafe_id = v_cafe.id;
  if v_b is null then
    return jsonb_build_object('ok', false, 'error', 'not_eligible');
  end if;
  select * into v_gift from birthday_gifts where user_id = v_user and cafe_id = v_cafe.id and gift_year = extract(year from v_b)::int;
  if v_gift.status = 'redeemed' then
    return jsonb_build_object('ok', false, 'error', 'already_redeemed', 'redeemed_at', v_gift.redeemed_at);
  end if;
  if v_gift.id is null then
    insert into birthday_gifts(user_id, cafe_id, gift_year, code, reward_text, value_kr, valid_until)
      values (v_user, v_cafe.id, extract(year from v_b)::int, public.gen_gift_code(), v_cafe.birthday_text,
              v_cafe.birthday_value_kr, public.sthlm_midnight(v_b + 7))
      returning * into v_gift;
  end if;
  return jsonb_build_object('ok', true, 'code', v_gift.code, 'reward', v_gift.reward_text, 'valid_until', v_gift.valid_until);
end $function$;

-- Kodrutan frågar varannan sekund: { ok, code (null = ingen sparad), redeemed, redeemed_at }
create or replace function public.birthday_code(p_device_id text, p_cafe_slug text)
 returns jsonb language plpgsql stable security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_gift birthday_gifts%rowtype;
begin
  select g.* into v_gift
    from birthday_gifts g join users u on u.id = g.user_id join cafes c on c.id = g.cafe_id
   where u.device_id = p_device_id and c.slug = p_cafe_slug
   order by g.gift_year desc limit 1;
  return jsonb_build_object('ok', true,
    'code', case when v_gift.status = 'saved' and v_gift.valid_until > now() then v_gift.code end,
    'redeemed', v_gift.status = 'redeemed', 'redeemed_at', v_gift.redeemed_at);
end $function$;

-- Personalen håller butikens stämpel mot telefonen. Som redeem_by_tap: fel butiks stämpel
-- ger wrong_tag (expected/got). { ok, reward, redeemed_at, already? }
create or replace function public.redeem_birthday_by_tap(p_device_id text, p_cafe_slug text, p_token text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
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
  if v_tag.cafe_id <> v_cafe.id then
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
    update birthday_gifts set status = 'redeemed', redeemed_at = now(), redeemed_via = 'tap' where id = v_gift.id;
    return jsonb_build_object('ok', true, 'reward', v_gift.reward_text, 'redeemed_at', now());
  end if;
  -- Ingen kod sparad än: lös in direkt om kunden har en present hos stället den här veckan
  select o.birthday into v_b from public.birthday_offers(v_user) o where o.cafe_id = v_cafe.id;
  if v_b is null or exists (select 1 from birthday_gifts where user_id = v_user and cafe_id = v_cafe.id
                              and gift_year = extract(year from v_b)::int and status = 'redeemed') then
    return jsonb_build_object('ok', false, 'error', 'not_eligible');
  end if;
  insert into birthday_gifts(user_id, cafe_id, gift_year, code, status, reward_text, value_kr, valid_until, redeemed_at, redeemed_via)
    values (v_user, v_cafe.id, extract(year from v_b)::int, public.gen_gift_code(), 'redeemed', v_cafe.birthday_text,
            v_cafe.birthday_value_kr, public.sthlm_midnight(v_b + 7), now(), 'tap')
    on conflict (user_id, cafe_id, gift_year) do update
      set status = 'redeemed', redeemed_at = now(), redeemed_via = 'tap'
    returning * into v_gift;
  return jsonb_build_object('ok', true, 'reward', v_gift.reward_text, 'redeemed_at', v_gift.redeemed_at);
end $function$;

-- 4. Personalen: koden i panelen (som v10 + presentkoder) och "Senast inlösta" -------
create or replace function public.merchant_redeem_by_code(p_token text, p_code text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_cafe_id uuid := public.merchant_session_cafe(p_token);
  v_red     redemptions%rowtype;
  v_gift    birthday_gifts%rowtype;
  v_needed  int;
  v_carry   int;
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
    if v_gift.cafe_id <> v_cafe_id then
      return jsonb_build_object('ok', false, 'error', 'wrong_cafe');
    end if;
    if v_gift.valid_until <= now() then
      return jsonb_build_object('ok', false, 'error', 'expired');
    end if;
    update birthday_gifts set status = 'redeemed', redeemed_at = now(), redeemed_via = 'code' where id = v_gift.id;
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
    select * from (
      select redeemed_at, coalesce(redeemed_via, 'code') as via,
        'Kund #' || substring(replace(user_id::text, '-', '') from 1 for 4) as customer_label,
        coalesce(reward_name, public.reward_label(cafe_id, tier_at)) as reward
      from redemptions
      where cafe_id = v_cafe_id and status = 'redeemed' and redeemed_at > now() - interval '24 hours'
      union all
      select redeemed_at, coalesce(redeemed_via, 'code'),
        'Kund #' || substring(replace(user_id::text, '-', '') from 1 for 4),
        'Födelsedagspresent: ' || reward_text
      from birthday_gifts
      where cafe_id = v_cafe_id and status = 'redeemed' and redeemed_at > now() - interval '24 hours'
    ) x
    order by redeemed_at desc
    limit 10
  ) r;
  return jsonb_build_object('ok', true, 'recent', v_result);
end $function$;

-- 5. Panelen: butikens inställning --------------------------------------------------
-- { ok, text, value_kr, redeemed_30d, redeemed_total, upcoming_30d }
-- upcoming_30d = kunder som kommer att få presenten de närmaste 30 dagarna (bara antal).
create or replace function public.merchant_get_birthday(p_token text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_id    uuid := public.merchant_session_cafe(p_token);
  v_cafe  cafes%rowtype;
  v_today date := public.sthlm_today();
begin
  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_session');
  end if;
  select * into v_cafe from cafes where id = v_id;
  return jsonb_build_object('ok', true,
    'text', v_cafe.birthday_text,
    'value_kr', v_cafe.birthday_value_kr,
    'redeemed_30d', (select count(*) from birthday_gifts where cafe_id = v_id and status = 'redeemed'
                       and redeemed_at > now() - interval '30 days'),
    'redeemed_total', (select count(*) from birthday_gifts where cafe_id = v_id and status = 'redeemed'),
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
        and exists (select 1 from stamps s where s.user_id = n.user_id and s.cafe_id = v_id and s.source = 'tap'
                      and s.stamped_at >= public.sthlm_midnight(n.next_b - 365))));
end $function$;

-- Spara butikens present. Tom text = erbjuds inte. Värdet (kr) är valfritt.
-- Fel: invalid_text (2–60 tecken, inga styrtecken), invalid_value (1–10 000)
create or replace function public.merchant_set_birthday(p_token text, p_text text, p_value_kr int)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_id  uuid := public.merchant_session_cafe(p_token);
  v_txt text;
begin
  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_session');
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

-- 6. Behörigheter ------------------------------------------------------------------
revoke execute on function public.birthday_in_year(int, int, int) from public, anon, authenticated;
revoke execute on function public.birthday_window(uuid, date) from public, anon, authenticated;
revoke execute on function public.birthday_next_gift(int, int, date, date) from public, anon, authenticated;
revoke execute on function public.birthday_offers(uuid) from public, anon, authenticated;
revoke execute on function public.gen_gift_code() from public, anon, authenticated;
revoke execute on function public.birthday_gift_json(uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.account_set_birthday(text, int, int) to anon, authenticated;
grant execute on function public.birthday_status(text) to anon, authenticated;
grant execute on function public.birthday_claim(text, text) to anon, authenticated;
grant execute on function public.birthday_code(text, text) to anon, authenticated;
grant execute on function public.redeem_birthday_by_tap(text, text, text) to anon, authenticated;
grant execute on function public.merchant_get_birthday(text) to anon, authenticated;
grant execute on function public.merchant_set_birthday(text, text, int) to anon, authenticated;
