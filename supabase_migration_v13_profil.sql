-- ════════════════════════════════════════════════════════════════════
-- TapPass v13: Självservice-profil — kräver v12
-- TapPass skapar butiken (namn, slug, stad, antal stämplar, tagg och inloggning).
-- Butiken ändrar resten själv i panelen: typ, område, belöningens text, färg, logga,
-- adress, beskrivning, webbplats, Instagram och öppettider.
--   cafes.address / description / website / instagram / opening_hours / logo_version
--   cafe_logos                 loggan (PNG/JPEG/WebP, högst 200 kB) — ingen klientåtkomst
--   color_variants(ink)        soft_color/deep_color räknas fram ur butikens färg, så att
--                              äldre appbyggen (som använder dem) får matchande färger
--   opening_hours_clean        som quiet_hours_clean men upp till 14 perioder
--   merchant_get_profile / merchant_set_profile / merchant_set_logo   panelen
--   cafe_logo(slug)            appen hämtar loggan (publik, som namn och färg)
-- Antalet stämplar ändras fortfarande av TapPass: det påverkar kundernas pågående kort.
-- Kan köras flera gånger.
-- ════════════════════════════════════════════════════════════════════

do $$
begin
  if to_regprocedure('public.merchant_insights(text)') is null then
    raise exception 'Kör v12 först (supabase_migration_v12_insikter.sql)';
  end if;
end $$;

-- 1. Schema ------------------------------------------------------------------------
alter table public.cafes add column if not exists address text;
alter table public.cafes add column if not exists description text;
alter table public.cafes add column if not exists website text;
alter table public.cafes add column if not exists instagram text;
alter table public.cafes add column if not exists opening_hours jsonb not null default '[]'::jsonb;
alter table public.cafes add column if not exists logo_version int not null default 0;
alter table public.cafes add column if not exists profile_updated_at timestamptz;
alter table public.cafes drop constraint if exists cafes_profile_check;
alter table public.cafes add constraint cafes_profile_check check (
      coalesce(length(address), 0) <= 120
  and coalesce(length(description), 0) <= 160
  and coalesce(length(website), 0) <= 200
  and coalesce(length(instagram), 0) <= 30
  and jsonb_typeof(opening_hours) = 'array' and jsonb_array_length(opening_hours) <= 14
  and logo_version >= 0);

create table if not exists public.cafe_logos (
  cafe_id    uuid primary key references public.cafes(id) on delete cascade,
  mime       text not null check (mime in ('image/png', 'image/jpeg', 'image/webp')),
  data       bytea not null check (octet_length(data) between 1 and 200000),
  updated_at timestamptz not null default now()
);
alter table public.cafe_logos enable row level security;
revoke all on public.cafe_logos from anon, authenticated;

-- 2. Hjälpfunktioner (stängda för klienter) ------------------------------------------
create or replace function public.hsl_hex(p_h float8, p_s float8, p_l float8)
 returns text language plpgsql immutable set search_path to 'public'
as $function$
declare
  h float8 := p_h - 360 * floor(p_h / 360);
  c float8 := (1 - abs(2 * p_l - 1)) * p_s;
  x float8;
  m float8 := p_l - ((1 - abs(2 * p_l - 1)) * p_s) / 2;
  r float8; g float8; b float8;
begin
  x := c * (1 - abs((h / 60) - 2 * floor((h / 60) / 2) - 1));
  if h < 60 then r := c; g := x; b := 0;
  elsif h < 120 then r := x; g := c; b := 0;
  elsif h < 180 then r := 0; g := c; b := x;
  elsif h < 240 then r := 0; g := x; b := c;
  elsif h < 300 then r := x; g := 0; b := c;
  else r := c; g := 0; b := x;
  end if;
  return '#' || lpad(to_hex(greatest(0, least(255, round((r + m) * 255)))::int), 2, '0')
             || lpad(to_hex(greatest(0, least(255, round((g + m) * 255)))::int), 2, '0')
             || lpad(to_hex(greatest(0, least(255, round((b + m) * 255)))::int), 2, '0');
end $function$;

-- soft = ljus ton (bakgrund), deep = mörk ton (ytor med vit text) — som de handplockade
-- färgerna i äldre appbyggen. Gråa färger (låg mättnad) får ingen påhittad nyans.
create or replace function public.color_variants(p_ink text)
 returns jsonb language plpgsql immutable set search_path to 'public'
as $function$
declare
  r float8; g float8; b float8; mx float8; mn float8; d float8; h float8 := 0; s float8 := 0; l float8;
begin
  if p_ink is null or p_ink !~ '^#[0-9A-Fa-f]{6}$' then
    return null;
  end if;
  r := ('x' || substr(p_ink, 2, 2))::bit(8)::int / 255.0;
  g := ('x' || substr(p_ink, 4, 2))::bit(8)::int / 255.0;
  b := ('x' || substr(p_ink, 6, 2))::bit(8)::int / 255.0;
  mx := greatest(r, g, b); mn := least(r, g, b); l := (mx + mn) / 2; d := mx - mn;
  if d > 0 then
    s := d / (1 - abs(2 * l - 1));
    if mx = r then h := 60 * (((g - b) / d) - 6 * floor(((g - b) / d) / 6));
    elsif mx = g then h := 60 * ((b - r) / d + 2);
    else h := 60 * ((r - g) / d + 4);
    end if;
  end if;
  return jsonb_build_object(
    'ink',  upper(p_ink),
    'soft', upper(public.hsl_hex(h, case when s < 0.08 then s else least(s, 0.45) end, 0.91)),
    'deep', upper(public.hsl_hex(h, case when s < 0.08 then s else least(s, 0.60) end, 0.14)));
end $function$;

-- Öppettider: [{days: [1..7], from: "HH:MM", to: "HH:MM"}], högst 14, from < to ("24:00"
-- tillåtet). Öppet över midnatt skrivs som två perioder. null = ogiltig.
create or replace function public.opening_hours_clean(p_hours jsonb)
 returns jsonb language plpgsql immutable set search_path to 'public'
as $function$
declare
  v_out  jsonb := '[]'::jsonb;
  v_item jsonb;
  v_days int[];
  v_from text;
  v_to   text;
begin
  if p_hours is null or jsonb_typeof(p_hours) <> 'array' or jsonb_array_length(p_hours) > 14 then
    return null;
  end if;
  for v_item in select value from jsonb_array_elements(p_hours) loop
    if jsonb_typeof(v_item) <> 'object' or jsonb_typeof(v_item->'days') is distinct from 'array'
       or jsonb_array_length(v_item->'days') = 0 then
      return null;
    end if;
    if exists (select 1 from jsonb_array_elements(v_item->'days') e
               where jsonb_typeof(e) <> 'number' or e::text !~ '^[1-7]$') then
      return null;
    end if;
    select array_agg(distinct (e::text)::int order by (e::text)::int) into v_days
      from jsonb_array_elements(v_item->'days') e;
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

-- Kort fri text: trimmas, inga styrtecken, längd min..max. null = ogiltig.
create or replace function public.profile_text(p_value jsonb, p_min int, p_max int)
 returns text language sql immutable set search_path to 'public'
as $function$
  select case
    when jsonb_typeof(p_value) = 'null' and p_min = 0 then ''
    when jsonb_typeof(p_value) <> 'string' then null
    when btrim(p_value #>> '{}') ~ '[[:cntrl:]]' then null
    when length(btrim(p_value #>> '{}')) between p_min and p_max then btrim(p_value #>> '{}')
  end;
$function$;

-- 3. Panelen: läsa och spara profilen -----------------------------------------------
create or replace function public.merchant_get_profile(p_token text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_id   uuid := public.merchant_session_cafe(p_token);
  v_cafe cafes%rowtype;
  v_logo cafe_logos%rowtype;
begin
  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_session');
  end if;
  select * into v_cafe from cafes where id = v_id;
  select * into v_logo from cafe_logos where cafe_id = v_id;
  return jsonb_build_object(
    'ok', true,
    -- TapPass ändrar dessa
    'name', v_cafe.name, 'slug', v_cafe.slug, 'city', v_cafe.city, 'stamps_needed', v_cafe.stamps_needed,
    -- butiken ändrar resten
    'type', v_cafe.type, 'area', v_cafe.area,
    'reward_text', v_cafe.reward_text, 'reward_short', v_cafe.reward_short,
    'ink_color', v_cafe.ink_color,
    'address', coalesce(v_cafe.address, ''), 'description', coalesce(v_cafe.description, ''),
    'website', coalesce(v_cafe.website, ''), 'instagram', coalesce(v_cafe.instagram, ''),
    'opening_hours', v_cafe.opening_hours,
    'logo_version', v_cafe.logo_version,
    'logo', case when v_logo.cafe_id is not null
                 then jsonb_build_object('mime', v_logo.mime, 'data', encode(v_logo.data, 'base64')) end,
    'updated_at', v_cafe.profile_updated_at);
end $function$;

-- p_profile innehåller de fält som ska ändras (fält som saknas lämnas orörda):
--   type 1–30, area 1–40, reward_text 1–60, reward_short 1–40 tecken, ink_color "#RRGGBB",
--   address ≤ 120, description ≤ 160, website "" eller http(s)-adress ≤ 200,
--   instagram "" eller användarnamn (med eller utan @), opening_hours (se opening_hours_clean)
-- Fel: { ok: false, error: 'invalid_field', field }.
create or replace function public.merchant_set_profile(p_token text, p_profile jsonb)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_id     uuid := public.merchant_session_cafe(p_token);
  v_cafe   cafes%rowtype;
  v_txt    text;
  v_colors jsonb;
  v_hours  jsonb;
  f        record;
begin
  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_session');
  end if;
  if p_profile is null or jsonb_typeof(p_profile) <> 'object' then
    return jsonb_build_object('ok', false, 'error', 'invalid_field', 'field', 'profile');
  end if;
  select * into v_cafe from cafes where id = v_id for update;

  -- Textfälten: (nyckel, min, max)
  for f in select * from (values ('type', 1, 30), ('area', 1, 40), ('reward_text', 1, 60), ('reward_short', 1, 40),
                                 ('address', 0, 120), ('description', 0, 160)) as t(k, lo, hi) loop
    if p_profile ? f.k then
      v_txt := public.profile_text(p_profile->f.k, f.lo, f.hi);
      if v_txt is null then
        return jsonb_build_object('ok', false, 'error', 'invalid_field', 'field', f.k);
      end if;
      case f.k
        when 'type' then v_cafe.type := v_txt;
        when 'area' then v_cafe.area := v_txt;
        when 'reward_text' then v_cafe.reward_text := v_txt;
        when 'reward_short' then v_cafe.reward_short := v_txt;
        when 'address' then v_cafe.address := nullif(v_txt, '');
        when 'description' then v_cafe.description := nullif(v_txt, '');
      end case;
    end if;
  end loop;

  if p_profile ? 'website' then
    v_txt := public.profile_text(p_profile->'website', 0, 200);
    if v_txt is null or (v_txt <> '' and v_txt !~* '^https?://[^\s/?#]+\.[^\s/?#]+([/?#][^\s]*)?$') then
      return jsonb_build_object('ok', false, 'error', 'invalid_field', 'field', 'website');
    end if;
    v_cafe.website := nullif(v_txt, '');
  end if;

  if p_profile ? 'instagram' then
    v_txt := public.profile_text(p_profile->'instagram', 0, 31);
    if v_txt is null or (v_txt <> '' and v_txt !~ '^@?[A-Za-z0-9._]{1,30}$') then
      return jsonb_build_object('ok', false, 'error', 'invalid_field', 'field', 'instagram');
    end if;
    v_cafe.instagram := nullif(ltrim(v_txt, '@'), '');
  end if;

  if p_profile ? 'ink_color' then
    v_colors := public.color_variants(p_profile->>'ink_color');
    if jsonb_typeof(p_profile->'ink_color') <> 'string' or v_colors is null then
      return jsonb_build_object('ok', false, 'error', 'invalid_field', 'field', 'ink_color');
    end if;
    v_cafe.ink_color := v_colors->>'ink';
    v_cafe.soft_color := v_colors->>'soft';
    v_cafe.deep_color := v_colors->>'deep';
  end if;

  if p_profile ? 'opening_hours' then
    v_hours := public.opening_hours_clean(p_profile->'opening_hours');
    if v_hours is null then
      return jsonb_build_object('ok', false, 'error', 'invalid_field', 'field', 'opening_hours');
    end if;
    v_cafe.opening_hours := v_hours;
  end if;

  update cafes set type = v_cafe.type, area = v_cafe.area, reward_text = v_cafe.reward_text,
                   reward_short = v_cafe.reward_short, ink_color = v_cafe.ink_color,
                   soft_color = v_cafe.soft_color, deep_color = v_cafe.deep_color,
                   address = v_cafe.address, description = v_cafe.description, website = v_cafe.website,
                   instagram = v_cafe.instagram, opening_hours = v_cafe.opening_hours,
                   profile_updated_at = now()
   where id = v_id;
  return public.merchant_get_profile(p_token);
end $function$;

-- Loggan: base64 utan "data:"-prefix. p_data null = ta bort loggan.
create or replace function public.merchant_set_logo(p_token text, p_mime text, p_data text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_id   uuid := public.merchant_session_cafe(p_token);
  v_bin  bytea;
  v_ver  int;
begin
  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_session');
  end if;
  if p_data is null then
    delete from cafe_logos where cafe_id = v_id;
    update cafes set logo_version = 0, profile_updated_at = now() where id = v_id;
    return jsonb_build_object('ok', true, 'logo_version', 0);
  end if;
  if p_mime is null or p_mime not in ('image/png', 'image/jpeg', 'image/webp') or length(p_data) > 280000 then
    return jsonb_build_object('ok', false, 'error', 'invalid_logo');
  end if;
  begin
    v_bin := decode(p_data, 'base64');
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'invalid_logo');
  end;
  -- Filen måste vara det den säger sig vara (PNG, JPEG eller WebP) och högst 200 kB
  if octet_length(v_bin) < 12 or octet_length(v_bin) > 200000
     or (p_mime = 'image/png'  and substring(v_bin from 1 for 8) <> '\x89504e470d0a1a0a'::bytea)
     or (p_mime = 'image/jpeg' and substring(v_bin from 1 for 3) <> '\xffd8ff'::bytea)
     or (p_mime = 'image/webp' and (substring(v_bin from 1 for 4) <> '\x52494646'::bytea or substring(v_bin from 9 for 4) <> '\x57454250'::bytea)) then
    return jsonb_build_object('ok', false, 'error', 'invalid_logo');
  end if;
  insert into cafe_logos(cafe_id, mime, data, updated_at) values (v_id, p_mime, v_bin, now())
    on conflict (cafe_id) do update set mime = excluded.mime, data = excluded.data, updated_at = now();
  update cafes set logo_version = logo_version + 1, profile_updated_at = now() where id = v_id
    returning logo_version into v_ver;
  return jsonb_build_object('ok', true, 'logo_version', v_ver);
end $function$;

-- 4. Appen: loggan (publik) ---------------------------------------------------------
create or replace function public.cafe_logo(p_slug text)
 returns jsonb language plpgsql stable security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_cafe cafes%rowtype;
  v_logo cafe_logos%rowtype;
begin
  select * into v_cafe from cafes where slug = p_slug and active = true;
  if v_cafe.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  select * into v_logo from cafe_logos where cafe_id = v_cafe.id;
  if v_logo.cafe_id is null then
    return jsonb_build_object('ok', true, 'version', 0, 'mime', null, 'data', null);
  end if;
  return jsonb_build_object('ok', true, 'version', v_cafe.logo_version, 'mime', v_logo.mime,
                            'data', encode(v_logo.data, 'base64'));
end $function$;

-- 5. Behörigheter ------------------------------------------------------------------
revoke execute on function public.hsl_hex(float8, float8, float8) from public, anon, authenticated;
revoke execute on function public.color_variants(text) from public, anon, authenticated;
revoke execute on function public.opening_hours_clean(jsonb) from public, anon, authenticated;
revoke execute on function public.profile_text(jsonb, int, int) from public, anon, authenticated;
grant execute on function public.merchant_get_profile(text) to anon, authenticated;
grant execute on function public.merchant_set_profile(text, jsonb) to anon, authenticated;
grant execute on function public.merchant_set_logo(text, text, text) to anon, authenticated;
grant execute on function public.cafe_logo(text) to anon, authenticated;
