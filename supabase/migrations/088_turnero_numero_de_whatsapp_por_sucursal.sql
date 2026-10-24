-- ============================================================
-- 088 — PORT de Flowi.estudio 112_whatsapp_numero_por_sucursal.sql
-- Porte a BarberiaGest/Valhalla del 2026-10-15. NO SE APLICA SIN REVISION DE BRUNO.
-- Ver PORTING.md (turnero). Cambios respecto del original: chequeos NULL-safe
-- (is distinct from 'admin' / not coalesce(..., false)).
-- ============================================================

-- ============================================================
-- 112 — Número de WhatsApp (API de Meta) por sucursal
-- ============================================================
-- Hasta acá toda la instalación mandaba los avisos desde UN solo número
-- (WHATSAPP_PHONE_NUMBER_ID, variable de entorno). Una cadena con un número
-- por sucursal (caso Valhalla: 4 sucursales, 4 números) no se podía servir.
--
-- Ahora cada sucursal puede tener el suyo. Ojo con la diferencia:
--   · branches.whatsapp_phone        -> el número que ve el CLIENTE en la
--                                       reserva (botón wa.me). Ya existía.
--   · branches.whatsapp_phone_number_id -> el "Phone Number ID" de Meta,
--                                       desde el que SALEN los avisos
--                                       automáticos. Es un id interno de la
--                                       Cloud API, no el teléfono.
-- El token de acceso NO va acá: sigue siendo uno por instalación, en
-- WHATSAPP_ACCESS_TOKEN (un usuario del sistema de Meta puede tener varios
-- números asignados). El Phone Number ID no es un secreto: sin el token no
-- permite mandar nada.
--
-- Si una sucursal no tiene el suyo cargado, el servidor cae a la variable
-- de entorno WHATSAPP_PHONE_NUMBER_ID (instalaciones con un solo número).
-- En una instalación multi-número conviene NO definir esa variable, así una
-- sucursal sin configurar no manda desde el número de otra.
-- ============================================================

alter table public.branches
  add column if not exists whatsapp_phone_number_id text;

alter table public.branches
  drop constraint if exists branches_whatsapp_phone_number_id_formato;
alter table public.branches
  add constraint branches_whatsapp_phone_number_id_formato
  check (whatsapp_phone_number_id is null or whatsapp_phone_number_id ~ '^[0-9]{5,25}$');

-- Dos sucursales SÍ pueden compartir número (un cliente que atiende varias
-- sucursales con una sola línea): los estados de entrega se cruzan por el
-- id del mensaje (wamid), no por el número, así que no se confunden.

comment on column public.branches.whatsapp_phone_number_id is
  'Phone Number ID de la Cloud API de Meta desde el que salen los avisos automaticos de esta sucursal. Si es null se usa WHATSAPP_PHONE_NUMBER_ID del entorno.';

-- ------------------------------------------------------------
-- Escritura: función propia (no se toca update_branch_branding, que ya
-- tiene 13 parámetros y tres sobrecargas históricas).
-- ------------------------------------------------------------
create or replace function public.set_branch_whatsapp_sender(
  p_branch_id        uuid,
  p_phone_number_id  text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id text;
begin
  if not public._admin_can_manage_branch(p_branch_id) then
    raise exception 'Sin permisos para configurar esta sucursal';
  end if;

  v_id := nullif(btrim(coalesce(p_phone_number_id, '')), '');
  if v_id is not null and v_id !~ '^[0-9]{5,25}$' then
    raise exception 'El Phone Number ID tiene que ser solo números (5 a 25 dígitos)';
  end if;

  update branches set whatsapp_phone_number_id = v_id where id = p_branch_id;
end;
$function$;

revoke all on function public.set_branch_whatsapp_sender(uuid, text) from public, anon;
grant execute on function public.set_branch_whatsapp_sender(uuid, text) to authenticated;
