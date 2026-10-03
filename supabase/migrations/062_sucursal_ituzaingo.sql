-- ============================================================
-- Alta de la sucursal Ituzaingó (cuarta sucursal)
-- Idempotente: se puede correr más de una vez sin duplicar nada.
--
-- Hace 4 cosas:
--   1. Crea la sucursal.
--   2. Se la asigna a Jesus Llanos y Ezequiel Canteros (admin_branches).
--   3. Crea su configuración inicial (maintenance_settings, igual que las otras).
--   4. Genera los meses y semanas desde octubre 2026, copiando el calendario
--      de San Juan para que las semanas coincidan con las demás sucursales.
-- Servicios, beneficios, barberos y socios quedan vacíos: los carga el admin.
-- ============================================================

do $$
declare
  v_branch uuid;
  v_ref    uuid := 'e0441e71-d0ec-47bf-99eb-95f08954449e'; -- San Juan (calendario de referencia)
  v_month  record;
  v_new_month uuid;
begin
  -- 1. Sucursal
  select id into v_branch from branches where name = 'Ituzaingó';
  if v_branch is null then
    insert into branches (name, address, is_active)
    values ('Ituzaingó', 'Ituzaingó 1314, S2000 Rosario, Santa Fe', true)
    returning id into v_branch;
  end if;

  -- 2. Administradores con acceso
  insert into admin_branches (admin_id, branch_id, granted_by)
  select p.id, v_branch, 'dc54f801-920b-4f02-a517-a4670bb025c6'
  from profiles p
  where p.id in (
    'f6a86f21-1cfc-4781-a6d1-8d2c7ea65a57',  -- Jesus Llanos
    'beda0f25-a567-45c0-9c5d-235faea0e7f6'   -- Ezequiel Canteros
  )
  on conflict (admin_id, branch_id) do nothing;

  -- 3. Configuración inicial
  insert into maintenance_settings (branch_id, min_approval_pct)
  values (v_branch, 100)
  on conflict (branch_id) do nothing;

  -- 4. Meses y semanas (octubre 2026 en adelante, todas abiertas)
  for v_month in
    select id, year, month
    from months
    where branch_id = v_ref and (year, month) >= (2026, 10)
    order by year, month
  loop
    if not exists (
      select 1 from months where branch_id = v_branch and year = v_month.year and month = v_month.month
    ) then
      insert into months (branch_id, year, month, status)
      values (v_branch, v_month.year, v_month.month, 'active')
      returning id into v_new_month;

      insert into weeks (branch_id, month_id, week_number, start_date, end_date, status)
      select v_branch, v_new_month, w.week_number, w.start_date, w.end_date, 'open'
      from weeks w
      where w.month_id = v_month.id
      order by w.week_number;
    end if;
  end loop;
end $$;
