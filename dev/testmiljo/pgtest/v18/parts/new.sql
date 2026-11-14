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

