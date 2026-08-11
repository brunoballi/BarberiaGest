-- ============================================================
-- RETIROS DE SOCIOS: identificar al socio que retira
-- ============================================================
-- Los retiros de socios siguen viviendo en expenses con
-- category = 'retiro_socio' (decision ya tomada en PLAN_4_MEJORAS:
-- no se crea tabla aparte). Se suma partner_id para saber QUIEN
-- retiro y poder desglosar por socio en Reportes.
--
-- IMPORTANTE: month_financials() excluye los retiros por CATEGORIA
-- (category is distinct from 'retiro_socio'). Esta migracion no
-- cambia la categoria ni mueve las filas, asi que ese calculo
-- (ganancia neta / saldo del mes) queda intacto.

alter table public.expenses
  add column if not exists partner_id uuid references public.profiles(id);

create index if not exists idx_expenses_partner on public.expenses(partner_id);

-- ── update_expense: sumar p_partner_id ────────────────────────
-- Hay que dropear primero: agregar un parametro cambia la firma, y
-- 'create or replace' dejaria las dos versiones conviviendo como
-- sobrecargas (PostgREST no sabria cual invocar).
drop function if exists public.update_expense(uuid, text, text, numeric, date, text);

create or replace function public.update_expense(
  p_expense_id uuid,
  p_concept text default null,
  p_category text default null,
  p_amount numeric default null,
  p_expense_date date default null,
  p_notes text default null,
  p_partner_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- coalesce = semantica de patch: lo que no se manda, no se pisa.
  update expenses
  set
    concept      = coalesce(p_concept, concept),
    category     = coalesce(p_category, category),
    amount       = coalesce(p_amount, amount),
    expense_date = coalesce(p_expense_date, expense_date),
    notes        = coalesce(p_notes, notes),
    partner_id   = coalesce(p_partner_id, partner_id)
  where id = p_expense_id and (auth.uid() = registered_by or exists(
    select 1 from profiles where id = auth.uid() and role = 'admin'
  ));
end;
$$;

revoke all on function public.update_expense(uuid, text, text, numeric, date, text, uuid) from public, anon;
grant execute on function public.update_expense(uuid, text, text, numeric, date, text, uuid) to authenticated;
