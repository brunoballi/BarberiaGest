-- ============================================================
-- 079 — PORT de Flowi.estudio 078_public_barber_photos.sql
-- Porte a BarberiaGest/Valhalla del 2026-10-15. NO SE APLICA SIN REVISION DE BRUNO.
-- Ver PORTING.md (turnero). Cambios respecto del original: chequeos NULL-safe
-- (is distinct from 'admin' / not coalesce(..., false)).
-- ============================================================

-- ============================================================
-- 078 — Foto del barbero en la reserva pública
-- ============================================================
-- profiles.avatar_url ya existe (071_barber_photos.sql, uso interno del
-- admin) -- esto solo la suma a la RPC pública que ya lista barberos para
-- reservar, para que el cliente vea con quién elige.
--
-- El drop es obligatorio: create or replace no puede cambiar el
-- RETURNS TABLE de una función existente (mismo gotcha de 062/065).
-- ============================================================

drop function if exists public.get_public_barbers(uuid);

create or replace function public.get_public_barbers(p_branch_id uuid)
returns table (id uuid, full_name text, avatar_url text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select distinct p.id, p.full_name, p.avatar_url
    from profiles p
    join barber_schedules bs on bs.barber_id = p.id and bs.mode = 'turno'
   where p.branch_id = p_branch_id
     and p.is_active
   order by p.full_name;
$function$;

grant execute on function public.get_public_barbers(uuid) to anon, authenticated;
