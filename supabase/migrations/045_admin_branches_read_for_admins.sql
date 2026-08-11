-- ============================================================
-- admin_branches: lectura para admins
-- ============================================================
-- Hasta ahora la unica policy de SELECT era admin_branches_self_read
-- (admin_id = auth.uid()), o sea que cada admin veia UNICAMENTE su
-- propia fila. Eso hace imposible armar desde el cliente cualquier
-- lista de "que admins tienen acceso a esta sucursal" — por ejemplo
-- el selector de socios en Retiros de socios, que salia con un solo
-- nombre.
--
-- No agrega exposicion real: un admin ya puede leer TODOS los
-- profiles (policy admin_all_profiles, FOR ALL), incluidos nombre y
-- rol. Esto solo le deja ver ademas el mapeo admin -> sucursal, que
-- es justamente lo que muestra la pantalla /admin/admins.
--
-- La policy vieja se mantiene: las policies se combinan con OR, asi
-- que un no-admin sigue viendo solo lo suyo.

create policy admin_branches_admin_read on public.admin_branches
  for select
  to authenticated
  using ((select auth_role()) = 'admin'::user_role);
