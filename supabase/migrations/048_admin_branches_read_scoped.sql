-- ============================================================
-- admin_branches: acotar la lectura de admins a SUS sucursales
-- ============================================================
-- La 045 abrio el SELECT de admin_branches a cualquier admin sobre
-- TODAS las filas, para poder armar el selector de socios de una
-- sucursal. El efecto colateral fue que getMyBranches() (que hacia
-- un select sin filtro y confiaba en RLS para acotar) devolvia el
-- mapeo completo admin -> sucursal, y entonces un admin de una sola
-- sucursal veia todas en /admin/select-branch y en los combos.
--
-- El cliente ya filtra por admin_id, pero la policy tambien se acota
-- acá: un admin solo necesita ver quien mas tiene acceso a las
-- sucursales que el maneja (eso es lo que consume getPartnersByBranch,
-- que siempre pregunta por la sucursal seleccionada).
--
-- No rompe /admin/admins: esa pantalla lee via /api/admin-users con
-- service role, que no pasa por RLS.
--
-- admin_branches_self_read (admin_id = auth.uid()) se mantiene: las
-- policies se combinan con OR, asi que cada uno sigue viendo lo suyo.

drop policy if exists admin_branches_admin_read on public.admin_branches;

create policy admin_branches_admin_read on public.admin_branches
  for select
  to authenticated
  using (
    (select auth_role()) = 'admin'::user_role
    and current_admin_has_branch(branch_id)
  );
