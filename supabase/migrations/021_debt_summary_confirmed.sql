-- ============================================================
-- SALDO DEUDOR — Redefinición: la deuda es la liquidación CONFIRMADA sin pagar
-- ------------------------------------------------------------
-- Modelo correcto (definido con el cliente):
--   - Una liquidación negativa (net_payable < 0) en estado 'confirmed' = el
--     barbero DEBE esa plata. Aparece en "Saldo deudor" (reporte solo lectura).
--   - Al marcarla 'paid' desde Liquidaciones (con el pop-up de devolución) la
--     deuda queda SALDADA y desaparece del reporte. "Si está pagada, ya no debe."
--
-- Antes el RPC sumaba liquidaciones 'paid' (al revés). Ahora devuelve una fila
-- por liquidación confirmada con deuda, con la semana, para listarlas.
-- ============================================================

drop function if exists public.get_barber_debt_summary(uuid);

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
    and s.status = 'confirmed'
    and s.net_payable < 0
  order by w.start_date desc, p.full_name;
$function$;

grant execute on function public.get_barber_debt_summary(uuid) to anon, authenticated, service_role;
