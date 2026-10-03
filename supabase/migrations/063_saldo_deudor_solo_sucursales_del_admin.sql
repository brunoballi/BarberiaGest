-- ============================================================
-- Saldo deudor: solo para admins con acceso a la sucursal
--
-- get_barber_debt_summary es SECURITY DEFINER (se salta el RLS) y estaba
-- abierta a anon y a cualquier usuario autenticado: con un branch_id
-- devolvia nombres de barberos y deudas aunque quien llamara no tuviera
-- esa sucursal asignada. Ahora:
--   1. Solo devuelve filas si el usuario es admin con esa sucursal en
--      admin_branches (current_admin_has_branch).
--   2. Se le quita el EXECUTE a anon y a public.
-- La unica pantalla que la usa es Reportes (admin), que ya pide solo las
-- sucursales asignadas al admin, asi que no cambia nada para el uso normal.
-- ============================================================

create or replace function public.get_barber_debt_summary(p_branch_id uuid)
returns table(
  settlement_id uuid,
  barber_id     uuid,
  full_name     text,
  week_start    date,
  week_end      date,
  debt          numeric
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    s.id,
    s.barber_id,
    p.full_name,
    w.start_date,
    w.end_date,
    (-s.net_payable) as debt
  from settlements s
  join profiles p on p.id = s.barber_id
  join weeks w    on w.id = s.week_id
  where s.branch_id = p_branch_id
    and public.current_admin_has_branch(p_branch_id)
    and s.status = 'confirmed'
    and s.net_payable < 0
  order by w.start_date desc, p.full_name;
$function$;

revoke execute on function public.get_barber_debt_summary(uuid) from public, anon;
grant  execute on function public.get_barber_debt_summary(uuid) to authenticated, service_role;
