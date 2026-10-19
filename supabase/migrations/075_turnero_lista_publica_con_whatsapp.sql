-- ============================================================
-- 075 — PORT de Flowi.estudio 067_fix_list_public_branches_whatsapp.sql
-- Porte a BarberiaGest/Valhalla del 2026-10-15. NO SE APLICA SIN REVISION DE BRUNO.
-- Ver PORTING.md (turnero). Cambios respecto del original: chequeos NULL-safe
-- (is distinct from 'admin' / not coalesce(..., false)).
-- ============================================================

-- ============================================================
-- 067 — El botón de WhatsApp no aparecía: faltaba en la OTRA función
--
-- La reserva pública, con una sola sucursal activa (el caso real de este
-- deploy), no llama a get_public_branch(): llama a list_public_branches()
-- y usa la primera fila. La migración 065 solo le había agregado
-- whatsapp_phone a get_public_branch(); list_public_branches() se quedó
-- con la firma vieja, así que branch.whatsapp_phone llegaba undefined al
-- navegador y el botón nunca se mostraba, aunque el número estuviera bien
-- guardado en la base.
--
-- Verificado el bug reservando un turno de verdad en producción: con
-- whatsapp_phone cargado, la pantalla de confirmación no mostraba el botón.
-- ============================================================

drop function if exists public.list_public_branches();

create or replace function public.list_public_branches()
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
   order by b.name;
$function$;

grant execute on function public.list_public_branches() to anon, authenticated;
