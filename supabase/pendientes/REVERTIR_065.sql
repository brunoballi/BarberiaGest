-- ============================================================
-- REVERTIR la migracion 065 (cierre de escalada de privilegios)
-- ============================================================
-- Estado tomado de la base real de Valhalla el 2026-10-19, ANTES de aplicar la 065.
-- Usar solo si algo del uso normal del cliente se rompe despues de aplicarla.
-- Deja la base como estaba (incluidos los agujeros que la 065 cierra), asi que despues de
-- revertir hay que investigar que fallo y volver a aplicar una 065 corregida.
-- Correr en una sola pasada (es transaccional) en el SQL Editor.
-- NOTA: si ya se aplicaron las migraciones 066+ (turnero), las politicas de la 086 usan
-- _admin_can_manage_branch: revertir primero esas (o no borrar el helper).
-- ============================================================
begin;

-- 1. calculate_settlement / recalculate_settlement_full: sacar los envoltorios y volver a
--    darle su nombre a las funciones originales (la 065 las renombro a _*_core).
drop function if exists public.calculate_settlement(uuid, uuid);
drop function if exists public.recalculate_settlement_full(uuid, uuid);
alter function public._calculate_settlement_core(uuid, uuid)        rename to calculate_settlement;
alter function public._recalculate_settlement_full_core(uuid, uuid) rename to recalculate_settlement_full;
-- Originalmente no tenian search_path fijado.
alter function public.calculate_settlement(uuid, uuid)        reset search_path;
alter function public.recalculate_settlement_full(uuid, uuid) reset search_path;

-- 2. Funciones reescritas por la 065, con su definicion anterior
CREATE OR REPLACE FUNCTION public.calculate_all_settlements(p_week_id uuid, p_barber_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_barber uuid;
  v_status text;
  v_count  integer := 0;
begin
  foreach v_barber in array coalesce(p_barber_ids, '{}'::uuid[]) loop
    -- Confirmada o pagada: se saltea. No se aborta el lote — el resto de los
    -- barberos de la semana se tienen que calcular igual.
    select status into v_status
    from settlements
    where week_id = p_week_id and barber_id = v_barber;

    if v_status is null or v_status = 'draft' then
      perform calculate_settlement(p_week_id, v_barber);
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_advance(p_advance_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_adv               advances%rowtype;
  v_week_id           uuid;
  v_settlement_status settlement_status;
  r                   record;
begin
  select * into v_adv from advances where id = p_advance_id;
  if not found then
    raise exception 'Adelanto % no encontrado', p_advance_id;
  end if;

  -- Idempotente: si ya está cancelado, no hace nada
  if v_adv.status = 'cancelled' then
    return;
  end if;

  -- Semana que contiene la fecha del adelanto (en su sucursal)
  select w.id into v_week_id
  from weeks w
  where w.branch_id = v_adv.branch_id
    and v_adv.advance_date between w.start_date and w.end_date
  limit 1;

  -- Si la liquidación de esa semana para el barbero está cerrada -> bloquear
  if v_week_id is not null then
    select status into v_settlement_status
    from settlements
    where week_id = v_week_id and barber_id = v_adv.barber_id;

    if v_settlement_status in ('confirmed', 'paid') then
      raise exception 'La liquidación de esa semana está confirmada/pagada. Volvé la liquidación a borrador para poder borrar el adelanto.';
    end if;
  end if;

  -- Cancelar el adelanto
  update advances set status = 'cancelled' where id = p_advance_id;

  -- Recalcular las liquidaciones en borrador del barbero (descuento global)
  for r in
    select week_id from settlements
    where barber_id = v_adv.barber_id and status = 'draft'
  loop
    perform calculate_settlement(r.week_id, v_adv.barber_id);
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_expense(p_expense_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  delete from expenses
  where id = p_expense_id and (auth.uid() = registered_by or exists(
    select 1 from profiles where id = auth.uid() and role = 'admin'
  ));
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_transaction_admin(p_tx_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_week   uuid;
  v_barber uuid;
  v_status settlement_status;
begin
  if (select auth_role()) <> 'admin' then
    raise exception 'Solo administradores pueden eliminar transacciones';
  end if;

  select week_id, barber_id into v_week, v_barber
  from transactions where id = p_tx_id;
  if not found then
    raise exception 'Transacción % no encontrada', p_tx_id;
  end if;

  delete from transactions where id = p_tx_id;

  -- Si ya existe una liquidación en borrador para ese barbero/semana, recalcularla.
  -- Las liquidaciones confirmadas/pagadas no se tocan (el admin debe anularlas primero).
  select status into v_status
  from settlements where week_id = v_week and barber_id = v_barber;
  if found and v_status = 'draft' then
    perform calculate_settlement(v_week, v_barber);
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_objetivo_pct(p_settlement_id uuid, p_pct numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_week_id   uuid;
  v_barber_id uuid;
  v_status    text;
begin
  select week_id, barber_id, status into v_week_id, v_barber_id, v_status
  from settlements where id = p_settlement_id;

  if v_week_id is null then
    raise exception 'Liquidación % no encontrada', p_settlement_id;
  end if;
  if v_status <> 'draft' then
    raise exception 'La liquidación está en estado "%"; el objetivo solo se puede editar en borrador', v_status;
  end if;

  update settlements set objetivo_pct = p_pct where id = p_settlement_id;

  perform public.calculate_settlement(v_week_id, v_barber_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_expense(p_expense_id uuid, p_concept text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_amount numeric DEFAULT NULL::numeric, p_expense_date date DEFAULT NULL::date, p_notes text DEFAULT NULL::text, p_partner_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
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
$function$;

-- 3. Politicas que la 065 elimino
drop policy if exists barber_update_own_profile on public.profiles;
create policy barber_update_own_profile on public.profiles as permissive for update to authenticated using (((( SELECT auth_role() AS auth_role) = 'barber'::user_role) AND (id = ( SELECT auth.uid() AS uid)))) with check ((id = ( SELECT auth.uid() AS uid)));
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles as permissive for update to authenticated using ((id = ( SELECT auth.uid() AS uid))) with check ((id = ( SELECT auth.uid() AS uid)));
drop policy if exists transactions_barber_insert on public.transactions;
create policy transactions_barber_insert on public.transactions as permissive for insert to authenticated with check ((barber_id = ( SELECT auth.uid() AS uid)));

-- 4. Trigger y helper que creo la 065
drop trigger if exists trg_guard_profile_update on public.profiles;
drop function if exists public._guard_profile_update();
drop function if exists public._admin_can_manage_branch(uuid);

-- 5. Permisos de ejecucion tal como estaban (incluido PUBLIC y anon)
revoke all on function admin_delete_or_archive(text,uuid) from public, anon, authenticated, service_role;
grant execute on function admin_delete_or_archive(text,uuid) to authenticated, service_role;
revoke all on function admin_unarchive(text,uuid) from public, anon, authenticated, service_role;
grant execute on function admin_unarchive(text,uuid) to authenticated, service_role;
revoke all on function audit_log_trigger() from public, anon, authenticated, service_role;
grant execute on function audit_log_trigger() to public, anon, authenticated, service_role;
revoke all on function auth_branch_id() from public, anon, authenticated, service_role;
grant execute on function auth_branch_id() to public, anon, authenticated, service_role;
revoke all on function auth_role() from public, anon, authenticated, service_role;
grant execute on function auth_role() to public, anon, authenticated, service_role;
revoke all on function auto_close_expired_weeks() from public, anon, authenticated, service_role;
grant execute on function auto_close_expired_weeks() to public, anon, authenticated, service_role;
revoke all on function auto_open_next_week(uuid,date) from public, anon, authenticated, service_role;
grant execute on function auto_open_next_week(uuid,date) to public, anon, authenticated, service_role;
revoke all on function calculate_all_settlements(uuid,uuid[]) from public, anon, authenticated, service_role;
grant execute on function calculate_all_settlements(uuid,uuid[]) to authenticated, service_role;
revoke all on function calculate_settlement(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function calculate_settlement(uuid,uuid) to public, anon, authenticated, service_role;
revoke all on function cancel_advance(uuid) from public, anon, authenticated, service_role;
grant execute on function cancel_advance(uuid) to public, anon, authenticated, service_role;
revoke all on function create_admin_auth_user(uuid,text,text,text) from public, anon, authenticated, service_role;
grant execute on function create_admin_auth_user(uuid,text,text,text) to service_role;
revoke all on function create_expense(uuid,text,text,numeric,date,uuid,text) from public, anon, authenticated, service_role;
grant execute on function create_expense(uuid,text,text,numeric,date,uuid,text) to public, anon, authenticated, service_role;
revoke all on function create_year(uuid,integer) from public, anon, authenticated, service_role;
grant execute on function create_year(uuid,integer) to public, anon, authenticated, service_role;
revoke all on function current_admin_has_branch(uuid) from public, anon, authenticated, service_role;
grant execute on function current_admin_has_branch(uuid) to public, anon, authenticated, service_role;
revoke all on function current_user_branch() from public, anon, authenticated, service_role;
grant execute on function current_user_branch() to public, anon, authenticated, service_role;
revoke all on function current_user_role() from public, anon, authenticated, service_role;
grant execute on function current_user_role() to public, anon, authenticated, service_role;
revoke all on function delete_expense(uuid) from public, anon, authenticated, service_role;
grant execute on function delete_expense(uuid) to public, anon, authenticated, service_role;
revoke all on function delete_month_force(uuid) from public, anon, authenticated, service_role;
grant execute on function delete_month_force(uuid) to public, anon, authenticated, service_role;
revoke all on function delete_month_safe(uuid) from public, anon, authenticated, service_role;
grant execute on function delete_month_safe(uuid) to public, anon, authenticated, service_role;
revoke all on function delete_transaction_admin(uuid) from public, anon, authenticated, service_role;
grant execute on function delete_transaction_admin(uuid) to public, anon, authenticated, service_role;
revoke all on function delete_week_force(uuid) from public, anon, authenticated, service_role;
grant execute on function delete_week_force(uuid) to public, anon, authenticated, service_role;
revoke all on function delete_week_safe(uuid) from public, anon, authenticated, service_role;
grant execute on function delete_week_safe(uuid) to public, anon, authenticated, service_role;
revoke all on function delete_year_force(uuid,integer) from public, anon, authenticated, service_role;
grant execute on function delete_year_force(uuid,integer) to public, anon, authenticated, service_role;
revoke all on function delete_year_safe(uuid,integer) from public, anon, authenticated, service_role;
grant execute on function delete_year_safe(uuid,integer) to public, anon, authenticated, service_role;
revoke all on function get_barber_debt_summary(uuid) from public, anon, authenticated, service_role;
grant execute on function get_barber_debt_summary(uuid) to authenticated, service_role;
revoke all on function month_financials(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function month_financials(uuid,uuid) to authenticated, service_role;
revoke all on function recalculate_settlement_full(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function recalculate_settlement_full(uuid,uuid) to public, anon, authenticated, service_role;
revoke all on function report_by_period(uuid[],date,date) from public, anon, authenticated, service_role;
grant execute on function report_by_period(uuid[],date,date) to public, anon, authenticated, service_role;
revoke all on function reset_admin_password(uuid,text) from public, anon, authenticated, service_role;
grant execute on function reset_admin_password(uuid,text) to service_role;
revoke all on function set_objetivo_pct(uuid,numeric) from public, anon, authenticated, service_role;
grant execute on function set_objetivo_pct(uuid,numeric) to public, anon, authenticated, service_role;
revoke all on function set_transaction_snapshots() from public, anon, authenticated, service_role;
grant execute on function set_transaction_snapshots() to public, anon, authenticated, service_role;
revoke all on function set_updated_at() from public, anon, authenticated, service_role;
grant execute on function set_updated_at() to public, anon, authenticated, service_role;
revoke all on function transactions_require_lifetime_member() from public, anon, authenticated, service_role;
grant execute on function transactions_require_lifetime_member() to public, anon, authenticated, service_role;
revoke all on function update_expense(uuid,text,text,numeric,date,text,uuid) from public, anon, authenticated, service_role;
grant execute on function update_expense(uuid,text,text,numeric,date,text,uuid) to authenticated, service_role;
revoke all on function update_updated_at() from public, anon, authenticated, service_role;
grant execute on function update_updated_at() to public, anon, authenticated, service_role;

commit;
