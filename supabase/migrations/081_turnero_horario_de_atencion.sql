-- ============================================================
-- 081 — PORT de Flowi.estudio 098_horario_de_atencion.sql
-- Porte a BarberiaGest/Valhalla del 2026-10-15. NO SE APLICA SIN REVISION DE BRUNO.
-- Ver PORTING.md (turnero). Cambios respecto del original: chequeos NULL-safe
-- (is distinct from 'admin' / not coalesce(..., false)).
-- ============================================================

-- ============================================================
-- 098 — Horario de atención por sucursal, en la tarjeta del selector
-- ============================================================
-- No existía ningún concepto de "horario de la sucursal": lo único
-- parecido son barber_schedules (por barbero, para calcular
-- disponibilidad de turnos), que no es lo mismo que "el local abre de
-- tal a tal". Se agrega un campo propio, cargado a mano por el admin
-- (no derivado de barber_schedules) para que el dato mostrado en
-- /reservar sea exactamente el que la barbería quiere mostrar.
--
-- Se guarda como jsonb en vez de una tabla aparte, siguiendo el mismo
-- patrón que el resto de la marca (062/097): todo pasa por
-- update_branch_branding en una sola llamada. Forma: array de 7
-- objetos {weekday, open, close}, weekday 0=domingo..6=sábado (mismo
-- criterio que barber_schedules y extract(dow)), open/close "HH:MM".
-- Un día en "00:00"/"00:00" se interpreta como cerrado ese día -- no
-- hace falta un booleano aparte, y así el default (todo en cero) ya es
-- un estado válido ("sin configurar todavía" = "no mostrar ese día").
--
-- 🔒 Mismo aviso de seguridad que 097: update_branch_branding suma un
-- parámetro más, lo que cambia su firma -- hay que dropear la vieja y
-- volver a revocar anon/public de la nueva (ver 069_revocar_anon_
-- update_branch_branding.sql), porque Supabase le da grant a anon por
-- default a toda función nueva del esquema public.
-- ============================================================

alter table branches
  add column if not exists business_hours jsonb not null default (
    '[
      {"weekday":0,"open":"00:00","close":"00:00"},
      {"weekday":1,"open":"00:00","close":"00:00"},
      {"weekday":2,"open":"00:00","close":"00:00"},
      {"weekday":3,"open":"00:00","close":"00:00"},
      {"weekday":4,"open":"00:00","close":"00:00"},
      {"weekday":5,"open":"00:00","close":"00:00"},
      {"weekday":6,"open":"00:00","close":"00:00"}
    ]'::jsonb
  );

comment on column branches.business_hours is
  'Horario de atención, cargado a mano en /admin/marca (no se deriva de barber_schedules). Array de 7 {weekday, open, close}, weekday 0=domingo..6=sabado, open/close "HH:MM". "00:00"/"00:00" = cerrado ese dia o sin configurar.';

-- ------------------------------------------------------------
-- list_public_branches() / get_public_branch(): suman business_hours
-- ------------------------------------------------------------
drop function if exists public.list_public_branches();
drop function if exists public.get_public_branch(uuid);

create or replace function public.list_public_branches()
returns table (
  id                  uuid,
  name                text,
  address             text,
  logo_url            text,
  welcome_title       text,
  welcome_description text,
  whatsapp_phone      text,
  latitude            numeric,
  longitude           numeric,
  business_hours      jsonb
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select b.id, b.name, b.address, b.logo_url, b.welcome_title,
         b.welcome_description, b.whatsapp_phone, b.latitude, b.longitude,
         b.business_hours
    from branches b
   where b.is_active
   order by b.name;
$function$;

create or replace function public.get_public_branch(p_branch_id uuid default null)
returns table (
  id                  uuid,
  name                text,
  address             text,
  logo_url            text,
  welcome_title       text,
  welcome_description text,
  whatsapp_phone      text,
  latitude            numeric,
  longitude           numeric,
  business_hours      jsonb
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select b.id, b.name, b.address, b.logo_url, b.welcome_title, b.welcome_description,
         b.whatsapp_phone, b.latitude, b.longitude, b.business_hours
    from branches b
   where b.is_active
     and (p_branch_id is null or b.id = p_branch_id)
   order by b.name
   limit 1;
$function$;

grant execute on function public.list_public_branches()  to anon, authenticated;
grant execute on function public.get_public_branch(uuid)  to anon, authenticated;

-- ------------------------------------------------------------
-- update_branch_branding(): suma p_business_hours
-- ------------------------------------------------------------
drop function if exists public.update_branch_branding(
  uuid, text, text, text, text, text, text, text, boolean, text, numeric, numeric
);

create or replace function public.update_branch_branding(
  p_branch_id                  uuid,
  p_name                       text,
  p_address                    text default null,
  p_logo_url                   text default null,
  p_welcome_title              text default null,
  p_welcome_description        text default null,
  p_whatsapp_phone             text default null,
  p_default_area_code          text default null,
  p_booking_header_enabled     boolean default false,
  p_booking_header_logo_url    text default null,
  p_latitude                   numeric default null,
  p_longitude                  numeric default null,
  p_business_hours             jsonb default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_area   text;
  v_digits text;
  v_phone  text;
  v_glued  text[];
begin
  if coalesce(
       (select role from profiles where profiles.id = auth.uid()) is distinct from 'admin'
       or not coalesce(current_admin_has_branch(p_branch_id) or p_branch_id = current_user_branch(), false),
       true
     )
  then
    raise exception 'Sin permisos para configurar esta sucursal';
  end if;

  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'El nombre de la barbería no puede quedar vacío';
  end if;

  -- Validación liviana: 7 días, mismo criterio que el resto de esta
  -- función (no se valida formato de texto libre como address/welcome_*,
  -- pero acá sí conviene: un array corrupto rompería la tarjeta pública).
  if p_business_hours is not null and jsonb_array_length(p_business_hours) <> 7 then
    raise exception 'El horario tiene que tener los 7 días de la semana';
  end if;

  v_area := nullif(regexp_replace(coalesce(p_default_area_code, ''), '[^0-9]', '', 'g'), '');
  if v_area is not null and length(v_area) not between 2 and 4 then
    raise exception 'El código de área tiene que tener entre 2 y 4 dígitos: %', v_area;
  end if;

  if p_whatsapp_phone is not null and btrim(p_whatsapp_phone) <> '' then
    v_digits := regexp_replace(p_whatsapp_phone, '[^0-9]', '', 'g');

    if v_digits like '0054%' then v_digits := substr(v_digits, 5); end if;
    if v_digits like '54%'   then v_digits := substr(v_digits, 3); end if;
    if v_digits like '0%'    then v_digits := regexp_replace(v_digits, '^0+', ''); end if;

    v_glued := regexp_match(v_digits, '^(\d{2,4})15(\d{6,8})$');
    if v_glued is not null then v_digits := v_glued[1] || v_glued[2]; end if;

    if length(v_digits) = 11 and v_digits like '9%' then v_digits := substr(v_digits, 2); end if;

    if length(v_digits) between 6 and 8 then
      if v_area is null then
        raise exception 'Falta el código de área. Escribilo junto al número (ej: 3417505219), o cargá primero el código de área por defecto de la sucursal.';
      end if;
      v_digits := v_area || v_digits;
    end if;

    if length(v_digits) <> 10 then
      raise exception 'Número de WhatsApp inválido (quedaron % dígitos entre área y número, se esperan 10): %', length(v_digits), p_whatsapp_phone;
    end if;

    v_phone := '549' || v_digits;
  end if;

  if coalesce(p_booking_header_enabled, false) and exists (
    select 1 from branches
     where booking_header_enabled
       and id <> p_branch_id
  ) then
    raise exception 'Ya hay otra sucursal marcada para el encabezado de la reserva. Sacale esa marca ahí antes de asignarla acá.';
  end if;

  update branches
     set name                      = btrim(p_name),
         address                   = nullif(btrim(coalesce(p_address, '')), ''),
         logo_url                  = nullif(btrim(coalesce(p_logo_url, '')), ''),
         welcome_title             = nullif(btrim(coalesce(p_welcome_title, '')), ''),
         welcome_description       = nullif(btrim(coalesce(p_welcome_description, '')), ''),
         whatsapp_phone            = v_phone,
         default_area_code         = v_area,
         booking_header_enabled    = coalesce(p_booking_header_enabled, false),
         booking_header_logo_url   = nullif(btrim(coalesce(p_booking_header_logo_url, '')), ''),
         latitude                  = p_latitude,
         longitude                 = p_longitude,
         business_hours            = coalesce(p_business_hours, business_hours)
   where id = p_branch_id;
end;
$function$;

revoke execute on function public.update_branch_branding(
  uuid, text, text, text, text, text, text, text, boolean, text, numeric, numeric, jsonb
) from anon, public;
grant execute on function public.update_branch_branding(
  uuid, text, text, text, text, text, text, text, boolean, text, numeric, numeric, jsonb
) to authenticated;
