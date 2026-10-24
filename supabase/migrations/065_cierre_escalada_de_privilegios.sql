-- ============================================================
-- 065 — Cierre de escalada de privilegios
-- ============================================================
-- port de Flowi.estudio 106_cierre_escalada_de_privilegios.sql (auditoría 2026-09-29),
-- ADAPTADO a la base real de Valhalla (consultada el 2026-10-15, solo lectura).
-- APLICADA a la base de Valhalla el 2026-10-19 (con backup previo y prueba de rollback forzado).
-- Para revertir: supabase/pendientes/REVERTIR_065.sql.
--
-- Qué hay en la base de Valhalla hoy (verificado):
--   · profiles tiene las políticas profiles_update_own y barber_update_own_profile,
--     y `authenticated` tiene UPDATE sobre profiles.role, id y branch_id. Con eso
--     un barbero puede hacerse admin: `update profiles set role='admin' where id = auth.uid()`.
--   · transactions tiene transactions_barber_insert (solo pide barber_id = auth.uid()),
--     que por ser permisiva se combina con OR y anula a barber_insert_own_transactions
--     (rol barbero + su sucursal + sin override manual).
--   · delete_expense, update_expense, cancel_advance, set_objetivo_pct,
--     calculate_all_settlements, calculate_settlement, recalculate_settlement_full y
--     auto_close_expired_weeks son SECURITY DEFINER sin chequeo de sucursal, y varias
--     (todas menos calculate_all_settlements y update_expense) tienen EXECUTE para anon.
--
-- Diferencias con la 106 de Flowi.estudio (por eso no es una copia):
--   · Se define _admin_can_manage_branch aquí (en Flowi viene de su 100). Usa
--     current_admin_has_branch, que SÍ existe en la base de Valhalla (pero no está en
--     ninguna migración del repo) y el mismo fallback a la sucursal del perfil.
--   · delete_expense y update_expense conservan lo que ya permiten (el que registró el
--     gasto, o un admin) y suman que el admin lo sea de ESA sucursal.
--   · cancel_advance, set_objetivo_pct y calculate_all_settlements se reescriben con el
--     cuerpo que tienen hoy en la base, más el chequeo.
--   · calculate_settlement y recalculate_settlement_full se RENOMBRAN a _*_core (conservan
--     el cuerpo vivo, que se reescribió muchas veces) y se les pone un envoltorio.
--   · NO incluye la sección 5 de la 106 (tope de largo de appointment_clients y buckets de
--     fotos/logos): Valhalla todavía no tiene turnero ni esos buckets. Va con el turnero.
--
-- Probar después de aplicar (con sesión de barbero, de admin de una sucursal y de admin
-- de otra):
--   1. barbero: update profiles set role='admin' where id = auth.uid()  -> error
--   2. barbero: cargar un corte desde la app del celular                -> anda
--   3. admin: editar un barbero (nombre, comisión, activo) desde Barberos -> anda
--   4. admin de la sucursal A: borrar/editar gasto y cancelar adelanto de la B -> error
--   5. admin: calcular liquidaciones de la semana, cambiar mantenimiento_pct   -> anda
--   6. anon (clave pública): rpc calculate_settlement / cancel_advance          -> permission denied
-- ============================================================

-- ── 0. Helper de sucursal ───────────────────────────────────────────────
create or replace function public._admin_can_manage_branch(p_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  -- coalesce en ambas puntas: si p_branch_id o la sucursal del perfil son NULL, la
  -- comparación da NULL y un `if not NULL` en plpgsql NO corta (deja pasar). Acá un
  -- NULL tiene que significar "no".
  select coalesce((select role = 'admin' from profiles where id = auth.uid()), false)
     and coalesce(current_admin_has_branch(p_branch_id) or p_branch_id = current_user_branch(), false);
$$;

revoke execute on function public._admin_can_manage_branch(uuid) from public, anon;
grant  execute on function public._admin_can_manage_branch(uuid) to authenticated;

-- ── 1. profiles ──────────────────────────────────────────────────────────
-- La app no usa estas políticas: el barbero no edita su perfil; el admin edita perfiles
-- con profiles_admin_update / admin_all_profiles o con las rutas /api (service role).
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "barber_update_own_profile" on public.profiles;

create or replace function public._guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- Sin sesión = service role (rutas /api del servidor) o postgres (migraciones).
  if auth.uid() is null then
    return new;
  end if;

  if new.id is distinct from old.id then
    raise exception 'No se puede cambiar el id de un perfil';
  end if;

  if new.role is distinct from old.role then
    raise exception 'El rol de un usuario no se puede cambiar desde acá';
  end if;

  if coalesce((select role = 'admin' from profiles where id = auth.uid()), false) then
    if new.branch_id is distinct from old.branch_id
       and not public._admin_can_manage_branch(new.branch_id) then
      raise exception 'No administrás la sucursal de destino';
    end if;
    return new;
  end if;

  raise exception 'Sin permisos para modificar perfiles';
end;
$$;

revoke execute on function public._guard_profile_update() from public, anon, authenticated;

drop trigger if exists trg_guard_profile_update on public.profiles;
create trigger trg_guard_profile_update
  before update on public.profiles
  for each row execute function public._guard_profile_update();

-- ── 2a. Gastos ───────────────────────────────────────────────────────────
-- Hoy: el que lo registró o cualquier admin (de cualquier sucursal). Ahora: el que lo
-- registró o el admin de la sucursal del gasto.
create or replace function public.delete_expense(p_expense_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  delete from expenses e
  where e.id = p_expense_id
    and (auth.uid() = e.registered_by or public._admin_can_manage_branch(e.branch_id));
end;
$$;

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
set search_path to 'public'
as $$
begin
  -- coalesce = semántica de patch: lo que no se manda, no se pisa.
  update expenses e
  set
    concept      = coalesce(p_concept, e.concept),
    category     = coalesce(p_category, e.category),
    amount       = coalesce(p_amount, e.amount),
    expense_date = coalesce(p_expense_date, e.expense_date),
    notes        = coalesce(p_notes, e.notes),
    partner_id   = coalesce(p_partner_id, e.partner_id)
  where e.id = p_expense_id
    and (auth.uid() = e.registered_by or public._admin_can_manage_branch(e.branch_id));
end;
$$;

revoke execute on function public.delete_expense(uuid) from public, anon;
grant  execute on function public.delete_expense(uuid) to authenticated;
revoke execute on function public.update_expense(uuid, text, text, numeric, date, text, uuid) from public, anon;
grant  execute on function public.update_expense(uuid, text, text, numeric, date, text, uuid) to authenticated;

-- ── 2b. Adelantos ────────────────────────────────────────────────────────
create or replace function public.cancel_advance(p_advance_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
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

  if not public._admin_can_manage_branch(v_adv.branch_id) then
    raise exception 'Sin permisos sobre esta sucursal';
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
$$;

revoke execute on function public.cancel_advance(uuid) from public, anon;
grant  execute on function public.cancel_advance(uuid) to authenticated;

-- ── 2c. Liquidaciones ────────────────────────────────────────────────────
create or replace function public.set_objetivo_pct(p_settlement_id uuid, p_pct numeric)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_week_id   uuid;
  v_barber_id uuid;
  v_branch    uuid;
  v_status    text;
begin
  select week_id, barber_id, branch_id, status
    into v_week_id, v_barber_id, v_branch, v_status
  from settlements where id = p_settlement_id;

  if v_week_id is null then
    raise exception 'Liquidación % no encontrada', p_settlement_id;
  end if;
  if not public._admin_can_manage_branch(v_branch) then
    raise exception 'Sin permisos sobre esta sucursal';
  end if;
  if v_status <> 'draft' then
    raise exception 'La liquidación está en estado "%"; el objetivo solo se puede editar en borrador', v_status;
  end if;

  update settlements set objetivo_pct = p_pct where id = p_settlement_id;

  perform public.calculate_settlement(v_week_id, v_barber_id);
end;
$$;

revoke execute on function public.set_objetivo_pct(uuid, numeric) from public, anon;
grant  execute on function public.set_objetivo_pct(uuid, numeric) to authenticated;

create or replace function public.calculate_all_settlements(p_week_id uuid, p_barber_ids uuid[])
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_barber uuid;
  v_status text;
  v_count  integer := 0;
begin
  if auth.uid() is not null
     and not public._admin_can_manage_branch((select branch_id from weeks where id = p_week_id)) then
    raise exception 'Sin permisos sobre esta sucursal';
  end if;

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
$$;

revoke execute on function public.calculate_all_settlements(uuid, uuid[]) from public, anon;
grant  execute on function public.calculate_all_settlements(uuid, uuid[]) to authenticated;

-- delete_transaction_admin (hallazgo de la consulta a la base, NO está en la 106 de Flowi):
-- tenía EXECUTE para anon y su chequeo era `if (select auth_role()) <> 'admin'`. Sin sesión
-- auth_role() es NULL, `NULL <> 'admin'` es NULL y el `if` no corta: la función seguía de
-- largo. Se usa `is distinct from`, se exige admin DE LA SUCURSAL del corte y se le saca
-- anon. Confirmado el 2026-10-15 con una prueba de rollback forzado: antes de la 065
-- anon borraba transacciones; después, permission denied.
--
-- PRUEBA HECHA (2026-10-15, rollback forzado en la base de Valhalla, nada persistido):
--   antes : barbero se hace admin = OK; anon calcula liquidaciones y borra cortes = OK;
--           un admin de otra sucursal calcula, borra gastos y cortes = OK.
--   después: barbero no puede cambiar su rol (0 filas); admin no cambia roles; anon =
--           permission denied en las 9 funciones; admin ajeno = "Sin permisos sobre esta
--           sucursal" en calcular, recalcular, objetivo_pct, cancelar adelanto y borrar corte;
--           el gasto de otra sucursal ya no se borra ni se edita; el admin de la sucursal,
--           el barbero sobre lo suyo y quien registró el gasto siguen pudiendo. Importes de
--           liquidación idénticos antes y después (99000.00 en el caso medido).
--   NO probado: alta de un corte por el barbero (política estricta, que la app ya cumple)
--           y auto_close_expired_weeks desde un programador externo, si existiera.
create or replace function public.delete_transaction_admin(p_tx_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_week   uuid;
  v_barber uuid;
  v_branch uuid;
  v_status settlement_status;
begin
  select week_id, barber_id, branch_id into v_week, v_barber, v_branch
  from transactions where id = p_tx_id;
  if not found then
    raise exception 'Transacción % no encontrada', p_tx_id;
  end if;

  if not public._admin_can_manage_branch(v_branch) then
    raise exception 'Solo administradores de la sucursal pueden eliminar transacciones';
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
$$;

revoke execute on function public.delete_transaction_admin(uuid) from public, anon;
grant  execute on function public.delete_transaction_admin(uuid) to authenticated;

-- calculate_settlement / recalculate_settlement_full: renombrar y envolver.
-- Los cuerpos vivos (snapshots de compensación, precio del clásico, VIP, bonos) quedan
-- intactos en _*_core. Los llamados internos por nombre pasan por el envoltorio, con la
-- sesión de quien llama, así que siguen andando.
alter function public.calculate_settlement(uuid, uuid)           rename to _calculate_settlement_core;
alter function public.recalculate_settlement_full(uuid, uuid)    rename to _recalculate_settlement_full_core;

alter function public._calculate_settlement_core(uuid, uuid)        set search_path to 'public';
alter function public._recalculate_settlement_full_core(uuid, uuid) set search_path to 'public';

revoke execute on function public._calculate_settlement_core(uuid, uuid)        from public, anon, authenticated;
revoke execute on function public._recalculate_settlement_full_core(uuid, uuid) from public, anon, authenticated;

create function public.calculate_settlement(p_week_id uuid, p_barber_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- Sin sesión = service role / cron. Con sesión: el propio barbero (la app la llama
  -- tras registrar un corte desde el celular) o el admin de la sucursal.
  if auth.uid() is not null
     and p_barber_id is distinct from auth.uid()
     and not public._admin_can_manage_branch((select branch_id from weeks where id = p_week_id)) then
    raise exception 'Sin permisos sobre esta sucursal';
  end if;
  return public._calculate_settlement_core(p_week_id, p_barber_id);
end;
$$;

create function public.recalculate_settlement_full(p_week_id uuid, p_barber_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is not null
     and not public._admin_can_manage_branch((select branch_id from weeks where id = p_week_id)) then
    raise exception 'Sin permisos sobre esta sucursal';
  end if;
  return public._recalculate_settlement_full_core(p_week_id, p_barber_id);
end;
$$;

revoke execute on function public.calculate_settlement(uuid, uuid)        from public, anon;
revoke execute on function public.recalculate_settlement_full(uuid, uuid) from public, anon;
grant  execute on function public.calculate_settlement(uuid, uuid)        to authenticated, service_role;
grant  execute on function public.recalculate_settlement_full(uuid, uuid) to authenticated, service_role;

-- ── 3. Solo para un cron ─────────────────────────────────────────────────
-- Ni la app ni un pg_cron (la extensión no está instalada) la llaman hoy. Cualquiera con
-- sesión, y hoy también anon, podía cerrar las semanas vencidas de TODAS las sucursales.
-- Si hay un programador externo que la use con la clave de servicio, sigue andando.
revoke execute on function public.auto_close_expired_weeks() from public, anon, authenticated;

-- ── 3b. anon no ejecuta NADA del esquema public ──────────────────────────
-- Hallazgo del 2026-10-15 (consulta de solo lectura): ADEMÁS de las funciones de arriba,
-- anon puede ejecutar delete_year_force/safe, delete_month_force/safe, delete_week_force/
-- safe, create_year, create_expense, auto_open_next_week, report_by_period y los helpers
-- de rol. Las delete_* tienen `if (select auth_role()) <> 'admin' then raise ...`: sin
-- sesión auth_role() es NULL, `NULL <> 'admin'` es NULL y el `if` no corta (el mismo
-- patrón que en la prueba dejó a anon borrar un corte). create_year y auto_open_next_week
-- no chequean nada. Las delete_*_force borran semanas/meses/años con sus cortes.
-- La app SOLO llama a estas funciones con sesión (cliente `supabase` autenticado, o con la
-- clave de servicio en las rutas /api), así que anon no pierde nada. Las del turnero que
-- deben ser públicas (migraciones 066+) se vuelven a otorgar a anon de forma explícita.
-- Los triggers no necesitan EXECUTE del que dispara la operación.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig,
           has_function_privilege('authenticated', p.oid, 'execute') as auth_ok,
           has_function_privilege('service_role',  p.oid, 'execute') as svc_ok
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and has_function_privilege('anon', p.oid, 'execute')
  loop
    -- Revocar a PUBLIC también le saca el permiso a quien solo lo tenía por herencia:
    -- se re-otorga a authenticated / service_role solo si ya lo tenían antes.
    execute format('revoke execute on function %s from public, anon', r.sig);
    if r.auth_ok then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
    if r.svc_ok then
      execute format('grant execute on function %s to service_role', r.sig);
    end if;
  end loop;
end $$;

-- ── 4. Inserción de cortes del barbero ───────────────────────────────────
-- Queda barber_insert_own_transactions (rol barbero + su sucursal + sin override manual).
-- La app ya cumple esa política: editarCorte resetea is_manual_override a false.
drop policy if exists "transactions_barber_insert" on public.transactions;
