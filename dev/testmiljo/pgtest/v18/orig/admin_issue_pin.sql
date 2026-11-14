CREATE OR REPLACE FUNCTION public.admin_issue_pin(p_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
end $function$
