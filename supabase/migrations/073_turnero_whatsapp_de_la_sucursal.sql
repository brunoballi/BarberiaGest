-- ============================================================
-- 073 — PORT de Flowi.estudio 065_whatsapp_sucursal.sql
-- Porte a BarberiaGest/Valhalla del 2026-10-15. NO SE APLICA SIN REVISION DE BRUNO.
-- Ver PORTING.md (turnero). Cambios respecto del original: chequeos NULL-safe
-- (is distinct from 'admin' / not coalesce(..., false)).
-- ============================================================

-- ============================================================
-- 065 — Número de WhatsApp de la sucursal
--
-- Lo carga el admin en /admin/marca. La reserva pública lo usa para el
-- botón "Enviarme por WhatsApp": abre WhatsApp en el teléfono del cliente
-- con el detalle del turno ya escrito, dirigido a la barbería.
--
-- Es una solución puente, a propósito. Los recordatorios AUTOMÁTICOS
-- exigen la API de WhatsApp Business de Meta (Embedded Signup + App
-- Review), que es un trámite de semanas. Este campo sirve igual para esa
-- etapa: es el número que después se registra en Meta.
--
-- El número es público (aparece en la pantalla de reserva) y eso está
-- bien: es el contacto comercial de la barbería, no un dato sensible.
-- ============================================================

alter table branches
  add column if not exists whatsapp_phone text;

comment on column branches.whatsapp_phone is
  'Numero de WhatsApp de la barberia, en formato internacional sin + ni espacios (ej: 5491122334455). Lo usa el link wa.me de la reserva publica.';

-- ------------------------------------------------------------
-- Lectura pública: agrega el teléfono
-- ------------------------------------------------------------
drop function if exists public.get_public_branch(uuid);

create or replace function public.get_public_branch(p_branch_id uuid default null)
returns table (
  id                  uuid,
  name                text,
  address             text,
  logo_url            text,
  welcome_title       text,
  welcome_description text,
  whatsapp_phone      text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select b.id, b.name, b.address, b.logo_url, b.welcome_title,
         b.welcome_description, b.whatsapp_phone
    from branches b
   where b.is_active
     and (p_branch_id is null or b.id = p_branch_id)
   order by b.name
   limit 1;
$function$;

-- ------------------------------------------------------------
-- Escritura: mismo patrón de permisos que 062
-- ------------------------------------------------------------
create or replace function public.update_branch_branding(
  p_branch_id           uuid,
  p_name                text,
  p_address             text default null,
  p_logo_url            text default null,
  p_welcome_title       text default null,
  p_welcome_description text default null,
  p_whatsapp_phone      text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_phone text;
begin
  if (select role from profiles where profiles.id = auth.uid()) is distinct from 'admin'
     or not coalesce(current_admin_has_branch(p_branch_id) or p_branch_id = current_user_branch(), false) then
    raise exception 'Sin permisos para configurar esta sucursal';
  end if;

  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'El nombre de la barbería no puede quedar vacío';
  end if;

  -- Se normaliza acá y no solo en el frontend: wa.me rechaza el link si el
  -- número trae +, espacios, guiones o paréntesis, y este RPC es la única
  -- puerta de escritura. Dejarlo al navegador significaría confiar en él.
  v_phone := nullif(regexp_replace(coalesce(p_whatsapp_phone, ''), '[^0-9]', '', 'g'), '');

  if v_phone is not null and length(v_phone) < 8 then
    raise exception 'El número de WhatsApp es demasiado corto: %', v_phone;
  end if;

  update branches
     set name                = btrim(p_name),
         address             = nullif(btrim(coalesce(p_address, '')), ''),
         logo_url            = nullif(btrim(coalesce(p_logo_url, '')), ''),
         welcome_title       = nullif(btrim(coalesce(p_welcome_title, '')), ''),
         welcome_description = nullif(btrim(coalesce(p_welcome_description, '')), ''),
         whatsapp_phone      = v_phone
   where id = p_branch_id;
end;
$function$;

-- La firma vieja de 6 argumentos queda huérfana: si no se borra, Postgres
-- mantiene las dos sobrecargas y una llamada con 6 parámetros seguiría
-- pegándole a la vieja, que no toca whatsapp_phone.
drop function if exists public.update_branch_branding(uuid, text, text, text, text, text);

grant execute on function public.get_public_branch(uuid) to anon, authenticated;
grant execute on function public.update_branch_branding(uuid, text, text, text, text, text, text) to authenticated;
