-- ============================================================
-- 071 — PORT de Flowi.estudio 061_reserva_publica_multisucursal.sql
-- Porte a BarberiaGest/Valhalla del 2026-10-15. NO SE APLICA SIN REVISION DE BRUNO.
-- Ver PORTING.md (turnero). Cambios respecto del original: chequeos NULL-safe
-- (is distinct from 'admin' / not coalesce(..., false)).
-- ============================================================

-- ============================================================
-- TURNERO — reserva pública: soporte de varias sucursales
-- ============================================================
-- Hueco encontrado en la Fase 2: get_public_branch(), sin un p_branch_id,
-- devolvía "cualquier sucursal activa, la primera por orden alfabético"
-- (order by b.name limit 1). Con una sola sucursal eso es invisible y
-- funciona bien; con dos o más, todo cliente que entraba a /reservar veía
-- siempre la misma sucursal, sin ninguna forma de elegir o de llegar a la
-- otra por URL.
--
-- Esta migración no toca get_public_branch(p_branch_id) -- sigue siendo la
-- forma de resolver UNA sucursal puntual por id, y de validar que un id que
-- venga por URL (?sucursal=...) sea realmente una sucursal activa. Agrega
-- list_public_branches(), que el frontend usa para decidir: una sola
-- sucursal activa -> sigue andando exactamente igual que hoy, cero fricción.
-- Dos o más -> se muestra un selector antes de mostrar servicios.
-- ============================================================

create or replace function public.list_public_branches()
returns table (id uuid, name text, address text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select b.id, b.name, b.address
    from branches b
   where b.is_active
   order by b.name;
$function$;

grant execute on function public.list_public_branches() to anon, authenticated;
