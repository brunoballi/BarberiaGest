-- ============================================================
-- EXPENSE CRUD FUNCTIONS
-- Permite crear, editar y eliminar gastos desde la UI
-- ============================================================

-- Crear gasto
create or replace function create_expense(
  p_branch_id uuid,
  p_concept text,
  p_category text,
  p_amount numeric,
  p_expense_date date,
  p_week_id uuid default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expense_id uuid;
begin
  insert into expenses (
    branch_id, concept, category, amount, expense_date,
    week_id, notes, registered_by, paid_by
  ) values (
    p_branch_id, p_concept, p_category, p_amount, p_expense_date,
    p_week_id, p_notes, auth.uid(), auth.uid()
  )
  returning id into v_expense_id;

  return v_expense_id;
end;
$$;

-- Actualizar gasto
create or replace function update_expense(
  p_expense_id uuid,
  p_concept text,
  p_category text,
  p_amount numeric,
  p_expense_date date,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update expenses
  set
    concept = p_concept,
    category = p_category,
    amount = p_amount,
    expense_date = p_expense_date,
    notes = p_notes,
    updated_at = now()
  where id = p_expense_id;
end;
$$;

-- Eliminar gasto
create or replace function delete_expense(p_expense_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from expenses where id = p_expense_id;
end;
$$;

-- Permisos
revoke all on function public.create_expense(uuid, text, text, numeric, date, uuid, text) from public, anon;
revoke all on function public.update_expense(uuid, text, text, numeric, date, text) from public, anon;
revoke all on function public.delete_expense(uuid) from public, anon;

grant execute on function public.create_expense(uuid, text, text, numeric, date, uuid, text) to authenticated;
grant execute on function public.update_expense(uuid, text, text, numeric, date, text) to authenticated;
grant execute on function public.delete_expense(uuid) to authenticated;
