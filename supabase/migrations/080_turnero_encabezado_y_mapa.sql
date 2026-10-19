-- ============================================================
-- 080 — PORT de Flowi.estudio 097_encabezado_y_mapa_reserva.sql
-- Porte a BarberiaGest/Valhalla del 2026-10-15. NO SE APLICA SIN REVISION DE BRUNO.
-- Ver PORTING.md (turnero). Cambios respecto del original: chequeos NULL-safe
-- (is distinct from 'admin' / not coalesce(..., false)).
-- ============================================================

-- ============================================================
-- 097 — Encabezado de marca y mapa en el selector de sucursales
-- ============================================================
-- Con 2+ sucursales activas, /reservar muestra primero un selector
-- ("¿A qué sucursal querés ir?") sin ningún encabezado propio: no hay logo,
-- no hay nombre de la barbería como marca general, no hay mapa. Cada
-- sucursal SÍ tiene su propia marca (062_branding_sucursal.sql), pero eso es
-- por sucursal -- no hay hoy un concepto de "marca general" del negocio.
--
-- En vez de crear una entidad nueva (tabla de organización), se resuelve
-- reusando una sucursal como fuente del encabezado general: el admin marca
-- UNA sola sucursal con booking_header_enabled, y esa es la que presta su
-- nombre/logo para el selector. Se puede usar el mismo logo_url que ya
-- tiene esa sucursal, o cargar uno aparte (booking_header_logo_url) solo
-- para esta pantalla, sin pisar el logo propio de la sucursal.
--
-- La exclusividad (una sola sucursal a la vez) se garantiza con un índice
-- único parcial, no solo a nivel aplicación: dos admins guardando al mismo
-- tiempo no pueden dejar dos sucursales marcadas.
--
-- De paso, se agregan latitude/longitude (nullable, sin geocoding
-- automático: el admin las pega desde Google Maps) para poder pintar las
-- tres sucursales en un mapa Leaflet/OpenStreetMap en esa misma pantalla.
--
-- 🔒 Nota de seguridad (ver 069_revocar_anon_update_branding.sql): acá se
-- le agregan 4 parámetros nuevos a update_branch_branding. Un
-- `create or replace function` con una lista de parámetros DISTINTA a la
-- que ya existe no reemplaza la función vieja -- crea una firma nueva, y
-- Supabase aplica su propio grant automático a `anon` a toda función nueva
-- del esquema public (comprobado en 069 contra la base real; el intento de
-- `alter default privileges` de 063 no lo evita). Por eso acá se dropea la
-- firma vieja de 8 parámetros Y se vuelve a revocar `anon`/`public`
-- explícitamente después de crear la de 12 -- exactamente el patrón de 069.
-- ============================================================

alter table branches
  add column if not exists booking_header_enabled  boolean not null default false,
  add column if not exists booking_header_logo_url  text,
  add column if not exists latitude                 numeric(9,6),
  add column if not exists longitude                numeric(9,6);

comment on column branches.booking_header_enabled is
  'Si es true, esta sucursal presta su nombre (welcome_title/name) y logo para el encabezado del selector de sucursales en /reservar. A lo sumo una sucursal activa puede tenerlo en true (ver branches_one_booking_header).';
comment on column branches.booking_header_logo_url is
  'Logo alternativo SOLO para el encabezado del selector de sucursales. Si es null, se usa logo_url (el logo propio de la sucursal).';
comment on column branches.latitude is
  'Latitud para el mapa de /reservar. Se carga a mano desde /admin/marca (Google Maps: click derecho sobre el punto -> copiar coordenadas).';
comment on column branches.longitude is
  'Longitud para el mapa de /reservar. Ver comentario de latitude.';

-- Exclusividad: como mucho una sucursal con booking_header_enabled = true.
-- Índice único parcial sobre una expresión constante: todas las filas que
-- matchean el where quedarían con el mismo valor indexado, así que una
-- segunda fila con booking_header_enabled = true rompe la unicidad.
drop index if exists branches_one_booking_header;
create unique index branches_one_booking_header
  on branches ((true))
  where booking_header_enabled;

-- ------------------------------------------------------------
-- get_booking_header(): título + logo para el encabezado del selector
-- ------------------------------------------------------------
-- Función nueva, sin `anon` en el ACL automático de Supabase, así que el
-- grant explícito de abajo SÍ hace falta (a diferencia de update_branch_
-- branding, acá el acceso de anon es el comportamiento correcto: la llama
-- /reservar sin sesión, igual que list_public_branches).
--
-- Devuelve 0 filas si ninguna sucursal está marcada -- la pantalla pública
-- cae al comportamiento de siempre (sin encabezado extra) sin configurar
-- nada, igual criterio que el resto de la marca (062).
create or replace function public.get_booking_header()
returns table (title text, logo_url text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(b.welcome_title, b.name), coalesce(b.booking_header_logo_url, b.logo_url)
    from branches b
   where b.is_active
     and b.booking_header_enabled
   limit 1;
$function$;

grant execute on function public.get_booking_header() to anon, authenticated;

-- ------------------------------------------------------------
-- list_public_branches() / get_public_branch(): suman latitude/longitude
-- ------------------------------------------------------------
-- El drop es obligatorio: create or replace no puede cambiar el tipo de
-- retorno de una función existente (mismo gotcha que 062 y 067). El acceso
-- de anon acá es correcto y ya era así -- se reafirma el grant nomás.
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
  longitude           numeric
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select b.id, b.name, b.address, b.logo_url, b.welcome_title,
         b.welcome_description, b.whatsapp_phone, b.latitude, b.longitude
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
  longitude           numeric
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select b.id, b.name, b.address, b.logo_url, b.welcome_title, b.welcome_description,
         b.whatsapp_phone, b.latitude, b.longitude
    from branches b
   where b.is_active
     and (p_branch_id is null or b.id = p_branch_id)
   order by b.name
   limit 1;
$function$;

grant execute on function public.list_public_branches()  to anon, authenticated;
grant execute on function public.get_public_branch(uuid)  to anon, authenticated;

-- ------------------------------------------------------------
-- update_branch_branding(): suma los 4 campos nuevos + chequeo de exclusividad
-- ------------------------------------------------------------
-- Firma vieja (8 parámetros, de 066/069) fuera -- ver nota de seguridad del
-- encabezado del archivo.
drop function if exists public.update_branch_branding(uuid, text, text, text, text, text, text, text);

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
  p_longitude                  numeric default null
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
  -- coalesce(..., true): ver 069 -- un NULL en la condición (por ejemplo,
  -- auth.uid() sin perfil) tiene que tratarse como "bloquear", no como
  -- "permitir" (un `IF NULL THEN` en PL/pgSQL no dispara).
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

  v_area := nullif(regexp_replace(coalesce(p_default_area_code, ''), '[^0-9]', '', 'g'), '');
  if v_area is not null and length(v_area) not between 2 and 4 then
    raise exception 'El código de área tiene que tener entre 2 y 4 dígitos: %', v_area;
  end if;

  -- ── Normalización del WhatsApp (sin cambios respecto de 069) ────────
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

  -- Chequeo de exclusividad ANTES del update: da un mensaje legible en vez
  -- de que el cliente reciba la violación cruda del índice único parcial
  -- (que igual queda como red de seguridad ante una carrera entre dos
  -- admins guardando al mismo tiempo).
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
         longitude                 = p_longitude
   where id = p_branch_id;
end;
$function$;

-- Re-blindaje explícito, igual que 069: no alcanza con NO otorgarle a
-- anon -- hay que revocárselo a mano porque el default del proyecto se lo
-- concede solo.
revoke execute on function public.update_branch_branding(
  uuid, text, text, text, text, text, text, text, boolean, text, numeric, numeric
) from anon, public;
grant execute on function public.update_branch_branding(
  uuid, text, text, text, text, text, text, text, boolean, text, numeric, numeric
) to authenticated;
