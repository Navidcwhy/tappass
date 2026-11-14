-- 2. Hjälpfunktioner (stängda för klienter) ----------------------------------------------------
-- Kortet som stämplar hos ett ställe räknas på: kedjan, eller stället självt.
create or replace function public.card_of(p_cafe uuid)
 returns uuid language sql stable set search_path to 'public'
as $function$
  select case when c.chain_id is not null and not c.own_card then c.chain_id else c.id end
    from cafes c where c.id = p_cafe;
$function$;

-- Ställena vars siffror en inloggning ser: huvudkontot = kedjans alla ställen (och sig självt),
-- annars stället självt.
create or replace function public.scope_places(p_cafe uuid)
 returns uuid[] language sql stable set search_path to 'public'
as $function$
  select case when c.is_chain then array(select x.id from cafes x where x.chain_id = c.id) || c.id
              else array[c.id] end
    from cafes c where c.id = p_cafe;
$function$;

-- Korten vars belöningar en inloggning löser in: huvudkontot = kedjans kort och ställen med eget
-- kort, ett ställe = kortet det stämplar på.
create or replace function public.scope_cards(p_cafe uuid)
 returns uuid[] language sql stable set search_path to 'public'
as $function$
  select case when c.is_chain then array(select x.id from cafes x where x.chain_id = c.id and x.own_card) || c.id
              else array[public.card_of(c.id)] end
    from cafes c where c.id = p_cafe;
$function$;

-- Stämpelns ställe: taggens ställe, annars stället i samma tryck (tappass.place, sätts av
-- tap_token_core – används av bonus- och inbjudningsstämplar), annars kortet. Ett ställe som
-- inte hör till kortet godtas aldrig.
create or replace function public.stamps_set_place()
 returns trigger language plpgsql set search_path to 'public'
as $function$
declare
  v uuid;
begin
  if new.place_id is null then
    select t.cafe_id into v from tags t where t.id = new.tag_id;
    if v is null then
      v := nullif(current_setting('tappass.place', true), '')::uuid;
    end if;
    if v is null or public.card_of(v) is distinct from new.cafe_id then
      v := new.cafe_id;
    end if;
    new.place_id := v;
  end if;
  return new;
end $function$;
drop trigger if exists stamps_place on public.stamps;
create trigger stamps_place before insert on public.stamps
  for each row execute function public.stamps_set_place();

-- 3. tappass.se/t/<token>: ställets namn, kortets belöning ------------------------------------
create or replace function public.tag_public_info(p_token text)
 returns jsonb language plpgsql stable security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_place cafes%rowtype;
  v_card  cafes%rowtype;
begin
  select c.* into v_place
    from tags t join cafes c on c.id = t.cafe_id
   where t.token = lower(coalesce(p_token, '')) and t.active = true and c.active = true;
  if v_place.id is null then
    return jsonb_build_object('ok', false);
  end if;
  select * into v_card from cafes where id = public.card_of(v_place.id) and active = true;
  if v_card.id is null then
    return jsonb_build_object('ok', false);
  end if;
  return jsonb_build_object('ok', true, 'name', v_place.name,
                            'reward_short', v_card.reward_short, 'stamps_needed', v_card.stamps_needed)
    || case when v_card.id <> v_place.id then jsonb_build_object('chain', v_card.name) else '{}'::jsonb end;
end $function$;

