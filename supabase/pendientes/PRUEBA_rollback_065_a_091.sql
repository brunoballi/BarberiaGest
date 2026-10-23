-- ============================================================================================
-- PRUEBA DE PUNTA A PUNTA CON ROLLBACK FORZADO: migraciones 065 + 066 a 091 (turnero)
-- Generado por scripts/armar-prueba-rollback.ps1 -- NO EDITAR A MANO, se regenera.
-- ============================================================================================
-- Es UNA sola sentencia. Aplica las 27 migraciones dentro de la transaccion, corre las pruebas
-- con usuarios simulados (barbero, admin de la sucursal, admin de otra sucursal, anon,
-- service_role) y termina con un error a proposito: Postgres deshace TODO. No queda nada.
-- Cada prueba individual ademas se deshace sola.
--
-- CUANDO CORRERLA: con el local cerrado. Toma candados breves sobre branches, profiles,
-- service_catalog, transactions y otras tablas hasta que termina (segundos).
-- lock_timeout = 1s: si no consigue un candado en 1 segundo, aborta sin tocar nada. Si pasa,
-- esperar unos minutos y reintentar.
--
-- COMO LEER EL RESULTADO: el SQL Editor muestra un error "PRUEBA_TERMINADA_ROLLBACK_FORZADO".
-- Adentro: las migraciones aplicadas, el resumen (PASS / FAIL) y una linea por prueba.
-- Si en cambio dice "FALLO LA MIGRACION nnn_...", ese archivo tiene un error: no se aplico nada.
-- ============================================================================================
do $prueba$
declare
  v_aplicadas text := '';
  v_antes     text := '';
  v_s065      text := '';
  v_flow      text := '';
  v_priv      text := '';
  v_todo      text;
  v_pass      integer;
  v_fail      integer;
begin
  perform set_config('lock_timeout', '1s', true);
  perform set_config('statement_timeout', '180s', true);

  if (select count(*) from public.branches) <> 4 then
    raise exception 'ABORTADO: no parece la base de Valhalla (se esperaban 4 sucursales)';
  end if;
  if to_regclass('public.appointments') is not null then
    raise exception 'ABORTADO: el turnero ya esta aplicado en esta base';
  end if;
  if to_regprocedure('public._admin_can_manage_branch(uuid)') is not null then
    raise exception 'ABORTADO: la 065 ya esta aplicada en esta base';
  end if;

  -- ---------------------------------------------------------------------------------------
  -- Datos de prueba: una sucursal con 2+ barberos, un admin de esa sucursal y un admin ajeno
  -- ---------------------------------------------------------------------------------------
  create temp table fx as
  with br as (
    select p.branch_id as x,
           (array_agg(p.id order by p.id))[1] as b,
           (array_agg(p.id order by p.id))[2] as b2
      from public.profiles p
     where p.role = 'barber' and p.is_active and p.branch_id is not null
     group by p.branch_id
    having count(*) >= 2
     order by count(*) desc
     limit 1
  )
  select br.*,
    (select ab.admin_id from public.admin_branches ab
       join public.profiles p on p.id = ab.admin_id and p.role = 'admin'
      where ab.branch_id = br.x limit 1) as a1,
    (select p.id from public.profiles p
      where p.role = 'admin' and p.branch_id is distinct from br.x
        and not exists (select 1 from public.admin_branches ab where ab.admin_id = p.id and ab.branch_id = br.x)
      limit 1) as a2,
    (select w.id from public.weeks w where w.branch_id = br.x order by w.start_date desc limit 1) as w,
    (select s.id from public.settlements s where s.branch_id = br.x and s.status::text = 'draft' limit 1) as sid,
    (select e.id from public.expenses e where e.branch_id = br.x order by (e.registered_by is null), e.expense_date desc limit 1) as e,
    (select e.registered_by from public.expenses e where e.branch_id = br.x order by (e.registered_by is null), e.expense_date desc limit 1) as ereg,
    (select t.id from public.transactions t where t.branch_id = br.x limit 1) as t,
    (select sc.id from public.service_catalog sc where sc.branch_id = br.x and sc.is_active limit 1) as svc
  from br;

  if (select count(*) from fx) <> 1 or (select a1 from fx) is null or (select a2 from fx) is null
     or (select w from fx) is null or (select svc from fx) is null or (select t from fx) is null then
    raise exception 'ABORTADO: no se pudo armar el set de prueba (falta una sucursal con 2 barberos, un admin de esa sucursal, uno ajeno, una semana, un servicio o un corte)';
  end if;

  -- Funciones que podia ejecutar authenticated ANTES de tocar nada
  create temp table pre_auth as
  select p.oid
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
     and has_function_privilege('authenticated', p.oid, 'execute');
  create temp table pre_all as
  select p.oid
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f';

  -- ---------------------------------------------------------------------------------------
  -- Ayudas de prueba
  -- ---------------------------------------------------------------------------------------
  -- try(): corre una sentencia como un rol/usuario simulado y la DESHACE. Devuelve 'OK n=<filas>
  -- [ | resultado del chequeo]' o 'ERR <sqlstate> <mensaje>'.
  create function pg_temp.try(p_sql text, p_uid uuid, p_role text, p_check text default null)
  returns text language plpgsql as $f$
  declare n bigint; res text := '?'; chk text;
  begin
    begin
      perform set_config('request.jwt.claims', case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', p_role)::text end, true);
      perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
      if p_role is not null then execute format('set local role %I', p_role); end if;
      execute p_sql;
      get diagnostics n = row_count;
      execute 'reset role';
      res := 'OK n=' || n;
      if p_check is not null then
        execute p_check into chk;
        res := res || ' | ' || coalesce(chk, 'null');
      end if;
      raise exception using message = '__undo__';
    exception when others then
      if sqlerrm <> '__undo__' then
        res := 'ERR ' || sqlstate || ' ' || left(sqlerrm, 110);
      end if;
    end;
    return res;
  end $f$;

  -- as_(): como try() pero SIN deshacer (para flujos de varios pasos). Devuelve el valor de la
  -- consulta (una columna de texto) o 'ERR ...'.
  create function pg_temp.as_(p_role text, p_uid uuid, p_sql text)
  returns text language plpgsql as $f$
  declare v text;
  begin
    begin
      perform set_config('request.jwt.claims', case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', p_role)::text end, true);
      perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
      execute format('set local role %I', p_role);
      execute p_sql into v;
      execute 'reset role';
      return coalesce(v, 'null');
    exception when others then
      execute 'reset role';
      return 'ERR ' || sqlstate || ' ' || left(sqlerrm, 110);
    end;
  end $f$;

  create function pg_temp.ck(p_label text, p_got text, p_expect text)
  returns text language sql as $f$
    select case when p_got ~ p_expect then 'PASS ' else 'FAIL ' end || p_label || '  =>  ' || left(p_got, 150) || E'\n';
  $f$;

  create function pg_temp.t(p_label text, p_sql text, p_uid uuid, p_role text, p_check text, p_expect text)
  returns text language sql as $f$
    select pg_temp.ck(p_label, pg_temp.try(p_sql, p_uid, p_role, p_check), p_expect);
  $f$;

  -- ---------------------------------------------------------------------------------------
  -- Bateria 1: la 065 (escalada de privilegios, scope por sucursal, anon)
  -- ---------------------------------------------------------------------------------------
  create function pg_temp.suite065() returns text language plpgsql as $s$
  declare f record; r text := ''; tb uuid; tbar uuid; cols text; ob uuid;
  begin
    select * into f from pg_temp.fx;
    r := r || E'ids: sucursal=' || f.x || ' barbero=' || f.b || ' otro_barbero=' || f.b2 || ' admin_suc=' || f.a1 || ' admin_ajeno=' || f.a2 || E'\n';
    r := r || pg_temp.t('[065] barbero calcula SU liquidacion', format('select public.calculate_settlement(%L,%L)', f.w, f.b), f.b, 'authenticated', null, '^OK n=1');
    r := r || pg_temp.t('[065] barbero calcula la de OTRO barbero', format('select public.calculate_settlement(%L,%L)', f.w, f.b2), f.b, 'authenticated', null, '^ERR P0001 Sin permisos');
    r := r || pg_temp.t('[065] barbero hace recalculo completo', format('select public.recalculate_settlement_full(%L,%L)', f.w, f.b), f.b, 'authenticated', null, '^ERR P0001 Sin permisos');
    r := r || pg_temp.t('[065] admin de la sucursal calcula a un barbero', format('select public.calculate_settlement(%L,%L)', f.w, f.b), f.a1, 'authenticated', null, '^OK n=1');
    r := r || pg_temp.t('[065] admin de la sucursal: calcular todas', format('select public.calculate_all_settlements(%L, array[%L]::uuid[])', f.w, f.b), f.a1, 'authenticated', null, '^OK n=1');
    r := r || pg_temp.t('[065] admin de la sucursal: recalculo completo', format('select public.recalculate_settlement_full(%L,%L)', f.w, f.b), f.a1, 'authenticated', null, '^OK n=1');
    r := r || pg_temp.t('[065] admin AJENO calcula', format('select public.calculate_settlement(%L,%L)', f.w, f.b), f.a2, 'authenticated', null, '^ERR P0001 Sin permisos');
    r := r || pg_temp.t('[065] admin AJENO calcular todas', format('select public.calculate_all_settlements(%L, array[%L]::uuid[])', f.w, f.b), f.a2, 'authenticated', null, '^ERR P0001 Sin permisos');
    r := r || pg_temp.t('[065] admin AJENO recalculo completo', format('select public.recalculate_settlement_full(%L,%L)', f.w, f.b), f.a2, 'authenticated', null, '^ERR P0001 Sin permisos');
    if f.sid is not null then
      r := r || pg_temp.t('[065] admin de la sucursal cambia objetivo_pct', format('select public.set_objetivo_pct(%L, (select coalesce(objetivo_pct,0) from public.settlements where id=%L))', f.sid, f.sid), f.a1, 'authenticated', null, '^OK n=1');
      r := r || pg_temp.t('[065] admin AJENO cambia objetivo_pct', format('select public.set_objetivo_pct(%L, 0)', f.sid), f.a2, 'authenticated', null, '^ERR P0001 Sin permisos');
      r := r || pg_temp.t('[065] barbero cambia objetivo_pct', format('select public.set_objetivo_pct(%L, 0)', f.sid), f.b, 'authenticated', null, '^ERR P0001 Sin permisos');
    end if;
    r := r || pg_temp.t('[065] anon calcula liquidacion', format('select public.calculate_settlement(%L,%L)', f.w, f.b), null, 'anon', null, '^ERR 42501');
    r := r || pg_temp.t('[065] BARBERO SE HACE ADMIN (debe fallar, rol sigue barber)', format('update public.profiles set role=%L where id=%L', 'admin', f.b), f.b, 'authenticated', format('select role::text from public.profiles where id=%L', f.b), '^OK n=0 \| barber$');
    r := r || pg_temp.t('[065] admin cambia el rol de un barbero (bloqueado)', format('update public.profiles set role=%L where id=%L', 'admin', f.b), f.a1, 'authenticated', null, '^ERR P0001 El rol');
    r := r || pg_temp.t('[065] admin edita el perfil de un barbero (anda)', format('update public.profiles set is_active=is_active where id=%L', f.b), f.a1, 'authenticated', null, '^OK n=1');
    r := r || pg_temp.t('[065] barbero edita su propio perfil (la app no lo usa)', format('update public.profiles set full_name=full_name where id=%L', f.b), f.b, 'authenticated', null, '^OK n=0');
    if f.e is not null then
      r := r || pg_temp.t('[065] admin AJENO borra gasto (debe seguir existiendo)', format('select public.delete_expense(%L)', f.e), f.a2, 'authenticated', format('select (exists(select 1 from public.expenses where id=%L))::text', f.e), '^OK n=1 \| true$');
      r := r || pg_temp.t('[065] admin de la sucursal borra gasto', format('select public.delete_expense(%L)', f.e), f.a1, 'authenticated', format('select (exists(select 1 from public.expenses where id=%L))::text', f.e), '^OK n=1 \| false$');
      if f.ereg is not null then
        r := r || pg_temp.t('[065] quien registro el gasto lo borra', format('select public.delete_expense(%L)', f.e), f.ereg, 'authenticated', format('select (exists(select 1 from public.expenses where id=%L))::text', f.e), '^OK n=1 \| false$');
      end if;
      r := r || pg_temp.t('[065] admin AJENO edita un gasto (sin efecto)', format('select public.update_expense(%L, null, null, 123456789)', f.e), f.a2, 'authenticated', format('select (amount = 123456789)::text from public.expenses where id=%L', f.e), '^OK n=1 \| false$');
      r := r || pg_temp.t('[065] admin de la sucursal edita un gasto', format('select public.update_expense(%L, null, null, 123456789)', f.e), f.a1, 'authenticated', format('select (amount = 123456789)::text from public.expenses where id=%L', f.e), '^OK n=1 \| true$');
    end if;
    r := r || pg_temp.t('[065] admin AJENO borra un corte', format('select public.delete_transaction_admin(%L)', f.t), f.a2, 'authenticated', null, '^ERR P0001 Solo administradores');
    r := r || pg_temp.t('[065] anon borra un corte', format('select public.delete_transaction_admin(%L)', f.t), null, 'anon', null, '^ERR 42501');
    r := r || pg_temp.t('[065] admin de la sucursal borra un corte', format('select public.delete_transaction_admin(%L)', f.t), f.a1, 'authenticated', format('select (exists(select 1 from public.transactions where id=%L))::text', f.t), '^OK n=1 \| false$');
    r := r || pg_temp.t('[065] anon borra una semana (delete_week_force)', format('select public.delete_week_force(%L)', f.w), null, 'anon', null, '^ERR 42501');
    r := r || pg_temp.t('[065] anon borra un anio (delete_year_force)', format('select public.delete_year_force(%L, 2099)', f.x), null, 'anon', null, '^ERR 42501');
    r := r || pg_temp.t('[065] anon crea un anio (create_year)', format('select public.create_year(%L, 2099)', f.x), null, 'anon', null, '^ERR 42501');
    r := r || pg_temp.t('[065] anon cierra semanas (auto_close_expired_weeks)', 'select public.auto_close_expired_weeks()', null, 'anon', null, '^ERR 42501');
    r := r || pg_temp.t('[065] admin tampoco cierra semanas (solo cron)', 'select public.auto_close_expired_weeks()', f.a1, 'authenticated', null, '^ERR 42501');

    -- Alta de un corte por el barbero (la politica estricta que queda al sacar transactions_barber_insert):
    -- se clona un corte real de un barbero de la sucursal, como ese mismo barbero, con is_manual_override = false.
    select t.id, t.barber_id into tb, tbar
      from public.transactions t join public.profiles p on p.id = t.barber_id and p.role = 'barber' and p.branch_id = t.branch_id
     where t.branch_id = f.x
     order by t.transaction_date desc limit 1;
    select string_agg(quote_ident(c.column_name), ',' order by c.ordinal_position) into cols
      from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = 'transactions' and c.is_generated = 'NEVER'
       and c.column_name not in ('id','created_at','updated_at','is_manual_override','override_notes');
    select b.id into ob from public.branches b where b.id <> f.x limit 1;
    if tb is not null and cols is not null then
      r := r || pg_temp.t('[065] el barbero carga un corte propio en su sucursal (politica estricta)',
        format('insert into public.transactions (%1$s, is_manual_override) select %1$s, false from public.transactions where id = %2$L', cols, tb),
        tbar, 'authenticated', null, '^OK n=1');
      r := r || pg_temp.t('[065] el barbero NO carga un corte en OTRA sucursal',
        format('insert into public.transactions (%1$s, is_manual_override) select %3$s, false from public.transactions where id = %2$L',
               cols, tb, regexp_replace(cols, '(^|,)branch_id(,|$)', '\1' || quote_literal(ob::text) || '::uuid\2')),
        tbar, 'authenticated', null, '^ERR');
      r := r || pg_temp.t('[065] el barbero NO carga un corte con override manual',
        format('insert into public.transactions (%1$s, is_manual_override) select %1$s, true from public.transactions where id = %2$L', cols, tb),
        tbar, 'authenticated', null, '^ERR');
    else
      r := r || 'FAIL [065] no se pudo armar el corte de prueba del barbero (sin cortes en la sucursal)' || E'\n';
    end if;
    return r;
  end $s$;

  -- ---------------------------------------------------------------------------------------
  -- Bateria 2: flujo del turnero de punta a punta (todo se deshace al final)
  -- ---------------------------------------------------------------------------------------
  create function pg_temp.flow_reserva() returns text language plpgsql as $s$
  declare
    f record; v_d date; v_t timestamptz; v_ref text; v_ref2 text; v_appt uuid; r text := '';
    v_json text := '[{"start_time":"09:00","end_time":"13:00","mode":"orden_llegada"},{"start_time":"14:00","end_time":"18:00","mode":"turno","slot_minutes":30}]';
  begin
    select * into f from pg_temp.fx;
    v_d := current_date + 1;
    while extract(dow from v_d) <> 3 loop v_d := v_d + 1; end loop;     -- proximo miercoles
    v_t := (v_d + time '10:00') at time zone 'America/Argentina/Buenos_Aires';

    -- preparar: un servicio reservable de 30 min y una franja de turnos para el 2do barbero
    update public.service_catalog set duration_min = 30, is_bookable = true where id = f.svc;
    insert into public.barber_schedules (barber_id, branch_id, weekday, start_time, end_time, mode, slot_minutes)
    values (f.b2, f.x, 3, '09:00', '12:00', 'turno', 30);

    r := r || pg_temp.ck('[turnero] admin crea una franja de turnos (RPC)', pg_temp.as_('authenticated', f.a1, format('select public.create_barber_schedule(%L,%L,3::smallint,%L::time,%L::time,%L::schedule_mode,30)::text', f.b, f.x, '09:00', '12:00', 'turno')), '^[0-9a-f-]{36}$');
    r := r || pg_temp.ck('[turnero] admin AJENO no puede crear franjas', pg_temp.as_('authenticated', f.a2, format('select public.create_barber_schedule(%L,%L,3::smallint,%L::time,%L::time,%L::schedule_mode,30)::text', f.b, f.x, '09:00', '12:00', 'turno')), '^ERR P0001 Sin permisos');
    r := r || pg_temp.ck('[turnero] anon ve la sucursal', pg_temp.as_('anon', null, format('select count(*)::text from public.get_public_branch(%L)', f.x)), '^1$');
    r := r || pg_temp.ck('[turnero] anon lista las 4 sucursales', pg_temp.as_('anon', null, 'select count(*)::text from public.list_public_branches()'), '^4$');
    r := r || pg_temp.ck('[turnero] anon ve el servicio reservable', pg_temp.as_('anon', null, format('select count(*)::text from public.get_bookable_services(%L)', f.x)), '^[1-9]');
    r := r || pg_temp.ck('[turnero] anon ve los 2 barberos con turnos', pg_temp.as_('anon', null, format('select count(*)::text from public.get_public_barbers(%L)', f.x)), '^2$');
    r := r || pg_temp.ck('[turnero] horarios del barbero (09:00 a 11:30 = 6)', pg_temp.as_('anon', null, format('select count(*)::text from public.get_available_slots(%L,%L,%L::date,array[%L]::uuid[])', f.x, f.b, v_d, f.svc)), '^6$');
    r := r || pg_temp.ck('[turnero] horarios de cualquier barbero', pg_temp.as_('anon', null, format('select count(*)::text from public.get_available_slots_any(%L,%L::date,array[%L]::uuid[])', f.x, v_d, f.svc)), '^6$');
    r := r || pg_temp.ck('[turnero] anon NO reserva directo (solo por la ruta con tope)', pg_temp.as_('anon', null, format('select reference from public.create_appointment_public(%L,%L,%L,%L,%L::timestamptz,array[%L]::uuid[])', f.x, f.b, 'Prueba', '3415550001', v_t, f.svc)), '^ERR 42501');

    v_ref := pg_temp.as_('service_role', null, format('select reference from public.create_appointment_public_rl(%L,%L,%L,%L,%L,%L::timestamptz,array[%L]::uuid[])', 'ip-prueba-1', f.x, f.b, 'Cliente Uno', '3415550001', v_t, f.svc));
    r := r || pg_temp.ck('[turnero] reserva por la ruta con tope (service_role)', v_ref, '^[0-9A-F]{8}$');
    r := r || pg_temp.ck('[turnero] anon consulta el turno con codigo + telefono', pg_temp.as_('anon', null, format('select status::text from public.get_appointment_by_reference(%L,%L)', v_ref, '3415550001')), '^reservado$');
    r := r || pg_temp.ck('[turnero] con otro telefono no lo encuentra', pg_temp.as_('anon', null, format('select count(*)::text from public.get_appointment_by_reference(%L,%L)', v_ref, '0000000000')), '^0$');
    r := r || pg_temp.ck('[turnero] el horario tomado deja de ofrecerse (5)', pg_temp.as_('anon', null, format('select count(*)::text from public.get_available_slots(%L,%L,%L::date,array[%L]::uuid[])', f.x, f.b, v_d, f.svc)), '^5$');

    v_ref2 := pg_temp.as_('service_role', null, format('select reference from public.create_appointment_public_rl(%L,%L,null,%L,%L,%L::timestamptz,array[%L]::uuid[])', 'ip-prueba-1', f.x, 'Cliente Dos', '3415550002', v_t, f.svc));
    r := r || pg_temp.ck('[turnero] sin preferencia: asigna al barbero libre', coalesce((select a.barber_id::text from public.appointments a where a.reference = v_ref2), 'sin turno'), '^' || f.b2::text || '$');
    r := r || pg_temp.ck('[turnero] sin preferencia con todos ocupados falla', pg_temp.as_('service_role', null, format('select reference from public.create_appointment_public_rl(%L,%L,null,%L,%L,%L::timestamptz,array[%L]::uuid[])', 'ip-prueba-1', f.x, 'Cliente Tres', '3415550003', v_t, f.svc)), '^ERR P0001 Ese horario ya no');

    r := r || pg_temp.ck('[turnero] admin de la sucursal ve la agenda (2 turnos)', pg_temp.as_('authenticated', f.a1, format('select count(*)::text from public.get_admin_agenda(%L,%L::date)', f.x, v_d)), '^2$');
    r := r || pg_temp.ck('[turnero] admin AJENO no ve la agenda', pg_temp.as_('authenticated', f.a2, format('select count(*)::text from public.get_admin_agenda(%L,%L::date)', f.x, v_d)), '^ERR P0001 Sin acceso');
    r := r || pg_temp.ck('[turnero] el barbero ve SU agenda (1 turno)', pg_temp.as_('authenticated', f.b, format('select count(*)::text from public.get_barber_agenda(%L::date)', v_d)), '^1$');
    r := r || pg_temp.ck('[turnero] el barbero no ve la lista de clientes', pg_temp.as_('authenticated', f.b, format('select count(*)::text from public.list_appointment_clients(%L)', f.x)), '^ERR P0001 Sin permiso');
    r := r || pg_temp.ck('[turnero] el admin de la sucursal ve los clientes (2)', pg_temp.as_('authenticated', f.a1, format('select count(*)::text from public.list_appointment_clients(%L)', f.x)), '^2$');

    r := r || pg_temp.ck('[turnero] anon NO lee la tabla de turnos', pg_temp.as_('anon', null, 'select count(*)::text from public.appointments'), '^ERR 42501');
    r := r || pg_temp.ck('[turnero] barbero NO escribe turnos directo', pg_temp.as_('authenticated', f.b, format('with u as (update public.appointments set notes=%L returning 1) select count(*)::text from u', 'x')), '^ERR 42501');
    r := r || pg_temp.ck('[turnero] anon NO ve la agenda del admin', pg_temp.as_('anon', null, format('select count(*)::text from public.get_admin_agenda(%L,%L::date)', f.x, v_d)), '^ERR 42501');

    r := r || pg_temp.ck('[turnero] anon cancela con codigo + telefono', pg_temp.as_('anon', null, format('select ''ok'' from (select public.cancel_appointment_public(%L,%L)) q', v_ref, '3415550001')), '^ok$');
    r := r || pg_temp.ck('[turnero] queda cancelled_at', coalesce((select (a.cancelled_at is not null)::text from public.appointments a where a.reference = v_ref), 'sin turno'), '^true$');
    r := r || pg_temp.ck('[turnero] el horario cancelado vuelve a ofrecerse (6)', pg_temp.as_('anon', null, format('select count(*)::text from public.get_available_slots(%L,%L,%L::date,array[%L]::uuid[])', f.x, f.b, v_d, f.svc)), '^6$');

    insert into public.booking_rate_limits (ip_hash, day, bookings)
    values ('ip-tope', (now() at time zone 'America/Argentina/Buenos_Aires')::date, 20);
    r := r || pg_temp.ck('[turnero] tope de 20 reservas por IP', pg_temp.as_('service_role', null, format('select reference from public.create_appointment_public_rl(%L,%L,%L,%L,%L,%L::timestamptz,array[%L]::uuid[])', 'ip-tope', f.x, f.b, 'Cliente Cuatro', '3415550004', v_t + interval '30 minutes', f.svc)), '^ERR P0001 Se hicieron muchas reservas');

    select a.id into v_appt from public.appointments a where a.reference = v_ref2;
    r := r || pg_temp.ck('[turnero] service_role registra un mensaje de WhatsApp', pg_temp.as_('service_role', null, format('select ''ok'' from (select public.register_whatsapp_message(%L,%L,%L,%L,%L)) q', 'wamid-prueba', f.x, v_appt, 'confirmacion', '5491155550000')), '^ok$');
    r := r || pg_temp.ck('[turnero] service_role registra el estado entregado', pg_temp.as_('service_role', null, 'select ''ok'' from (select public.record_whatsapp_status(''wamid-prueba'',''delivered'',null,null,null,null)) q'), '^ok$');
    r := r || pg_temp.ck('[turnero] el estado quedo en delivered', coalesce((select m.status from public.whatsapp_messages m where m.wamid = 'wamid-prueba'), 'sin mensaje'), '^delivered$');
    r := r || pg_temp.ck('[turnero] anon NO registra mensajes', pg_temp.as_('anon', null, format('select ''ok'' from (select public.register_whatsapp_message(%L,%L,%L,%L,%L)) q', 'wamid-x', f.x, v_appt, 'confirmacion', '5491155550000')), '^ERR 42501');
    r := r || pg_temp.ck('[turnero] admin AJENO no lee mensajes de WhatsApp', pg_temp.as_('authenticated', f.a2, 'select count(*)::text from public.whatsapp_messages'), '^0$');
    r := r || pg_temp.ck('[turnero] admin de la sucursal lee sus mensajes', pg_temp.as_('authenticated', f.a1, 'select count(*)::text from public.whatsapp_messages'), '^1$');

    r := r || pg_temp.ck('[turnero] anon NO edita la marca de la sucursal', pg_temp.as_('anon', null, format('select ''ok'' from (select public.update_branch_branding(%L, %L)) q', f.x, 'X')), '^ERR 42501');
    r := r || pg_temp.ck('[turnero] admin AJENO NO edita la marca', pg_temp.as_('authenticated', f.a2, format('select ''ok'' from (select public.update_branch_branding(%L, %L)) q', f.x, 'X')), '^ERR P0001 Sin permisos');
    r := r || pg_temp.ck('[turnero] admin de la sucursal edita la marca', pg_temp.as_('authenticated', f.a1, format('select ''ok'' from (select public.update_branch_branding(%L, (select name from public.branches where id=%L))) q', f.x, f.x)), '^ok$');
    r := r || pg_temp.ck('[turnero] admin de la sucursal carga el Phone Number ID', pg_temp.as_('authenticated', f.a1, format('select ''ok'' from (select public.set_branch_whatsapp_sender(%L, %L)) q', f.x, '123456789012')), '^ok$');
    r := r || pg_temp.ck('[turnero] admin AJENO NO carga el Phone Number ID', pg_temp.as_('authenticated', f.a2, format('select ''ok'' from (select public.set_branch_whatsapp_sender(%L, %L)) q', f.x, '123456789012')), '^ERR P0001 Sin permisos');

    r := r || pg_temp.ck('[turnero] carga masiva de horarios (2 franjas)', pg_temp.as_('authenticated', f.a1, format('select (public.set_barber_week_schedule(%L, array[%L]::uuid[], array[4]::smallint[], %L::jsonb, true))->>''created''', f.x, f.b, v_json)), '^2$');
    r := r || pg_temp.ck('[turnero] admin AJENO NO hace carga masiva', pg_temp.as_('authenticated', f.a2, format('select (public.set_barber_week_schedule(%L, array[%L]::uuid[], array[4]::smallint[], %L::jsonb, true))->>''created''', f.x, f.b, v_json)), '^ERR P0001 Sin permisos');
    r := r || pg_temp.ck('[turnero] popular_service responde para anon', pg_temp.as_('anon', null, format('select coalesce(public.get_popular_service(%L)::text, ''null'')', f.x)), '^(null|[0-9a-f-]{36})$');

    -- Interaccion con "eliminar o archivar" de Valhalla: un barbero con turnos se ARCHIVA, no falla
    r := r || pg_temp.ck('[turnero] eliminar-o-archivar un barbero con turnos lo archiva', pg_temp.as_('authenticated', f.a1, format('select public.admin_delete_or_archive(%L, %L)::text', 'barbero', f.b)), '"archivado": true');
    return r;
  exception when others then
    return r || 'FAIL [turnero] el flujo se corto: ' || sqlerrm || E'\n';
  end $s$;

  -- ---------------------------------------------------------------------------------------
  -- ANTES: comprobar que el arnes detecta los agujeros reales (informativo, no cuenta PASS/FAIL)
  -- ---------------------------------------------------------------------------------------
  v_antes :=
    'ANTES  barbero se hace admin    : ' || pg_temp.try(format('update public.profiles set role=%L where id=%L', 'admin', (select b from pg_temp.fx)), (select b from pg_temp.fx), 'authenticated', format('select role::text from public.profiles where id=%L', (select b from pg_temp.fx))) || E'\n' ||
    'ANTES  anon calcula liquidacion : ' || pg_temp.try(format('select public.calculate_settlement(%L,%L)', (select w from pg_temp.fx), (select b from pg_temp.fx)), null, 'anon') || E'\n' ||
    'ANTES  anon borra un corte      : ' || pg_temp.try(format('select public.delete_transaction_admin(%L)', (select t from pg_temp.fx)), null, 'anon', format('select (exists(select 1 from public.transactions where id=%L))::text', (select t from pg_temp.fx))) || E'\n';

  -- ---------------------------------------------------------------------------------------
  -- Aplicar las migraciones (dentro de la transaccion; se deshace al final)
  -- ---------------------------------------------------------------------------------------
  begin
    execute $m065$
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

$m065$;
  exception when others then
    raise exception 'FALLO LA MIGRACION 065_cierre_escalada_de_privilegios.sql: % (SQLSTATE %)', sqlerrm, sqlstate;
  end;
  v_aplicadas := v_aplicadas || '065 ';

  begin
    execute $m066$
-- ============================================================
-- 066 — PORT de Flowi.estudio 054_service_scheduling_fields.sql
-- Porte a BarberiaGest/Valhalla del 2026-10-15. NO SE APLICA SIN REVISION DE BRUNO.
-- Ver PORTING.md (turnero). Cambios respecto del original: chequeos NULL-safe
-- (is distinct from 'admin' / not coalesce(..., false)).
-- ============================================================

-- ============================================================
-- TURNERO — Fase 1: campos que le faltan a service_catalog
-- ============================================================
-- El catálogo hoy solo tiene nombre y precio, porque hasta ahora nadie
-- necesitaba saber cuánto tarda un servicio. El turnero sí: la duración es
-- lo que define los huecos de la agenda, no es un dato decorativo.
-- ============================================================

alter table public.service_catalog
  add column if not exists duration_min integer,
  add column if not exists description  text,
  add column if not exists image_url    text,
  -- Un servicio puede seguir existiendo para cargarlo a mano en el gestor sin
  -- ofrecerse en la reserva pública (ej. "Retoque", que no se agenda solo).
  -- ADAPTADO A VALHALLA: en Flowi.estudio el default es TRUE porque la tabla estaba vacia al
  -- crear la columna. Aca ya hay servicios cargados sin duracion, y el alta de servicios de la
  -- app actual tampoco manda duracion: con default TRUE el CHECK de abajo rechazaria a los
  -- existentes y haria fallar cada alta nueva. Default FALSE = ningun servicio se ofrece en
  -- la reserva publica hasta que el admin le cargue la duracion y lo habilite.
  add column if not exists is_bookable  boolean not null default false;

-- No se puede reservar un servicio sin saber cuánto dura, pero sí puede
-- seguir existiendo un servicio viejo con duration_min en null: por eso el
-- check exige la duración solo cuando is_bookable es true, en vez de hacer la
-- columna NOT NULL a secas (eso habría roto todo servicio ya cargado).
alter table public.service_catalog
  drop constraint if exists service_catalog_duration_check;

alter table public.service_catalog
  add constraint service_catalog_duration_check
  check (not is_bookable or (duration_min is not null and duration_min > 0));

$m066$;
  exception when others then
    raise exception 'FALLO LA MIGRACION 066_turnero_servicios_con_duracion.sql: % (SQLSTATE %)', sqlerrm, sqlstate;
  end;
  v_aplicadas := v_aplicadas || '066 ';

  begin
    execute $m067$
-- ============================================================
-- 067 — PORT de Flowi.estudio 055_barber_schedules.sql
-- Porte a BarberiaGest/Valhalla del 2026-10-15. NO SE APLICA SIN REVISION DE BRUNO.
-- Ver PORTING.md (turnero). Cambios respecto del original: chequeos NULL-safe
-- (is distinct from 'admin' / not coalesce(..., false)).
-- ============================================================

-- ============================================================
-- TURNERO — Fase 1: horarios de atención por barbero
-- ============================================================
-- Dos tablas:
--
--   barber_schedules    el horario semanal recurrente (lunes, martes, ...).
--   schedule_exceptions  lo que rompe el horario habitual un día puntual:
--                        feriado, vacaciones, "hoy me voy a las 18".
--
-- La franja mixta (orden de llegada vs. turno) que necesita Valhalla no es un
-- caso especial: `mode` es un atributo de CADA FRANJA, no del negocio. Un
-- barbero puede tener una franja de la mañana en 'orden_llegada' y una de la
-- tarde en 'turno', el mismo día. El caso de Valhalla queda representado con
-- dos filas, sin código extra.
-- ============================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'schedule_mode') then
    create type schedule_mode as enum ('turno', 'orden_llegada');
  end if;
end $$;

create table if not exists barber_schedules (
  id           uuid          primary key default gen_random_uuid(),
  barber_id    uuid          not null references profiles(id) on delete cascade,
  branch_id    uuid          not null references branches(id) on delete cascade,
  -- 0 = domingo .. 6 = sábado. Mismo orden que extract(dow from date).
  weekday      smallint      not null check (weekday between 0 and 6),
  start_time   time          not null,
  end_time     time          not null,
  mode         schedule_mode not null default 'turno',
  -- Granularidad de los turnos dentro de la franja. Solo tiene sentido en
  -- modo 'turno': en 'orden_llegada' no se reserva hora, así que no hay nada
  -- que trocear.
  slot_minutes integer,
  created_at   timestamptz   not null default now(),
  constraint barber_schedules_times_check check (end_time > start_time),
  constraint barber_schedules_slot_check check (
    (mode = 'turno' and slot_minutes is not null and slot_minutes > 0)
    or (mode = 'orden_llegada' and slot_minutes is null)
  )
);

-- Dos franjas del mismo barbero, mismo día, no pueden superponerse — sea cual
-- sea su modo. Se representa el horario como un rango de timestamps sobre una
-- fecha fija arbitraria: lo único que importa acá es la superposición de
-- horas del día, no una fecha real.
-- ADAPTADO: en el esquema extensions (en Flowi va en public y trae ~100 funciones ejecutables por anon).
create extension if not exists btree_gist with schema extensions;

alter table barber_schedules
  drop constraint if exists barber_schedules_sin_solape;

alter table barber_schedules
  add constraint barber_schedules_sin_solape
  exclude using gist (
    barber_id with =,
    weekday with =,
    tsrange(
      ('2000-01-03'::date + start_time)::timestamp,
      ('2000-01-03'::date + end_time)::timestamp
    ) with &&
  );

create index if not exists idx_barber_schedules_barber
  on barber_schedules(barber_id, weekday);

-- ------------------------------------------------------------
create table if not exists schedule_exceptions (
  id             uuid        primary key default gen_random_uuid(),
  branch_id      uuid        not null references branches(id) on delete cascade,
  -- null = aplica a toda la sucursal (feriado). Con barbero puntual = el día
  -- libre de una sola persona.
  barber_id      uuid        references profiles(id) on delete cascade,
  exception_date date        not null,
  -- true: no se atiende nada ese día (feriado, franco, vacaciones).
  -- false: el horario de ese día se reemplaza por start_time/end_time en vez
  -- del horario habitual (ej. "hoy me voy a las 18").
  closed_all_day boolean     not null default true,
  start_time     time,
  end_time       time,
  reason         text,
  created_at     timestamptz not null default now(),
  created_by     uuid        references auth.users(id),
  constraint schedule_exceptions_partial_needs_times check (
    closed_all_day or (start_time is not null and end_time is not null and end_time > start_time)
  )
);

create index if not exists idx_schedule_exceptions_lookup
  on schedule_exceptions(branch_id, exception_date);

-- ============================================================
-- RLS
-- ============================================================
-- Lectura abierta a cualquier autenticado de la sucursal: hoy solo la usa el
-- admin, pero el barbero va a necesitar ver su propio horario en la Fase 3
-- (su agenda mobile) y no hace falta reabrir esto entonces.
--
-- Escritura: nada de policy directa a propósito. Todo pasa por las RPC de
-- abajo, que validan rol y que el admin tenga la sucursal — mismo criterio
-- que expense_categories.
alter table barber_schedules   enable row level security;
alter table schedule_exceptions enable row level security;

drop policy if exists "barber_schedules_read" on barber_schedules;
create policy "barber_schedules_read" on barber_schedules
  for select to authenticated
  using (current_admin_has_branch(branch_id) or branch_id = current_user_branch());

drop policy if exists "schedule_exceptions_read" on schedule_exceptions;
create policy "schedule_exceptions_read" on schedule_exceptions
  for select to authenticated
  using (current_admin_has_branch(branch_id) or branch_id = current_user_branch());

-- ============================================================
-- RPC — horarios
-- ============================================================
create or replace function public.create_barber_schedule(
  p_barber_id    uuid,
  p_branch_id    uuid,
  p_weekday      smallint,
  p_start_time   time,
  p_end_time     time,
  p_mode         schedule_mode,
  p_slot_minutes integer default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  if (select role from profiles where id = auth.uid()) is distinct from 'admin'
     or not coalesce(current_admin_has_branch(p_branch_id) or p_branch_id = current_user_branch(), false) then
    raise exception 'Sin permisos para configurar horarios de esta sucursal';
  end if;

  insert into barber_schedules (barber_id, branch_id, weekday, start_time, end_time, mode, slot_minutes)
  values (p_barber_id, p_branch_id, p_weekday, p_start_time, p_end_time, p_mode, p_slot_minutes)
  returning id into v_id;

  return v_id;
exception
  -- El nombre técnico de exclusion_violation no le dice nada a un admin. Se
  -- traduce al único motivo real por el que puede pasar acá: dos franjas que
  -- se superponen.
  when exclusion_violation then
    raise exception 'Esa franja se superpone con otra que ya tiene este barbero ese día';
end;
$function$;

create or replace function public.delete_barber_schedule(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_branch uuid;
begin
  select branch_id into v_branch from barber_schedules where id = p_id;
  if v_branch is null then
    raise exception 'La franja no existe';
  end if;

  if (select role from profiles where id = auth.uid()) is distinct from 'admin'
     or not coalesce(current_admin_has_branch(v_branch) or v_branch = current_user_branch(), false) then
    raise exception 'Sin permisos para configurar horarios de esta sucursal';
  end if;

  delete from barber_schedules where id = p_id;
end;
$function$;

create or replace function public.create_schedule_exception(
  p_branch_id      uuid,
  p_exception_date date,
  p_barber_id      uuid    default null,
  p_closed_all_day boolean default true,
  p_start_time     time    default null,
  p_end_time       time    default null,
  p_reason         text    default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  if (select role from profiles where id = auth.uid()) is distinct from 'admin'
     or not coalesce(current_admin_has_branch(p_branch_id) or p_branch_id = current_user_branch(), false) then
    raise exception 'Sin permisos para configurar excepciones de esta sucursal';
  end if;

  insert into schedule_exceptions (branch_id, barber_id, exception_date, closed_all_day,
                                   start_time, end_time, reason, created_by)
  values (p_branch_id, p_barber_id, p_exception_date, p_closed_all_day,
          p_start_time, p_end_time, p_reason, auth.uid())
  returning id into v_id;

  return v_id;
end;
$function$;

create or replace function public.delete_schedule_exception(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_branch uuid;
begin
  select branch_id into v_branch from schedule_exceptions where id = p_id;
  if v_branch is null then
    raise exception 'La excepción no existe';
  end if;

  if (select role from profiles where id = auth.uid()) is distinct from 'admin'
     or not coalesce(current_admin_has_branch(v_branch) or v_branch = current_user_branch(), false) then
    raise exception 'Sin permisos para configurar excepciones de esta sucursal';
  end if;

  delete from schedule_exceptions where id = p_id;
end;
$function$;

grant execute on function public.create_barber_schedule(uuid, uuid, smallint, time, time, schedule_mode, integer) to authenticated;
grant execute on function public.delete_barber_schedule(uuid) to authenticated;
grant execute on function public.create_schedule_exception(uuid, date, uuid, boolean, time, time, text) to authenticated;
grant execute on function public.delete_schedule_exception(uuid) to authenticated;

$m067$;
  exception when others then
    raise exception 'FALLO LA MIGRACION 067_turnero_horarios_de_barberos.sql: % (SQLSTATE %)', sqlerrm, sqlstate;
  end;
  v_aplicadas := v_aplicadas || '067 ';

  begin
    execute $m068$
-- ============================================================
-- 068 — PORT de Flowi.estudio 056_appointments.sql
-- Porte a BarberiaGest/Valhalla del 2026-10-15. NO SE APLICA SIN REVISION DE BRUNO.
-- Ver PORTING.md (turnero). Cambios respecto del original: chequeos NULL-safe
-- (is distinct from 'admin' / not coalesce(..., false)).
-- ============================================================

-- ============================================================
-- TURNERO — Fase 1: turnos
-- ============================================================
-- Tres tablas:
--
--   appointment_clients   los clientes que reservan. NO son usuarios del
--                         sistema — no tienen fila en profiles ni login.
--                         Se identifican por teléfono dentro de la sucursal.
--   appointments          el turno en sí.
--   appointment_services  los servicios de ese turno, con precio, nombre y
--                         duración CONGELADOS al momento de reservar. Si la
--                         barbería sube los precios después, el turno ya
--                         tomado conserva lo que se le cotizó al cliente.
--
-- La garantía más importante de este archivo es que DOS TURNOS DEL MISMO
-- BARBERO NO PUEDEN SUPERPONERSE, y esa garantía vive en la base, no en el
-- código. Comprobar "¿está libre?" y recién después insertar no alcanza:
-- entre esas dos operaciones puede colarse otra reserva. La restricción de
-- exclusión lo hace imposible aunque la aplicación tenga un bug.
-- ============================================================

-- ADAPTADO: en el esquema extensions (ver 067).
create extension if not exists btree_gist with schema extensions;

-- ------------------------------------------------------------
create table if not exists appointment_clients (
  id         uuid        primary key default gen_random_uuid(),
  branch_id  uuid        not null references branches(id) on delete cascade,
  full_name  text        not null,
  phone      text        not null,
  email      text,
  created_at timestamptz not null default now(),
  constraint appointment_clients_branch_phone_unique unique (branch_id, phone),
  constraint appointment_clients_name_not_blank check (btrim(full_name) <> ''),
  constraint appointment_clients_phone_not_blank check (btrim(phone) <> '')
);

-- ------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'appointment_status') then
    create type appointment_status as enum
      ('reservado', 'llego', 'atendido', 'no_vino', 'cancelado');
  end if;
  if not exists (select 1 from pg_type where typname = 'appointment_source') then
    create type appointment_source as enum ('publico', 'admin', 'barbero');
  end if;
end $$;

create table if not exists appointments (
  id             uuid                primary key default gen_random_uuid(),
  branch_id      uuid                not null references branches(id) on delete cascade,
  barber_id      uuid                not null references profiles(id),
  client_id      uuid                not null references appointment_clients(id),
  starts_at      timestamptz         not null,
  ends_at        timestamptz         not null,
  status         appointment_status  not null default 'reservado',
  source         appointment_source  not null default 'admin',
  -- Código corto para que el cliente lo mencione por WhatsApp o teléfono,
  -- igual que el "XqhgBrVEU" de la referencia de mercado.
  reference      text                not null unique,
  notes          text,
  -- El puente con el gestor (ver docs/turnero_plan.md sección 5). Se llena
  -- SOLO cuando el barbero confirma la precarga del corte — nunca automático.
  -- Esa lógica es de la Fase 3; la columna se crea ahora para no tener que
  -- alterar la tabla después.
  transaction_id uuid                references transactions(id),
  created_at     timestamptz         not null default now(),
  created_by     uuid                references auth.users(id),
  constraint appointments_dates_check check (ends_at > starts_at)
);

-- La garantía central de todo el turnero.
alter table appointments
  drop constraint if exists appointments_sin_solape;

alter table appointments
  add constraint appointments_sin_solape
  exclude using gist (
    barber_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status not in ('cancelado', 'no_vino'));

create index if not exists idx_appointments_branch_date
  on appointments(branch_id, starts_at);
create index if not exists idx_appointments_client
  on appointments(client_id);

-- ------------------------------------------------------------
create table if not exists appointment_services (
  id            uuid          primary key default gen_random_uuid(),
  appointment_id uuid         not null references appointments(id) on delete cascade,
  service_id    uuid          not null references service_catalog(id),
  -- Congelados al reservar. Ver el comentario de arriba.
  service_name  text          not null,
  price         numeric(12,2) not null,
  duration_min  integer       not null check (duration_min > 0),
  created_at    timestamptz   not null default now()
);

create index if not exists idx_appointment_services_appt
  on appointment_services(appointment_id);

-- ============================================================
-- RLS
-- ============================================================
-- Mismo criterio que barber_schedules: lectura abierta a la sucursal (hoy
-- solo la usa el admin; el barbero la va a necesitar en la Fase 3 para ver su
-- propia agenda, sin tener que reabrir nada). Toda escritura por RPC.
alter table appointment_clients  enable row level security;
alter table appointments         enable row level security;
alter table appointment_services enable row level security;

drop policy if exists "appointment_clients_read" on appointment_clients;
create policy "appointment_clients_read" on appointment_clients
  for select to authenticated
  using (current_admin_has_branch(branch_id) or branch_id = current_user_branch());

drop policy if exists "appointments_read" on appointments;
create policy "appointments_read" on appointments
  for select to authenticated
  using (current_admin_has_branch(branch_id) or branch_id = current_user_branch());

-- appointment_services no tiene branch_id propio: se resuelve a través del
-- turno al que pertenece.
drop policy if exists "appointment_services_read" on appointment_services;
create policy "appointment_services_read" on appointment_services
  for select to authenticated
  using (
    exists (
      select 1 from appointments a
       where a.id = appointment_services.appointment_id
         and (current_admin_has_branch(a.branch_id) or a.branch_id = current_user_branch())
    )
  );

-- ============================================================
-- RPC
-- ============================================================

-- Agenda de un día, para todos los barberos de la sucursal. Es lo que
-- alimenta la pantalla de turnos del admin.
create or replace function public.get_admin_agenda(p_branch_id uuid, p_date date)
returns table (
  id           uuid,
  barber_id    uuid,
  barber_name  text,
  client_name  text,
  client_phone text,
  starts_at    timestamptz,
  ends_at      timestamptz,
  status       appointment_status,
  source       appointment_source,
  reference    text,
  notes        text,
  total_price  numeric,
  services     jsonb
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not coalesce(current_admin_has_branch(p_branch_id) or p_branch_id = current_user_branch(), false) then
    raise exception 'Sin acceso a esta sucursal';
  end if;

  return query
    select
      a.id, a.barber_id, p.full_name, c.full_name, c.phone,
      a.starts_at, a.ends_at, a.status, a.source, a.reference, a.notes,
      coalesce(sum(s.price), 0),
      coalesce(jsonb_agg(jsonb_build_object(
        'service_id', s.service_id,
        'name', s.service_name,
        'price', s.price,
        'duration_min', s.duration_min
      ) order by s.created_at), '[]'::jsonb)
    from appointments a
    join profiles p            on p.id = a.barber_id
    join appointment_clients c on c.id = a.client_id
    left join appointment_services s on s.appointment_id = a.id
   where a.branch_id = p_branch_id
     -- América/Argentina, no la zona horaria de la sesión: un turno de las
     -- 23:30 no se puede correr al día siguiente por un desfasaje de reloj.
     and (a.starts_at at time zone 'America/Argentina/Buenos_Aires')::date = p_date
   group by a.id, a.barber_id, p.full_name, c.full_name, c.phone,
            a.starts_at, a.ends_at, a.status, a.source, a.reference, a.notes
   order by a.starts_at;
end;
$function$;

-- Crea el turno a mano. Da de alta o reutiliza al cliente por teléfono,
-- congela precio/nombre/duración de cada servicio elegido, y genera el
-- código de referencia con reintento por si chocara (es astronómicamente
-- improbable, pero cuesta nada cubrirlo).
create or replace function public.create_appointment_admin(
  p_branch_id    uuid,
  p_barber_id    uuid,
  p_client_name  text,
  p_client_phone text,
  p_starts_at    timestamptz,
  p_service_ids  uuid[],
  p_client_email text default null,
  p_notes        text default null
)
returns table (id uuid, reference text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_client_id   uuid;
  v_total_min   integer;
  v_ends_at     timestamptz;
  v_appt_id     uuid;
  v_reference   text;
  v_intentos    integer := 0;
  v_svc_count   integer;
begin
  if (select role from profiles where profiles.id = auth.uid()) is distinct from 'admin'
     or not coalesce(current_admin_has_branch(p_branch_id) or p_branch_id = current_user_branch(), false) then
    raise exception 'Sin permisos para agendar en esta sucursal';
  end if;

  if p_service_ids is null or array_length(p_service_ids, 1) is null then
    raise exception 'Elegí al menos un servicio';
  end if;

  if btrim(coalesce(p_client_name, '')) = '' then
    raise exception 'El nombre del cliente es obligatorio';
  end if;
  if btrim(coalesce(p_client_phone, '')) = '' then
    raise exception 'El teléfono del cliente es obligatorio';
  end if;

  -- Todos los servicios pedidos tienen que existir, ser de esta sucursal y
  -- tener duración cargada. Si el count no coincide con lo pedido, alguno no
  -- pasó el filtro — mejor cortar acá que agendar con menos de lo elegido.
  select count(*), coalesce(sum(duration_min), 0)
    into v_svc_count, v_total_min
    from service_catalog
   where service_catalog.id = any(p_service_ids)
     and branch_id = p_branch_id
     and is_active
     and duration_min is not null;

  if v_svc_count <> array_length(p_service_ids, 1) then
    raise exception 'Algún servicio elegido no existe, está inactivo o no tiene duración configurada';
  end if;

  v_ends_at := p_starts_at + make_interval(mins => v_total_min);

  -- Alta o reutilización del cliente por teléfono. El nombre se actualiza al
  -- último dato que trajo (pudo cambiar); el email solo se pisa si vino uno
  -- nuevo, para no borrar uno que ya estaba cargado.
  insert into appointment_clients (branch_id, full_name, phone, email)
  values (p_branch_id, btrim(p_client_name), btrim(p_client_phone), p_client_email)
  on conflict (branch_id, phone) do update
    set full_name = excluded.full_name,
        email     = coalesce(excluded.email, appointment_clients.email)
  returning appointment_clients.id into v_client_id;

  loop
    v_intentos := v_intentos + 1;
    v_reference := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    begin
      insert into appointments (branch_id, barber_id, client_id, starts_at, ends_at,
                                source, reference, notes, created_by)
      values (p_branch_id, p_barber_id, v_client_id, p_starts_at, v_ends_at,
              'admin', v_reference, p_notes, auth.uid())
      returning appointments.id into v_appt_id;
      exit;
    exception
      when unique_violation then
        if v_intentos >= 5 then
          raise exception 'No se pudo generar un código de referencia único, reintentá';
        end if;
      when exclusion_violation then
        raise exception 'Ese horario ya no está libre para este barbero';
    end;
  end loop;

  insert into appointment_services (appointment_id, service_id, service_name, price, duration_min)
  select v_appt_id, sc.id, sc.name, sc.base_price, sc.duration_min
    from service_catalog sc
   where sc.id = any(p_service_ids);

  return query select v_appt_id, v_reference;
end;
$function$;

-- Mueve un turno de horario y/o de barbero. La duración total se recalcula
-- desde los servicios ya cargados: no hace falta volver a mandarlos.
create or replace function public.move_appointment(
  p_appointment_id uuid,
  p_new_starts_at  timestamptz,
  p_new_barber_id  uuid default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_branch    uuid;
  v_barber    uuid;
  v_status    appointment_status;
  v_total_min integer;
  v_new_ends  timestamptz;
begin
  select branch_id, barber_id, status
    into v_branch, v_barber, v_status
    from appointments where id = p_appointment_id;

  if v_branch is null then
    raise exception 'El turno no existe';
  end if;
  if (select role from profiles where profiles.id = auth.uid()) is distinct from 'admin'
     or not coalesce(current_admin_has_branch(v_branch) or v_branch = current_user_branch(), false) then
    raise exception 'Sin permisos sobre esta sucursal';
  end if;
  if v_status in ('cancelado') then
    raise exception 'Un turno cancelado no se puede mover';
  end if;

  select coalesce(sum(duration_min), 0) into v_total_min
    from appointment_services where appointment_id = p_appointment_id;

  v_new_ends := p_new_starts_at + make_interval(mins => v_total_min);

  begin
    update appointments
       set starts_at = p_new_starts_at,
           ends_at   = v_new_ends,
           barber_id = coalesce(p_new_barber_id, v_barber)
     where id = p_appointment_id;
  exception
    when exclusion_violation then
      raise exception 'Ese horario ya no está libre para este barbero';
  end;
end;
$function$;

create or replace function public.cancel_appointment(p_appointment_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_branch uuid;
begin
  select branch_id into v_branch from appointments where id = p_appointment_id;
  if v_branch is null then
    raise exception 'El turno no existe';
  end if;
  if (select role from profiles where profiles.id = auth.uid()) is distinct from 'admin'
     or not coalesce(current_admin_has_branch(v_branch) or v_branch = current_user_branch(), false) then
    raise exception 'Sin permisos sobre esta sucursal';
  end if;

  update appointments
     set status = 'cancelado',
         notes  = case when p_reason is not null and btrim(p_reason) <> ''
                        then coalesce(notes || ' — ', '') || 'Cancelado: ' || p_reason
                        else notes end
   where id = p_appointment_id;
end;
$function$;

-- Cambia el estado operativo del turno (llegó / atendido / no vino).
-- Admin-only por ahora: el barbero todavía no tiene pantalla propia (Fase 3).
-- Cuando la tenga, esta misma función es la que se va a extender para
-- aceptar también al barbero dueño del turno — no hace falta reescribirla.
create or replace function public.set_appointment_status(
  p_appointment_id uuid,
  p_status         appointment_status
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_branch uuid;
begin
  if p_status = 'reservado' then
    raise exception 'No se puede volver un turno a "reservado" manualmente';
  end if;

  select branch_id into v_branch from appointments where id = p_appointment_id;
  if v_branch is null then
    raise exception 'El turno no existe';
  end if;
  if (select role from profiles where profiles.id = auth.uid()) is distinct from 'admin'
     or not coalesce(current_admin_has_branch(v_branch) or v_branch = current_user_branch(), false) then
    raise exception 'Sin permisos sobre esta sucursal';
  end if;

  update appointments set status = p_status where id = p_appointment_id;
end;
$function$;

grant execute on function public.get_admin_agenda(uuid, date) to authenticated;
grant execute on function public.create_appointment_admin(uuid, uuid, text, text, timestamptz, uuid[], text, text) to authenticated;
grant execute on function public.move_appointment(uuid, timestamptz, uuid) to authenticated;
grant execute on function public.cancel_appointment(uuid, text) to authenticated;
grant execute on function public.set_appointment_status(uuid, appointment_status) to authenticated;

$m068$;
  exception when others then
    raise exception 'FALLO LA MIGRACION 068_turnero_turnos.sql: % (SQLSTATE %)', sqlerrm, sqlstate;
  end;
  v_aplicadas := v_aplicadas || '068 ';

  begin
    execute $m069$
-- ============================================================
-- 069 — PORT de Flowi.estudio 059_reserva_publica.sql
-- Porte a BarberiaGest/Valhalla del 2026-10-15. NO SE APLICA SIN REVISION DE BRUNO.
-- Ver PORTING.md (turnero). Cambios respecto del original: chequeos NULL-safe
-- (is distinct from 'admin' / not coalesce(..., false)).
-- ============================================================

-- ============================================================
-- TURNERO — Fase 2: reserva pública (sin login)
-- ============================================================
-- Es la primera superficie del sistema que se usa SIN sesión. Todas las
-- políticas RLS del proyecto asumen un `auth.uid()`, así que el enfoque acá
-- es distinto y deliberado:
--
--   AL ROL `anon` NO SE LE DA ACCESO A NINGUNA TABLA. Ni de lectura.
--   Solo se le otorgan estas cinco funciones, que devuelven exactamente lo
--   que la pantalla de reserva necesita mostrar y nada más.
--
-- Por qué importa: si se abriera `appointment_clients` a lectura anónima,
-- cualquiera con la clave pública (que viaja en el JavaScript del navegador)
-- se baja la lista completa de clientes con sus teléfonos. Con RPC acotadas,
-- ese dato no sale nunca — ninguna de estas funciones devuelve datos de otros
-- clientes.
--
-- Ver también 058_revocar_anon_rpc_sensibles.sql: antes de esta fase había
-- cuatro RPC administrativas otorgadas a `anon` por error.
-- ============================================================

-- Huso fijo del negocio. Las franjas se guardan como `time` (hora de pared) y
-- los turnos como `timestamptz` (instante absoluto); esta es la bisagra entre
-- las dos representaciones. Con el huso de la sesión, un turno de las 20:00
-- podría calcularse para otra hora según desde dónde se conecte el cliente.
create or replace function public.flowi_tz()
returns text language sql immutable set search_path to 'public' as $function$
  select 'America/Argentina/Buenos_Aires'
$function$;

-- ------------------------------------------------------------
-- 1. Datos de la sucursal para la portada pública
-- ------------------------------------------------------------
-- Devuelve solo lo que se muestra en pantalla. Nada de datos internos.
create or replace function public.get_public_branch(p_branch_id uuid default null)
returns table (id uuid, name text, address text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select b.id, b.name, b.address
    from branches b
   where b.is_active
     and (p_branch_id is null or b.id = p_branch_id)
   order by b.name
   limit 1;
$function$;

-- ------------------------------------------------------------
-- 2. Servicios reservables
-- ------------------------------------------------------------
create or replace function public.get_bookable_services(p_branch_id uuid)
returns table (
  id           uuid,
  name         text,
  description  text,
  base_price   numeric,
  duration_min integer
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select s.id, s.name, s.description, s.base_price, s.duration_min
    from service_catalog s
   where s.branch_id = p_branch_id
     and s.is_active
     and s.is_bookable
     and s.duration_min is not null
   order by s.name;
$function$;

-- ------------------------------------------------------------
-- 3. Barberos que toman turnos
-- ------------------------------------------------------------
-- Solo los que tienen al menos una franja en modo 'turno'. Un barbero que
-- únicamente atiende por orden de llegada no aparece para reservar — no
-- tendría ningún horario que ofrecer.
--
-- Devuelve `full_name` y nada más: ni email, ni DNI, ni condiciones de
-- liquidación. El nombre ya es público (está en la puerta del local).
create or replace function public.get_public_barbers(p_branch_id uuid)
returns table (id uuid, full_name text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select distinct p.id, p.full_name
    from profiles p
    join barber_schedules bs on bs.barber_id = p.id and bs.mode = 'turno'
   where p.branch_id = p_branch_id
     and p.is_active
   order by p.full_name;
$function$;

-- ------------------------------------------------------------
-- 4. Franjas por orden de llegada
-- ------------------------------------------------------------
-- El caso de Valhalla: "de 9:30 a 13:30 es por orden de llegada, después con
-- turno". Esas franjas NO generan horarios reservables, pero el cliente tiene
-- que verlas o va a creer que la barbería está cerrada a la mañana.
create or replace function public.get_walkin_windows(p_branch_id uuid, p_date date)
returns table (barber_id uuid, barber_name text, start_time time, end_time time)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select bs.barber_id, p.full_name, bs.start_time, bs.end_time
    from barber_schedules bs
    join profiles p on p.id = bs.barber_id
   where bs.branch_id = p_branch_id
     and bs.mode = 'orden_llegada'
     and bs.weekday = extract(dow from p_date)::smallint
     and p.is_active
     -- Un feriado tapa también la franja de orden de llegada.
     and not exists (
       select 1 from schedule_exceptions e
        where e.branch_id = p_branch_id
          and e.exception_date = p_date
          and e.closed_all_day
          and (e.barber_id is null or e.barber_id = bs.barber_id)
     )
   order by p.full_name, bs.start_time;
$function$;

-- ------------------------------------------------------------
-- 5. Horarios disponibles — el corazón de la reserva
-- ------------------------------------------------------------
-- Toma las franjas 'turno' del barbero para ese día, les resta las
-- excepciones y los turnos ya tomados, y devuelve los huecos donde entra la
-- duración TOTAL de los servicios elegidos.
--
-- Se calcula en el servidor a propósito: un cálculo de disponibilidad hecho
-- en el navegador se manipula cambiando el JavaScript.
create or replace function public.get_available_slots(
  p_branch_id   uuid,
  p_barber_id   uuid,
  p_date        date,
  p_service_ids uuid[]
)
returns table (slot_at timestamptz, period text)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_tz          text := flowi_tz();
  v_total_min   integer;
  v_svc_count   integer;
  v_weekday     smallint := extract(dow from p_date)::smallint;
  v_franja      record;
  v_ex_start    time;
  v_ex_end      time;
  v_win_start   timestamptz;
  v_win_end     timestamptz;
  v_cursor      timestamptz;
  v_slot_end    timestamptz;
  v_hour        integer;
begin
  if p_service_ids is null or array_length(p_service_ids, 1) is null then
    return;
  end if;

  select count(*), coalesce(sum(sc.duration_min), 0)
    into v_svc_count, v_total_min
    from service_catalog sc
   where sc.id = any(p_service_ids)
     and sc.branch_id = p_branch_id
     and sc.is_active
     and sc.is_bookable
     and sc.duration_min is not null;

  -- Si alguno no pasó el filtro, no se devuelve nada: mejor una pantalla sin
  -- horarios que ofrecer un turno que después la reserva va a rechazar.
  if v_svc_count is null or v_svc_count <> array_length(p_service_ids, 1) or v_total_min <= 0 then
    return;
  end if;

  -- Feriado / franco de día completo: no hay nada que ofrecer.
  if exists (
    select 1 from schedule_exceptions e
     where e.branch_id = p_branch_id
       and e.exception_date = p_date
       and e.closed_all_day
       and (e.barber_id is null or e.barber_id = p_barber_id)
  ) then
    return;
  end if;

  -- Excepción parcial ("hoy atiendo 14 a 18"): recorta la franja habitual.
  select e.start_time, e.end_time into v_ex_start, v_ex_end
    from schedule_exceptions e
   where e.branch_id = p_branch_id
     and e.exception_date = p_date
     and not e.closed_all_day
     and (e.barber_id is null or e.barber_id = p_barber_id)
   order by (e.barber_id is not null) desc  -- la del barbero pisa a la de la sucursal
   limit 1;

  for v_franja in
    select bs.start_time, bs.end_time, bs.slot_minutes
      from barber_schedules bs
     where bs.branch_id = p_branch_id
       and bs.barber_id = p_barber_id
       and bs.weekday = v_weekday
       and bs.mode = 'turno'
     order by bs.start_time
  loop
    v_win_start := (p_date + v_franja.start_time) at time zone v_tz;
    v_win_end   := (p_date + v_franja.end_time)   at time zone v_tz;

    if v_ex_start is not null then
      v_win_start := greatest(v_win_start, (p_date + v_ex_start) at time zone v_tz);
      v_win_end   := least(v_win_end,   (p_date + v_ex_end)   at time zone v_tz);
    end if;

    v_cursor := v_win_start;
    while v_cursor + make_interval(mins => v_total_min) <= v_win_end loop
      v_slot_end := v_cursor + make_interval(mins => v_total_min);

      -- No se ofrece un horario pasado. Vale también para hoy a media tarde:
      -- los turnos de la mañana ya no se pueden reservar.
      if v_cursor > now()
         and not exists (
           select 1 from appointments a
            where a.barber_id = p_barber_id
              and a.status not in ('cancelado', 'no_vino')
              and tstzrange(a.starts_at, a.ends_at) && tstzrange(v_cursor, v_slot_end)
         )
      then
        v_hour := extract(hour from (v_cursor at time zone v_tz))::integer;
        slot_at := v_cursor;
        period  := case when v_hour < 12 then 'manana'
                        when v_hour < 18 then 'tarde'
                        else 'noche' end;
        return next;
      end if;

      v_cursor := v_cursor + make_interval(mins => v_franja.slot_minutes);
    end loop;
  end loop;
end;
$function$;

-- ------------------------------------------------------------
-- 6. Crear la reserva
-- ------------------------------------------------------------
-- Revalida TODO del lado del servidor. Que la pantalla haya ofrecido un
-- horario no alcanza: entre que se mostró y se confirmó pudo tomarlo otro, y
-- además un POST hecho a mano puede mandar cualquier hora.
create or replace function public.create_appointment_public(
  p_branch_id    uuid,
  p_barber_id    uuid,
  p_client_name  text,
  p_client_phone text,
  p_starts_at    timestamptz,
  p_service_ids  uuid[],
  p_client_email text default null
)
returns table (reference text, starts_at timestamptz, ends_at timestamptz)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tz         text := flowi_tz();
  v_total_min  integer;
  v_svc_count  integer;
  v_ends_at    timestamptz;
  v_date       date;
  v_client_id  uuid;
  v_appt_id    uuid;
  v_reference  text;
  v_intentos   integer := 0;
  v_activos    integer;
  v_name       text := btrim(coalesce(p_client_name, ''));
  v_phone      text := btrim(coalesce(p_client_phone, ''));
begin
  if v_name = '' then
    raise exception 'Necesitamos tu nombre para agendar el turno';
  end if;
  if length(v_phone) < 6 then
    raise exception 'Necesitamos un teléfono válido para confirmarte el turno';
  end if;
  if p_service_ids is null or array_length(p_service_ids, 1) is null then
    raise exception 'Elegí al menos un servicio';
  end if;

  select count(*), coalesce(sum(sc.duration_min), 0)
    into v_svc_count, v_total_min
    from service_catalog sc
   where sc.id = any(p_service_ids)
     and sc.branch_id = p_branch_id
     and sc.is_active
     and sc.is_bookable
     and sc.duration_min is not null;

  if v_svc_count <> array_length(p_service_ids, 1) then
    raise exception 'Alguno de los servicios elegidos ya no está disponible';
  end if;

  v_ends_at := p_starts_at + make_interval(mins => v_total_min);
  v_date    := (p_starts_at at time zone v_tz)::date;

  if p_starts_at <= now() then
    raise exception 'Ese horario ya pasó. Elegí uno futuro.';
  end if;

  -- El horario tiene que ser uno de los que la propia base considera
  -- disponible. Esto cubre de una sola vez: franja inexistente, modo orden de
  -- llegada, feriado, excepción parcial y turno ya tomado. Sin esta
  -- verificación, un POST a mano podría agendar a las 4 de la mañana.
  if not exists (
    select 1 from get_available_slots(p_branch_id, p_barber_id, v_date, p_service_ids) s
     where s.slot_at = p_starts_at
  ) then
    raise exception 'Ese horario ya no está disponible. Elegí otro.';
  end if;

  -- Freno de abuso: un teléfono no puede acumular turnos futuros sin límite,
  -- que es la forma más fácil de dejar la agenda inutilizable desde afuera.
  select count(*) into v_activos
    from appointments a
    join appointment_clients c on c.id = a.client_id
   where c.branch_id = p_branch_id
     and c.phone = v_phone
     and a.status = 'reservado'
     and a.starts_at > now();

  if v_activos >= 3 then
    raise exception 'Ya tenés 3 turnos reservados. Cancelá alguno antes de sacar otro.';
  end if;

  insert into appointment_clients (branch_id, full_name, phone, email)
  values (p_branch_id, v_name, v_phone, nullif(btrim(coalesce(p_client_email, '')), ''))
  on conflict (branch_id, phone) do update
    set full_name = excluded.full_name,
        email     = coalesce(excluded.email, appointment_clients.email)
  returning appointment_clients.id into v_client_id;

  loop
    v_intentos := v_intentos + 1;
    v_reference := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    begin
      insert into appointments (branch_id, barber_id, client_id, starts_at, ends_at,
                                source, reference)
      values (p_branch_id, p_barber_id, v_client_id, p_starts_at, v_ends_at,
              'publico', v_reference)
      returning appointments.id into v_appt_id;
      exit;
    exception
      when unique_violation then
        if v_intentos >= 5 then
          raise exception 'No pudimos generar el código de la reserva, probá de nuevo';
        end if;
      when exclusion_violation then
        -- Alguien tomó el mismo horario entre que se mostró y se confirmó.
        raise exception 'Ese horario acaba de ser tomado. Elegí otro.';
    end;
  end loop;

  insert into appointment_services (appointment_id, service_id, service_name, price, duration_min)
  select v_appt_id, sc.id, sc.name, sc.base_price, sc.duration_min
    from service_catalog sc
   where sc.id = any(p_service_ids);

  return query select v_reference, p_starts_at, v_ends_at;
end;
$function$;

-- ------------------------------------------------------------
-- 7. Consultar / cancelar con el código de referencia
-- ------------------------------------------------------------
-- El cliente no tiene cuenta, así que el código corto es su única credencial.
-- Se exige código + teléfono juntos: con el código solo, alguien podría
-- probar combinaciones hasta cancelarle el turno a otro.
create or replace function public.get_appointment_by_reference(
  p_reference text,
  p_phone     text
)
returns table (
  reference   text,
  starts_at   timestamptz,
  ends_at     timestamptz,
  status      appointment_status,
  barber_name text,
  client_name text,
  total_price numeric,
  services    jsonb
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select a.reference, a.starts_at, a.ends_at, a.status,
         p.full_name, c.full_name,
         coalesce(sum(s.price), 0),
         coalesce(jsonb_agg(jsonb_build_object('name', s.service_name, 'price', s.price)
                            order by s.created_at), '[]'::jsonb)
    from appointments a
    join profiles p            on p.id = a.barber_id
    join appointment_clients c on c.id = a.client_id
    left join appointment_services s on s.appointment_id = a.id
   where upper(btrim(p_reference)) = a.reference
     and c.phone = btrim(p_phone)
   group by a.reference, a.starts_at, a.ends_at, a.status, p.full_name, c.full_name;
$function$;

create or replace function public.cancel_appointment_public(
  p_reference text,
  p_phone     text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id     uuid;
  v_starts timestamptz;
begin
  select a.id, a.starts_at into v_id, v_starts
    from appointments a
    join appointment_clients c on c.id = a.client_id
   where a.reference = upper(btrim(p_reference))
     and c.phone = btrim(p_phone)
     and a.status = 'reservado';

  if v_id is null then
    -- Mensaje deliberadamente vago: distinguir "no existe" de "el teléfono no
    -- coincide" le confirmaría a un curioso que ese código es válido.
    raise exception 'No encontramos una reserva activa con esos datos';
  end if;

  if v_starts <= now() then
    raise exception 'Ese turno ya pasó, no se puede cancelar desde acá';
  end if;

  update appointments set status = 'cancelado' where id = v_id;
end;
$function$;

-- ============================================================
-- PERMISOS
-- ============================================================
-- Solo estas funciones, y solo ellas. `anon` no recibe acceso a ninguna tabla:
-- las políticas RLS del turnero son todas `to authenticated`, así que una
-- consulta directa desde el rol anónimo no devuelve ni una fila.
grant execute on function public.flowi_tz()                                              to anon, authenticated;
grant execute on function public.get_public_branch(uuid)                                 to anon, authenticated;
grant execute on function public.get_bookable_services(uuid)                             to anon, authenticated;
grant execute on function public.get_public_barbers(uuid)                                to anon, authenticated;
grant execute on function public.get_walkin_windows(uuid, date)                          to anon, authenticated;
grant execute on function public.get_available_slots(uuid, uuid, date, uuid[])           to anon, authenticated;
grant execute on function public.create_appointment_public(uuid, uuid, text, text, timestamptz, uuid[], text) to anon, authenticated;
grant execute on function public.get_appointment_by_reference(text, text)                to anon, authenticated;
grant execute on function public.cancel_appointment_public(text, text)                   to anon, authenticated;

$m069$;
  exception when others then
    raise exception 'FALLO LA MIGRACION 069_turnero_reserva_publica.sql: % (SQLSTATE %)', sqlerrm, sqlstate;
  end;
  v_aplicadas := v_aplicadas || '069 ';

  begin
    execute $m070$
-- ============================================================
-- 070 — PORT de Flowi.estudio 060_agenda_barbero.sql
-- Porte a BarberiaGest/Valhalla del 2026-10-15. NO SE APLICA SIN REVISION DE BRUNO.
-- Ver PORTING.md (turnero). Cambios respecto del original: chequeos NULL-safe
-- (is distinct from 'admin' / not coalesce(..., false)).
-- ============================================================

-- ============================================================
-- TURNERO — Fase 3: agenda del barbero + precarga del corte
-- ============================================================
-- Ver docs/turnero_plan.md secciones 2 y 5. El barbero necesita ver su propia
-- agenda, cambiar el estado de sus turnos, cargar uno a mano para el cliente
-- que llamó por teléfono, bloquear un horario puntual ("hoy me voy antes"),
-- y — al marcar un turno "atendido" — precargar el corte en el gestor sin
-- que eso pase nunca automático.
--
-- Gotcha importante: la "capacidad de barbero" en este proyecto NO es solo
-- role = 'barber'. Hay admins que también atienden (dual role), marcados con
-- profiles.is_barber = true — el mismo criterio que ya usa BARBER_OR_DUAL en
-- lib/supabase/supabase.client.ts. Cada chequeo de permiso de acá abajo lo
-- replica como (role = 'barber' or is_barber = true); chequear solo el role
-- dejaría afuera a un admin que también corta pelo.
-- ============================================================

-- ------------------------------------------------------------
-- a) set_appointment_status: extendida para el barbero dueño del turno.
-- Admin-only hasta ahora; el comentario original ya anticipaba esta fase.
-- ------------------------------------------------------------
create or replace function public.set_appointment_status(
  p_appointment_id uuid,
  p_status         appointment_status
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_branch    uuid;
  v_barber    uuid;
  v_role      text;
  v_is_barber boolean;
begin
  if p_status = 'reservado' then
    raise exception 'No se puede volver un turno a "reservado" manualmente';
  end if;

  select branch_id, barber_id into v_branch, v_barber
    from appointments where id = p_appointment_id;
  if v_branch is null then
    raise exception 'El turno no existe';
  end if;

  select role, is_barber into v_role, v_is_barber
    from profiles where id = auth.uid();

  if v_role = 'admin' then
    if not coalesce(current_admin_has_branch(v_branch) or v_branch = current_user_branch(), false) then
      raise exception 'Sin permisos sobre esta sucursal';
    end if;
  elsif v_role = 'barber' or v_is_barber then
    if auth.uid() <> v_barber then
      raise exception 'Solo podés cambiar el estado de tus propios turnos';
    end if;
  else
    raise exception 'Sin permisos sobre este turno';
  end if;

  update appointments set status = p_status where id = p_appointment_id;
end;
$function$;

-- ------------------------------------------------------------
-- b) get_barber_agenda: la agenda del día del barbero autenticado. No recibe
-- barber_id -- sale de auth.uid(), así no hay forma de pedir la agenda ajena.
-- Incluye transaction_id: el frontend lo usa para no ofrecer la precarga dos
-- veces (sección 5 del plan).
-- ------------------------------------------------------------
create or replace function public.get_barber_agenda(p_date date)
returns table (
  id             uuid,
  client_name    text,
  client_phone   text,
  starts_at      timestamptz,
  ends_at        timestamptz,
  status         appointment_status,
  source         appointment_source,
  reference      text,
  notes          text,
  total_price    numeric,
  services       jsonb,
  transaction_id uuid
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_barber uuid := auth.uid();
begin
  -- profiles.id calificado por el mismo motivo que en create_appointment_barber
  -- más abajo: RETURNS TABLE(id uuid, ...) crea una variable "id" implícita.
  if not exists (
    select 1 from profiles
     where profiles.id = v_barber and (profiles.role = 'barber' or profiles.is_barber)
  ) then
    raise exception 'Solo barberos pueden ver su propia agenda';
  end if;

  return query
    select
      a.id, c.full_name, c.phone,
      a.starts_at, a.ends_at, a.status, a.source, a.reference, a.notes,
      coalesce(sum(s.price), 0),
      coalesce(jsonb_agg(jsonb_build_object(
        'service_id', s.service_id,
        'name', s.service_name,
        'price', s.price,
        'duration_min', s.duration_min
      ) order by s.created_at), '[]'::jsonb),
      a.transaction_id
    from appointments a
    join appointment_clients c on c.id = a.client_id
    left join appointment_services s on s.appointment_id = a.id
   where a.barber_id = v_barber
     -- América/Argentina, no la zona horaria de la sesión — mismo criterio
     -- que get_admin_agenda.
     and (a.starts_at at time zone 'America/Argentina/Buenos_Aires')::date = p_date
   group by a.id, c.full_name, c.phone, a.starts_at, a.ends_at, a.status,
            a.source, a.reference, a.notes, a.transaction_id
   order by a.starts_at;
end;
$function$;

-- ------------------------------------------------------------
-- c) create_appointment_barber: el barbero agenda a mano para el cliente que
-- llamó por teléfono. Mismo cuerpo que create_appointment_admin, pero
-- barber_id/branch_id salen de la sesión, no de parámetros, y source es
-- 'barbero'.
-- ------------------------------------------------------------
create or replace function public.create_appointment_barber(
  p_client_name  text,
  p_client_phone text,
  p_starts_at    timestamptz,
  p_service_ids  uuid[],
  p_client_email text default null,
  p_notes        text default null
)
returns table (id uuid, reference text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_barber      uuid := auth.uid();
  v_branch      uuid;
  v_client_id   uuid;
  v_total_min   integer;
  v_ends_at     timestamptz;
  v_appt_id     uuid;
  v_reference   text;
  v_intentos    integer := 0;
  v_svc_count   integer;
begin
  -- profiles.id calificado a propósito: RETURNS TABLE(id uuid, ...) crea una
  -- variable "id" implícita en el cuerpo (mismo gotcha ya documentado en
  -- create_appointment_admin, 056_appointments.sql) -- un "id" sin calificar
  -- acá quedaría ambiguo entre esa variable y la columna de profiles.
  if not exists (
    select 1 from profiles
     where profiles.id = v_barber and (profiles.role = 'barber' or profiles.is_barber)
  ) then
    raise exception 'Solo barberos pueden agendar turnos propios';
  end if;

  v_branch := current_user_branch();
  if v_branch is null then
    raise exception 'No tenés una sucursal asignada';
  end if;

  if p_service_ids is null or array_length(p_service_ids, 1) is null then
    raise exception 'Elegí al menos un servicio';
  end if;

  if btrim(coalesce(p_client_name, '')) = '' then
    raise exception 'El nombre del cliente es obligatorio';
  end if;
  if btrim(coalesce(p_client_phone, '')) = '' then
    raise exception 'El teléfono del cliente es obligatorio';
  end if;

  select count(*), coalesce(sum(duration_min), 0)
    into v_svc_count, v_total_min
    from service_catalog
   where service_catalog.id = any(p_service_ids)
     and branch_id = v_branch
     and is_active
     and duration_min is not null;

  if v_svc_count <> array_length(p_service_ids, 1) then
    raise exception 'Algún servicio elegido no existe, está inactivo o no tiene duración configurada';
  end if;

  v_ends_at := p_starts_at + make_interval(mins => v_total_min);

  insert into appointment_clients (branch_id, full_name, phone, email)
  values (v_branch, btrim(p_client_name), btrim(p_client_phone), p_client_email)
  on conflict (branch_id, phone) do update
    set full_name = excluded.full_name,
        email     = coalesce(excluded.email, appointment_clients.email)
  returning appointment_clients.id into v_client_id;

  loop
    v_intentos := v_intentos + 1;
    v_reference := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    begin
      insert into appointments (branch_id, barber_id, client_id, starts_at, ends_at,
                                source, reference, notes, created_by)
      values (v_branch, v_barber, v_client_id, p_starts_at, v_ends_at,
              'barbero', v_reference, p_notes, auth.uid())
      returning appointments.id into v_appt_id;
      exit;
    exception
      when unique_violation then
        if v_intentos >= 5 then
          raise exception 'No se pudo generar un código de referencia único, reintentá';
        end if;
      when exclusion_violation then
        raise exception 'Ese horario ya no está libre';
    end;
  end loop;

  insert into appointment_services (appointment_id, service_id, service_name, price, duration_min)
  select v_appt_id, sc.id, sc.name, sc.base_price, sc.duration_min
    from service_catalog sc
   where sc.id = any(p_service_ids);

  return query select v_appt_id, v_reference;
end;
$function$;

-- ------------------------------------------------------------
-- d) create_schedule_exception_barber: el barbero bloquea su propio horario
-- ("hoy me voy antes", "salgo a comer", franco puntual). Siempre barber_id =
-- auth.uid() -- no puede tocar el horario de otro ni el de toda la sucursal
-- (eso sigue siendo exclusivo del admin vía create_schedule_exception).
-- ------------------------------------------------------------
create or replace function public.create_schedule_exception_barber(
  p_exception_date date,
  p_closed_all_day boolean default true,
  p_start_time     time    default null,
  p_end_time       time    default null,
  p_reason         text    default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_barber uuid := auth.uid();
  v_branch uuid;
  v_id     uuid;
begin
  if not exists (
    select 1 from profiles
     where id = v_barber and (role = 'barber' or is_barber)
  ) then
    raise exception 'Solo barberos pueden bloquear su propio horario';
  end if;

  v_branch := current_user_branch();
  if v_branch is null then
    raise exception 'No tenés una sucursal asignada';
  end if;

  insert into schedule_exceptions (branch_id, barber_id, exception_date, closed_all_day,
                                   start_time, end_time, reason, created_by)
  values (v_branch, v_barber, p_exception_date, p_closed_all_day,
          p_start_time, p_end_time, p_reason, auth.uid())
  returning id into v_id;

  return v_id;
end;
$function$;

-- ------------------------------------------------------------
-- e) link_appointment_transaction: el puente de la sección 5 del plan. Se
-- llama SOLO cuando el barbero confirma la precarga del corte -- nunca
-- automático. Blindado en tres frentes: el turno tiene que ser suyo (o del
-- admin de su sucursal), no puede tener ya un corte vinculado (no se ofrece
-- la precarga dos veces), y el corte que se vincula tiene que ser del mismo
-- barbero (no se puede pegar un corte ajeno a un turno).
-- ------------------------------------------------------------
create or replace function public.link_appointment_transaction(
  p_appointment_id uuid,
  p_transaction_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_appt_branch uuid;
  v_appt_barber uuid;
  v_existing    uuid;
  v_tx_barber   uuid;
  v_role        text;
  v_is_barber   boolean;
begin
  select branch_id, barber_id, transaction_id
    into v_appt_branch, v_appt_barber, v_existing
    from appointments where id = p_appointment_id;
  if v_appt_branch is null then
    raise exception 'El turno no existe';
  end if;

  select role, is_barber into v_role, v_is_barber from profiles where id = auth.uid();

  if v_role = 'admin' then
    if not coalesce(current_admin_has_branch(v_appt_branch) or v_appt_branch = current_user_branch(), false) then
      raise exception 'Sin permisos sobre esta sucursal';
    end if;
  elsif v_role = 'barber' or v_is_barber then
    if auth.uid() <> v_appt_barber then
      raise exception 'Ese turno no es tuyo';
    end if;
  else
    raise exception 'Sin permisos sobre este turno';
  end if;

  if v_existing is not null then
    raise exception 'Este turno ya tiene un corte cargado';
  end if;

  select barber_id into v_tx_barber from transactions where id = p_transaction_id;
  if v_tx_barber is null or v_tx_barber <> v_appt_barber then
    raise exception 'Ese corte no corresponde a este turno';
  end if;

  update appointments set transaction_id = p_transaction_id where id = p_appointment_id;
end;
$function$;

grant execute on function public.set_appointment_status(uuid, appointment_status) to authenticated;
grant execute on function public.get_barber_agenda(date) to authenticated;
grant execute on function public.create_appointment_barber(text, text, timestamptz, uuid[], text, text) to authenticated;
grant execute on function public.create_schedule_exception_barber(date, boolean, time, time, text) to authenticated;
grant execute on function public.link_appointment_transaction(uuid, uuid) to authenticated;

$m070$;
  exception when others then
    raise exception 'FALLO LA MIGRACION 070_turnero_agenda_del_barbero.sql: % (SQLSTATE %)', sqlerrm, sqlstate;
  end;
  v_aplicadas := v_aplicadas || '070 ';

  begin
    execute $m071$
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

$m071$;
  exception when others then
    raise exception 'FALLO LA MIGRACION 071_turnero_reserva_multisucursal.sql: % (SQLSTATE %)', sqlerrm, sqlstate;
  end;
  v_aplicadas := v_aplicadas || '071 ';

  begin
    execute $m072$
-- ============================================================
-- 072 — PORT de Flowi.estudio 062_branding_sucursal.sql
-- Porte a BarberiaGest/Valhalla del 2026-10-15. NO SE APLICA SIN REVISION DE BRUNO.
-- Ver PORTING.md (turnero). Cambios respecto del original: bucket con tope de tamano y tipos; chequeos NULL-safe
-- (is distinct from 'admin' / not coalesce(..., false)).
-- ============================================================

-- ============================================================
-- Marca de la sucursal en la reserva pública
-- ============================================================
-- Hasta ahora /reservar mostraba solo `name` y `address` de la sucursal: la
-- barbería no tenía forma de aparecer con su propia identidad ante SUS
-- clientes. Se agregan tres campos editables desde el panel, más el logo:
--
--   logo_url            imagen de la barbería (bucket branch-logos, ver abajo)
--   welcome_title       el "bienvenido" -- el encabezado de la portada
--   welcome_description texto que se muestra una vez elegida la sucursal
--
-- Los tres son opcionales y anulables a propósito: si están vacíos, la
-- pantalla cae al comportamiento de siempre (nombre + dirección) sin que
-- nadie tenga que configurar nada. Una instalación nueva sigue andando.
-- ============================================================

alter table branches
  add column if not exists logo_url            text,
  add column if not exists welcome_title       text,
  add column if not exists welcome_description text;

-- ------------------------------------------------------------
-- Bucket de logos
-- ------------------------------------------------------------
-- Público de lectura a propósito: el logo se muestra en /reservar, que es una
-- pantalla SIN login. La escritura queda restringida a admins autenticados.
--
-- Va todo dentro de un guard: el esquema `storage` lo crea Supabase al
-- aprovisionar el proyecto y NO existe en un Postgres pelado. Sin esto, la
-- migración rompería al correr supabase/migrations/*.sql de punta a punta en
-- una base limpia (el método de verificación de este proyecto, ver
-- ESTADO_SESION.md sección 3).
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then

    -- Tope de 2 MB y solo imagenes (LOGO_MAX_BYTES): viene de la seccion 5 de la 106 de Flowi.
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('branch-logos', 'branch-logos', true, 2 * 1024 * 1024,
            array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
    on conflict (id) do update set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

    -- Lectura pública: cualquiera puede ver el logo (lo necesita /reservar).
    drop policy if exists "branch_logos_public_read" on storage.objects;
    create policy "branch_logos_public_read" on storage.objects
      for select to anon, authenticated
      using (bucket_id = 'branch-logos');

    -- Escritura solo para admins. No se acota por sucursal a propósito: el
    -- nombre del archivo lo elige el panel y un admin de este sistema ya
    -- administra la instalación entera (1 cliente = 1 deploy).
    drop policy if exists "branch_logos_admin_write" on storage.objects;
    create policy "branch_logos_admin_write" on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'branch-logos'
        and (select role from profiles where profiles.id = auth.uid()) = 'admin'
      );

    drop policy if exists "branch_logos_admin_update" on storage.objects;
    create policy "branch_logos_admin_update" on storage.objects
      for update to authenticated
      using (
        bucket_id = 'branch-logos'
        and (select role from profiles where profiles.id = auth.uid()) = 'admin'
      );

    drop policy if exists "branch_logos_admin_delete" on storage.objects;
    create policy "branch_logos_admin_delete" on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'branch-logos'
        and (select role from profiles where profiles.id = auth.uid()) = 'admin'
      );

  end if;
end $$;

-- ------------------------------------------------------------
-- RPC de lectura pública: ahora devuelven también la marca
-- ------------------------------------------------------------
-- Siguen sin exponer NADA interno de la sucursal: solo lo que se dibuja en
-- la portada. Mismo criterio que 059.
--
-- El drop es obligatorio, no cosmético: `create or replace` NO puede cambiar
-- el tipo de retorno de una función que ya existe, y estas dos pasan de
-- devolver 3 columnas a devolver 6. Sin el drop, la migración falla con
-- "cannot change return type of existing function" (mismo gotcha que ya
-- había aparecido con report_by_period, ver ESTADO_SESION.md sección 3).
drop function if exists public.get_public_branch(uuid);
drop function if exists public.list_public_branches();

create or replace function public.get_public_branch(p_branch_id uuid default null)
returns table (
  id                  uuid,
  name                text,
  address             text,
  logo_url            text,
  welcome_title       text,
  welcome_description text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select b.id, b.name, b.address, b.logo_url, b.welcome_title, b.welcome_description
    from branches b
   where b.is_active
     and (p_branch_id is null or b.id = p_branch_id)
   order by b.name
   limit 1;
$function$;

create or replace function public.list_public_branches()
returns table (
  id                  uuid,
  name                text,
  address             text,
  logo_url            text,
  welcome_title       text,
  welcome_description text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select b.id, b.name, b.address, b.logo_url, b.welcome_title, b.welcome_description
    from branches b
   where b.is_active
   order by b.name;
$function$;

-- ------------------------------------------------------------
-- RPC de escritura: solo el admin de la sucursal
-- ------------------------------------------------------------
-- Mismo patrón de permisos que el resto del panel (ver 056_appointments.sql):
-- admin de la sucursal, o dueño de su propia sucursal.
create or replace function public.update_branch_branding(
  p_branch_id           uuid,
  p_name                text,
  p_address             text default null,
  p_logo_url            text default null,
  p_welcome_title       text default null,
  p_welcome_description text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if (select role from profiles where profiles.id = auth.uid()) is distinct from 'admin'
     or not coalesce(current_admin_has_branch(p_branch_id) or p_branch_id = current_user_branch(), false) then
    raise exception 'Sin permisos para configurar esta sucursal';
  end if;

  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'El nombre de la barbería no puede quedar vacío';
  end if;

  -- Los textos vacíos se guardan como null, no como '': así la pantalla
  -- pública tiene una sola condición que evaluar para caer al default.
  update branches
     set name                = btrim(p_name),
         address             = nullif(btrim(coalesce(p_address, '')), ''),
         logo_url            = nullif(btrim(coalesce(p_logo_url, '')), ''),
         welcome_title       = nullif(btrim(coalesce(p_welcome_title, '')), ''),
         welcome_description = nullif(btrim(coalesce(p_welcome_description, '')), '')
   where id = p_branch_id;
end;
$function$;

grant execute on function public.get_public_branch(uuid)     to anon, authenticated;
grant execute on function public.list_public_branches()      to anon, authenticated;
grant execute on function public.update_branch_branding(uuid, text, text, text, text, text) to authenticated;

$m072$;
  exception when others then
    raise exception 'FALLO LA MIGRACION 072_turnero_marca_de_la_sucursal.sql: % (SQLSTATE %)', sqlerrm, sqlstate;
  end;
  v_aplicadas := v_aplicadas || '072 ';

  begin
    execute $m073$
-- ============================================================
-- 073 — PORT de Flowi.estudio 065_whatsapp_sucursal.sql
-- Porte a BarberiaGest/Valhalla del 2026-10-15. NO SE APLICA SIN REVISION DE BRUNO.
-- Ver PORTING.md (turnero). Cambios respecto del original: chequeos NULL-safe
-- (is distinct from 'admin' / not coalesce(..., false)).
-- ============================================================

-- ============================================================
-- 065 — Número de WhatsApp de la sucursal
--
-- Lo carga el admin en /admin/marca. La reserva pública lo usa para el
-- botón "Enviarme por WhatsApp": abre WhatsApp en el teléfono del cliente
-- con el detalle del turno ya escrito, dirigido a la barbería.
--
-- Es una solución puente, a propósito. Los recordatorios AUTOMÁTICOS
-- exigen la API de WhatsApp Business de Meta (Embedded Signup + App
-- Review), que es un trámite de semanas. Este campo sirve igual para esa
-- etapa: es el número que después se registra en Meta.
--
-- El número es público (aparece en la pantalla de reserva) y eso está
-- bien: es el contacto comercial de la barbería, no un dato sensible.
-- ============================================================

alter table branches
  add column if not exists whatsapp_phone text;

comment on column branches.whatsapp_phone is
  'Numero de WhatsApp de la barberia, en formato internacional sin + ni espacios (ej: 5491122334455). Lo usa el link wa.me de la reserva publica.';

-- ------------------------------------------------------------
-- Lectura pública: agrega el teléfono
-- ------------------------------------------------------------
drop function if exists public.get_public_branch(uuid);

create or replace function public.get_public_branch(p_branch_id uuid default null)
returns table (
  id                  uuid,
  name                text,
  address             text,
  logo_url            text,
  welcome_title       text,
  welcome_description text,
  whatsapp_phone      text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select b.id, b.name, b.address, b.logo_url, b.welcome_title,
         b.welcome_description, b.whatsapp_phone
    from branches b
   where b.is_active
     and (p_branch_id is null or b.id = p_branch_id)
   order by b.name
   limit 1;
$function$;

-- ------------------------------------------------------------
-- Escritura: mismo patrón de permisos que 062
-- ------------------------------------------------------------
create or replace function public.update_branch_branding(
  p_branch_id           uuid,
  p_name                text,
  p_address             text default null,
  p_logo_url            text default null,
  p_welcome_title       text default null,
  p_welcome_description text default null,
  p_whatsapp_phone      text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_phone text;
begin
  if (select role from profiles where profiles.id = auth.uid()) is distinct from 'admin'
     or not coalesce(current_admin_has_branch(p_branch_id) or p_branch_id = current_user_branch(), false) then
    raise exception 'Sin permisos para configurar esta sucursal';
  end if;

  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'El nombre de la barbería no puede quedar vacío';
  end if;

  -- Se normaliza acá y no solo en el frontend: wa.me rechaza el link si el
  -- número trae +, espacios, guiones o paréntesis, y este RPC es la única
  -- puerta de escritura. Dejarlo al navegador significaría confiar en él.
  v_phone := nullif(regexp_replace(coalesce(p_whatsapp_phone, ''), '[^0-9]', '', 'g'), '');

  if v_phone is not null and length(v_phone) < 8 then
    raise exception 'El número de WhatsApp es demasiado corto: %', v_phone;
  end if;

  update branches
     set name                = btrim(p_name),
         address             = nullif(btrim(coalesce(p_address, '')), ''),
         logo_url            = nullif(btrim(coalesce(p_logo_url, '')), ''),
         welcome_title       = nullif(btrim(coalesce(p_welcome_title, '')), ''),
         welcome_description = nullif(btrim(coalesce(p_welcome_description, '')), ''),
         whatsapp_phone      = v_phone
   where id = p_branch_id;
end;
$function$;

-- La firma vieja de 6 argumentos queda huérfana: si no se borra, Postgres
-- mantiene las dos sobrecargas y una llamada con 6 parámetros seguiría
-- pegándole a la vieja, que no toca whatsapp_phone.
drop function if exists public.update_branch_branding(uuid, text, text, text, text, text);

grant execute on function public.get_public_branch(uuid) to anon, authenticated;
grant execute on function public.update_branch_branding(uuid, text, text, text, text, text, text) to authenticated;

$m073$;
  exception when others then
    raise exception 'FALLO LA MIGRACION 073_turnero_whatsapp_de_la_sucursal.sql: % (SQLSTATE %)', sqlerrm, sqlstate;
  end;
  v_aplicadas := v_aplicadas || '073 ';

  begin
    execute $m074$
-- ============================================================
-- 074 — PORT de Flowi.estudio 066_whatsapp_default_area_code.sql
-- Porte a BarberiaGest/Valhalla del 2026-10-15. NO SE APLICA SIN REVISION DE BRUNO.
-- Ver PORTING.md (turnero). Cambios respecto del original: sin los UPDATE de datos de Flowi; chequeos NULL-safe
-- (is distinct from 'admin' / not coalesce(..., false)).
-- ============================================================

-- ============================================================
-- 066 — Completado automático del WhatsApp: +54, el 9 de celular,
-- y un código de área por defecto configurable por sucursal.
--
-- Antes, /admin/marca guardaba el WhatsApp tal como se tipeaba, sin
-- agregar el país ni el 9 de celular que wa.me exige. El admin lo cargó
-- como "3417505219" y el link quedaba roto.
--
-- Ahora el admin puede escribir:
--   - el número local completo (área + número, 10 dígitos): "3417505219"
--   - o solo el número, sin área (6 a 8 dígitos): "7505219" -- y el
--     sistema completa el área con el default_area_code de la sucursal.
-- En los dos casos el RPC arma "54 9 <área><número>", el único formato
-- que wa.me acepta.
--
-- El código de área NO va hardcodeado en el código: es un dato de CADA
-- sucursal (default_area_code), porque este sistema se vende a
-- barberías de otras ciudades y cada una tiene el suyo.
-- ============================================================

alter table branches
  add column if not exists default_area_code text;

comment on column branches.default_area_code is
  'Codigo de area por defecto de la sucursal (2 a 4 digitos, sin 0), usado para completar el WhatsApp cuando se carga solo el numero local sin area. Ej: 341 para Rosario, 11 para AMBA.';

-- (Se omitieron dos UPDATE de datos propios de Flowi.estudio: el arreglo del formato viejo
-- de whatsapp_phone y la semilla de default_area_code = '341' para 'Sucursal Central'.
-- En Valhalla la columna whatsapp_phone es nueva y cada sucursal carga su codigo de area
-- desde /admin/marca.)

-- ------------------------------------------------------------
-- RPC de escritura, con la normalización nueva
-- ------------------------------------------------------------
drop function if exists public.update_branch_branding(uuid, text, text, text, text, text, text);

create or replace function public.update_branch_branding(
  p_branch_id           uuid,
  p_name                text,
  p_address             text default null,
  p_logo_url            text default null,
  p_welcome_title       text default null,
  p_welcome_description text default null,
  p_whatsapp_phone      text default null,
  p_default_area_code   text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_area   text;
  v_digits text;
  v_phone  text;
  v_glued  text[];
begin
  if (select role from profiles where profiles.id = auth.uid()) is distinct from 'admin'
     or not coalesce(current_admin_has_branch(p_branch_id) or p_branch_id = current_user_branch(), false) then
    raise exception 'Sin permisos para configurar esta sucursal';
  end if;

  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'El nombre de la barbería no puede quedar vacío';
  end if;

  v_area := nullif(regexp_replace(coalesce(p_default_area_code, ''), '[^0-9]', '', 'g'), '');
  if v_area is not null and length(v_area) not between 2 and 4 then
    raise exception 'El código de área tiene que tener entre 2 y 4 dígitos: %', v_area;
  end if;

  -- ── Normalización del WhatsApp ──────────────────────────────
  -- Acepta lo que el admin tipee: con o sin +54, con o sin el 0 nacional,
  -- con o sin el 15 pegado al área, y con o sin el área en sí (si falta,
  -- se completa con v_area). El orden de los pasos importa: el 0 nacional
  -- y el "15" pegado son formas de escribir el número SIN país, así que
  -- se resuelven antes de decidir si falta el área; el 9 de celular se
  -- saca al final porque solo aparece cuando el número ya viene completo
  -- (país + 9 + área + número = 11 dígitos tras sacar el 54).
  if p_whatsapp_phone is not null and btrim(p_whatsapp_phone) <> '' then
    v_digits := regexp_replace(p_whatsapp_phone, '[^0-9]', '', 'g');

    if v_digits like '0054%' then v_digits := substr(v_digits, 5); end if;
    if v_digits like '54%'   then v_digits := substr(v_digits, 3); end if;
    if v_digits like '0%'    then v_digits := regexp_replace(v_digits, '^0+', ''); end if;

    -- "15" pegado al área: 341 15 7505219 -> 3417505219
    v_glued := regexp_match(v_digits, '^(\d{2,4})15(\d{6,8})$');
    if v_glued is not null then v_digits := v_glued[1] || v_glued[2]; end if;

    if length(v_digits) = 11 and v_digits like '9%' then v_digits := substr(v_digits, 2); end if;

    if length(v_digits) between 6 and 8 then
      -- Solo vino el número local: falta el código de área.
      if v_area is null then
        raise exception 'Falta el código de área. Escribilo junto al número (ej: 3417505219), o cargá primero el código de área por defecto de la sucursal.';
      end if;
      v_digits := v_area || v_digits;
    end if;

    if length(v_digits) <> 10 then
      raise exception 'Número de WhatsApp inválido (quedaron % dígitos entre área y número, se esperan 10): %', length(v_digits), p_whatsapp_phone;
    end if;

    v_phone := '549' || v_digits;
  end if;

  update branches
     set name                = btrim(p_name),
         address             = nullif(btrim(coalesce(p_address, '')), ''),
         logo_url            = nullif(btrim(coalesce(p_logo_url, '')), ''),
         welcome_title       = nullif(btrim(coalesce(p_welcome_title, '')), ''),
         welcome_description = nullif(btrim(coalesce(p_welcome_description, '')), ''),
         whatsapp_phone      = v_phone,
         default_area_code   = v_area
   where id = p_branch_id;
end;
$function$;

grant execute on function public.update_branch_branding(uuid, text, text, text, text, text, text, text) to authenticated;

$m074$;
  exception when others then
    raise exception 'FALLO LA MIGRACION 074_turnero_codigo_de_area.sql: % (SQLSTATE %)', sqlerrm, sqlstate;
  end;
  v_aplicadas := v_aplicadas || '074 ';

  begin
    execute $m075$
-- ============================================================
-- 075 — PORT de Flowi.estudio 067_fix_list_public_branches_whatsapp.sql
-- Porte a BarberiaGest/Valhalla del 2026-10-15. NO SE APLICA SIN REVISION DE BRUNO.
-- Ver PORTING.md (turnero). Cambios respecto del original: chequeos NULL-safe
-- (is distinct from 'admin' / not coalesce(..., false)).
-- ============================================================

-- ============================================================
-- 067 — El botón de WhatsApp no aparecía: faltaba en la OTRA función
--
-- La reserva pública, con una sola sucursal activa (el caso real de este
-- deploy), no llama a get_public_branch(): llama a list_public_branches()
-- y usa la primera fila. La migración 065 solo le había agregado
-- whatsapp_phone a get_public_branch(); list_public_branches() se quedó
-- con la firma vieja, así que branch.whatsapp_phone llegaba undefined al
-- navegador y el botón nunca se mostraba, aunque el número estuviera bien
-- guardado en la base.
--
-- Verificado el bug reservando un turno de verdad en producción: con
-- whatsapp_phone cargado, la pantalla de confirmación no mostraba el botón.
-- ============================================================

drop function if exists public.list_public_branches();

create or replace function public.list_public_branches()
returns table (
  id                  uuid,
  name                text,
  address             text,
  logo_url            text,
  welcome_title       text,
  welcome_description text,
  whatsapp_phone      text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select b.id, b.name, b.address, b.logo_url, b.welcome_title,
         b.welcome_description, b.whatsapp_phone
    from branches b
   where b.is_active
   order by b.name;
$function$;

grant execute on function public.list_public_branches() to anon, authenticated;

$m075$;
  exception when others then
    raise exception 'FALLO LA MIGRACION 075_turnero_lista_publica_con_whatsapp.sql: % (SQLSTATE %)', sqlerrm, sqlstate;
  end;
  v_aplicadas := v_aplicadas || '075 ';

  begin
    execute $m076$
-- ============================================================
-- 076 — PORT de Flowi.estudio 068_whatsapp_reminder.sql
-- Porte a BarberiaGest/Valhalla del 2026-10-15. NO SE APLICA SIN REVISION DE BRUNO.
-- Ver PORTING.md (turnero). Cambios respecto del original: chequeos NULL-safe
-- (is distinct from 'admin' / not coalesce(..., false)).
-- ============================================================

-- ============================================================
-- 068 — Marca de "ya se mandó el recordatorio" del turno
--
-- El cron de recordatorios (app/api/cron/appointment-reminders) corre
-- cada 10 minutos y busca turnos que empiezan dentro de la próxima hora.
-- Sin esta columna, cada corrida volvería a mandar el mismo recordatorio
-- 6 veces (una por cada tick dentro de esa hora).
--
-- No hace falta una columna equivalente para la CONFIRMACIÓN: esa se
-- manda una sola vez, de forma síncrona, justo al reservar -- igual que
-- el mail (confirmar-email/route.ts), que tampoco tiene esa marca.
-- ============================================================

alter table appointments
  add column if not exists reminder_sent_at timestamptz;

comment on column appointments.reminder_sent_at is
  'Cuando se mando el recordatorio de WhatsApp (1h antes). Null = todavia no. La usa el cron para no mandar el mismo recordatorio mas de una vez.';

-- Índice parcial: el cron solo busca entre los turnos reservados sin
-- recordatorio todavía, así que es la única combinación que necesita
-- estar indexada -- no tiene sentido indexar turnos ya recordados o
-- cancelados para esta consulta.
create index if not exists idx_appointments_pending_reminder
  on appointments (starts_at)
  where status = 'reservado' and reminder_sent_at is null;

-- ------------------------------------------------------------
-- RPC que usa el cron para encontrar a quién recordarle
-- ------------------------------------------------------------
-- SOLO para service_role (la ruta app/api/cron/appointment-reminders,
-- llamada con SUPABASE_SERVICE_ROLE_KEY, nunca por un cliente logueado).
-- Devuelve teléfonos de clientes.
--
-- ⚠️ El `alter default privileges ... revoke execute on functions from
-- public` de 063_fix_grant_public_rpc.sql NO ALCANZA para esto -- se
-- verificó en producción (ver 069_revocar_anon_update_branding.sql) que
-- una función nueva sigue siendo ejecutable por `anon` y `authenticated`
-- aunque ese default esté puesto. Supabase le aplica su PROPIO default
-- (grant a anon/authenticated/service_role) a toda función nueva del
-- esquema public, y el `revoke ... from public` de 063 no lo pisa. La
-- única forma que se comprobó efectiva es el `revoke` EXPLÍCITO sobre
-- ESTA función, después de crearla -- por eso está acá abajo, y no
-- alcanza con simplemente "no otorgar" el execute a esos roles.
--
-- La ventana es "empieza dentro de la próxima hora, sin recordatorio
-- todavía" y no un rango angosto tipo "entre 55 y 65 minutos": así, si el
-- cron se salta una corrida (falla de red, deploy, lo que sea), la
-- siguiente corrida igual encuentra el turno y lo recuerda, en vez de
-- perderlo para siempre por haberse salido de una ventana fija.
create or replace function public.get_appointments_due_for_reminder(p_minutes_ahead integer default 60)
returns table (
  appointment_id uuid,
  reference      text,
  starts_at      timestamptz,
  client_name    text,
  client_phone   text,
  branch_name    text,
  services       text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select a.id, a.reference, a.starts_at, c.full_name, c.phone, b.name,
         (select string_agg(aps.service_name, ', ' order by aps.service_name)
            from appointment_services aps
           where aps.appointment_id = a.id)
    from appointments a
    join appointment_clients c on c.id = a.client_id
    join branches b on b.id = a.branch_id
   where a.status = 'reservado'
     and a.reminder_sent_at is null
     and a.starts_at > now()
     and a.starts_at <= now() + make_interval(mins => p_minutes_ahead);
$function$;

grant execute on function public.get_appointments_due_for_reminder(integer) to service_role;
revoke execute on function public.get_appointments_due_for_reminder(integer) from anon, authenticated, public;

$m076$;
  exception when others then
    raise exception 'FALLO LA MIGRACION 076_turnero_recordatorio_de_turno.sql: % (SQLSTATE %)', sqlerrm, sqlstate;
  end;
  v_aplicadas := v_aplicadas || '076 ';

  begin
    execute $m077$
-- ============================================================
-- 077 — PORT de Flowi.estudio 069_revocar_anon_update_branding.sql
-- Porte a BarberiaGest/Valhalla del 2026-10-15. NO SE APLICA SIN REVISION DE BRUNO.
-- Ver PORTING.md (turnero). Cambios respecto del original: chequeos NULL-safe
-- (is distinct from 'admin' / not coalesce(..., false)).
-- ============================================================

-- ============================================================
-- 069 — 🔴 SEGURIDAD: update_branch_branding era ejecutable por `anon`
-- ============================================================
--
-- Encontrado el 2026-08-26 mientras se armaba 068 (recordatorios de
-- WhatsApp): al revisar el ACL real de update_branch_branding en
-- producción, tenía `anon=X` -- cualquiera SIN sesión podía llamarla.
--
-- Causa raíz: el `alter default privileges in schema public revoke
-- execute on functions from public` con el que termina
-- 063_fix_grant_public_rpc.sql NO SIRVE en este proyecto de Supabase.
-- Se verificó en vivo, contra la base real: después de correr ese
-- default y crear una función de prueba nueva, `anon` la pudo ejecutar
-- igual. Supabase aplica su PROPIO default (grant a
-- anon/authenticated/service_role) a toda función nueva del esquema
-- public, y el intento de 063 no lo pisa -- ni apuntando a PUBLIC ni a
-- los roles por nombre. La ÚNICA forma que se comprobó efectiva es el
-- `revoke` EXPLÍCITO sobre la función puntual, después de crearla (el
-- mismo mecanismo que 063 ya usaba para reset_admin_password y
-- create_admin_auth_user en su sección 4 -- ahí sí funcionaba, porque
-- era explícito por función, no un default).
--
-- update_branch_branding es una función nueva (062, con firma
-- reemplazada en 065 y 066), creada DESPUÉS de 063 -- exactamente el
-- caso que el default (ineficaz) de 063 debía cubrir y no cubrió.
--
-- Impacto real: cualquiera en internet, sin login, podía reescribir el
-- nombre, dirección, logo, mensaje de bienvenida y WhatsApp de la
-- sucursal que se muestra en /reservar.
--
-- Se revoca el acceso Y se blinda la lógica interna (que tenía su
-- propio problema: con auth.uid() = null, la condición del chequeo
-- daba NULL en vez de TRUE/FALSE, y en PL/pgSQL un `IF NULL THEN` NO
-- dispara -- la función seguía de largo. Con coalesce(..., true) un
-- NULL ahora se trata como "sin permiso", no como "permitido"). Las dos
-- capas quedan: aunque alguna vuelva a fallar, la otra sigue cerrando.
-- ============================================================

revoke execute on function public.update_branch_branding(uuid, text, text, text, text, text, text, text)
  from anon, public;

create or replace function public.update_branch_branding(
  p_branch_id           uuid,
  p_name                text,
  p_address             text default null,
  p_logo_url            text default null,
  p_welcome_title       text default null,
  p_welcome_description text default null,
  p_whatsapp_phone      text default null,
  p_default_area_code   text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_area   text;
  v_digits text;
  v_phone  text;
  v_glued  text[];
begin
  -- coalesce(..., true): si CUALQUIER parte de la condición da NULL
  -- (auth.uid() sin perfil, por ejemplo), se trata como "hay que
  -- bloquear" y no como "no hay que bloquear". Antes, un llamador sin
  -- sesión hacía que toda la expresión diera NULL, y un `IF NULL` en
  -- PL/pgSQL no dispara el `raise exception` -- la función seguía.
  if coalesce(
       (select role from profiles where profiles.id = auth.uid()) is distinct from 'admin'
       or not coalesce(current_admin_has_branch(p_branch_id) or p_branch_id = current_user_branch(), false),
       true
     )
  then
    raise exception 'Sin permisos para configurar esta sucursal';
  end if;

  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'El nombre de la barbería no puede quedar vacío';
  end if;

  v_area := nullif(regexp_replace(coalesce(p_default_area_code, ''), '[^0-9]', '', 'g'), '');
  if v_area is not null and length(v_area) not between 2 and 4 then
    raise exception 'El código de área tiene que tener entre 2 y 4 dígitos: %', v_area;
  end if;

  if p_whatsapp_phone is not null and btrim(p_whatsapp_phone) <> '' then
    v_digits := regexp_replace(p_whatsapp_phone, '[^0-9]', '', 'g');

    if v_digits like '0054%' then v_digits := substr(v_digits, 5); end if;
    if v_digits like '54%'   then v_digits := substr(v_digits, 3); end if;
    if v_digits like '0%'    then v_digits := regexp_replace(v_digits, '^0+', ''); end if;

    v_glued := regexp_match(v_digits, '^(\d{2,4})15(\d{6,8})$');
    if v_glued is not null then v_digits := v_glued[1] || v_glued[2]; end if;

    if length(v_digits) = 11 and v_digits like '9%' then v_digits := substr(v_digits, 2); end if;

    if length(v_digits) between 6 and 8 then
      if v_area is null then
        raise exception 'Falta el código de área. Escribilo junto al número (ej: 3417505219), o cargá primero el código de área por defecto de la sucursal.';
      end if;
      v_digits := v_area || v_digits;
    end if;

    if length(v_digits) <> 10 then
      raise exception 'Número de WhatsApp inválido (quedaron % dígitos entre área y número, se esperan 10): %', length(v_digits), p_whatsapp_phone;
    end if;

    v_phone := '549' || v_digits;
  end if;

  update branches
     set name                = btrim(p_name),
         address             = nullif(btrim(coalesce(p_address, '')), ''),
         logo_url            = nullif(btrim(coalesce(p_logo_url, '')), ''),
         welcome_title       = nullif(btrim(coalesce(p_welcome_title, '')), ''),
         welcome_description = nullif(btrim(coalesce(p_welcome_description, '')), ''),
         whatsapp_phone      = v_phone,
         default_area_code   = v_area
   where id = p_branch_id;
end;
$function$;

-- CREATE OR REPLACE preserva los grants existentes, pero se re-afirma
-- el revoke igual: si algo llegó a re-otorgarle a anon entre medio (por
-- ejemplo, un `create or replace` sin este statement en el futuro),
-- esta migración por sí sola vuelve a dejarlo cerrado.
revoke execute on function public.update_branch_branding(uuid, text, text, text, text, text, text, text)
  from anon, public;
grant execute on function public.update_branch_branding(uuid, text, text, text, text, text, text, text)
  to authenticated;

$m077$;
  exception when others then
    raise exception 'FALLO LA MIGRACION 077_turnero_blindaje_de_la_marca.sql: % (SQLSTATE %)', sqlerrm, sqlstate;
  end;
  v_aplicadas := v_aplicadas || '077 ';

  begin
    execute $m078$
-- ============================================================
-- 078 — PORT de Flowi.estudio 071_barber_photos.sql
-- Porte a BarberiaGest/Valhalla del 2026-10-15. NO SE APLICA SIN REVISION DE BRUNO.
-- Ver PORTING.md (turnero). Cambios respecto del original: bucket con tope de tamano y tipos; chequeos NULL-safe
-- (is distinct from 'admin' / not coalesce(..., false)).
-- ============================================================

-- ============================================================
-- 071 — Foto de perfil del barbero, cargada por el admin
-- ============================================================
-- Mismo patrón que 062_branding_sucursal.sql (logo de la sucursal),
-- aplicado a barberos en vez de sucursales. La sube el ADMIN desde
-- /admin/barberos, no cada barbero desde su propio mobile -- decisión
-- explícita del usuario al pedir esta mejora.
--
-- No hace falta RPC nueva para escribir `avatar_url`: la política
-- `profiles_admin_update` (001_initial_schema.sql) ya deja que un admin
-- actualice cualquier columna de un barbero de su sucursal -- es la misma
-- que ya usa updateBarberProfile() para comisión, sueldo, etc. Agregar una
-- columna no agrega superficie de escritura nueva.
-- ============================================================

alter table profiles
  add column if not exists avatar_url text;

comment on column profiles.avatar_url is
  'Foto de perfil del barbero, cargada por el admin. URL publica del bucket barber-photos.';

-- ------------------------------------------------------------
-- Bucket de fotos
-- ------------------------------------------------------------
-- Público de lectura: la foto se muestra en pantallas propias del sistema
-- (barberos-abm, mobile del barbero), pero no hay necesidad de esconderla
-- detrás de auth -- no es un dato sensible, y mantenerlo público evita
-- tener que firmar URLs cada vez que se muestra.
--
-- Va todo dentro del guard de siempre: el esquema `storage` lo crea Supabase
-- al aprovisionar el proyecto y NO existe en un Postgres pelado. Sin esto,
-- la migración rompería el método de verificación del proyecto (correr
-- supabase/migrations/*.sql de punta a punta en una base limpia).
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then

    -- Tope de 3 MB y solo imagenes (BARBER_PHOTO_MAX_BYTES): viene de la seccion 5 de la 106 de Flowi.
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('barber-photos', 'barber-photos', true, 3 * 1024 * 1024,
            array['image/png', 'image/jpeg', 'image/webp'])
    on conflict (id) do update set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

    drop policy if exists "barber_photos_public_read" on storage.objects;
    create policy "barber_photos_public_read" on storage.objects
      for select to anon, authenticated
      using (bucket_id = 'barber-photos');

    -- Escritura solo para admins -- mismo criterio que branch-logos: no se
    -- acota por sucursal, un admin de este sistema ya administra la
    -- instalación entera (1 cliente = 1 deploy).
    drop policy if exists "barber_photos_admin_write" on storage.objects;
    create policy "barber_photos_admin_write" on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'barber-photos'
        and (select role from profiles where profiles.id = auth.uid()) = 'admin'
      );

    drop policy if exists "barber_photos_admin_update" on storage.objects;
    create policy "barber_photos_admin_update" on storage.objects
      for update to authenticated
      using (
        bucket_id = 'barber-photos'
        and (select role from profiles where profiles.id = auth.uid()) = 'admin'
      );

    drop policy if exists "barber_photos_admin_delete" on storage.objects;
    create policy "barber_photos_admin_delete" on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'barber-photos'
        and (select role from profiles where profiles.id = auth.uid()) = 'admin'
      );

  end if;
end $$;

$m078$;
  exception when others then
    raise exception 'FALLO LA MIGRACION 078_turnero_foto_del_barbero.sql: % (SQLSTATE %)', sqlerrm, sqlstate;
  end;
  v_aplicadas := v_aplicadas || '078 ';

  begin
    execute $m079$
-- ============================================================
-- 079 — PORT de Flowi.estudio 078_public_barber_photos.sql
-- Porte a BarberiaGest/Valhalla del 2026-10-15. NO SE APLICA SIN REVISION DE BRUNO.
-- Ver PORTING.md (turnero). Cambios respecto del original: chequeos NULL-safe
-- (is distinct from 'admin' / not coalesce(..., false)).
-- ============================================================

-- ============================================================
-- 078 — Foto del barbero en la reserva pública
-- ============================================================
-- profiles.avatar_url ya existe (071_barber_photos.sql, uso interno del
-- admin) -- esto solo la suma a la RPC pública que ya lista barberos para
-- reservar, para que el cliente vea con quién elige.
--
-- El drop es obligatorio: create or replace no puede cambiar el
-- RETURNS TABLE de una función existente (mismo gotcha de 062/065).
-- ============================================================

drop function if exists public.get_public_barbers(uuid);

create or replace function public.get_public_barbers(p_branch_id uuid)
returns table (id uuid, full_name text, avatar_url text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select distinct p.id, p.full_name, p.avatar_url
    from profiles p
    join barber_schedules bs on bs.barber_id = p.id and bs.mode = 'turno'
   where p.branch_id = p_branch_id
     and p.is_active
   order by p.full_name;
$function$;

grant execute on function public.get_public_barbers(uuid) to anon, authenticated;

$m079$;
  exception when others then
    raise exception 'FALLO LA MIGRACION 079_turnero_foto_en_la_reserva.sql: % (SQLSTATE %)', sqlerrm, sqlstate;
  end;
  v_aplicadas := v_aplicadas || '079 ';

  begin
    execute $m080$
-- ============================================================
-- 080 — PORT de Flowi.estudio 097_encabezado_y_mapa_reserva.sql
-- Porte a BarberiaGest/Valhalla del 2026-10-15. NO SE APLICA SIN REVISION DE BRUNO.
-- Ver PORTING.md (turnero). Cambios respecto del original: chequeos NULL-safe
-- (is distinct from 'admin' / not coalesce(..., false)).
-- ============================================================

-- ============================================================
-- 097 — Encabezado de marca y mapa en el selector de sucursales
-- ============================================================
-- Con 2+ sucursales activas, /reservar muestra primero un selector
-- ("¿A qué sucursal querés ir?") sin ningún encabezado propio: no hay logo,
-- no hay nombre de la barbería como marca general, no hay mapa. Cada
-- sucursal SÍ tiene su propia marca (062_branding_sucursal.sql), pero eso es
-- por sucursal -- no hay hoy un concepto de "marca general" del negocio.
--
-- En vez de crear una entidad nueva (tabla de organización), se resuelve
-- reusando una sucursal como fuente del encabezado general: el admin marca
-- UNA sola sucursal con booking_header_enabled, y esa es la que presta su
-- nombre/logo para el selector. Se puede usar el mismo logo_url que ya
-- tiene esa sucursal, o cargar uno aparte (booking_header_logo_url) solo
-- para esta pantalla, sin pisar el logo propio de la sucursal.
--
-- La exclusividad (una sola sucursal a la vez) se garantiza con un índice
-- único parcial, no solo a nivel aplicación: dos admins guardando al mismo
-- tiempo no pueden dejar dos sucursales marcadas.
--
-- De paso, se agregan latitude/longitude (nullable, sin geocoding
-- automático: el admin las pega desde Google Maps) para poder pintar las
-- tres sucursales en un mapa Leaflet/OpenStreetMap en esa misma pantalla.
--
-- 🔒 Nota de seguridad (ver 069_revocar_anon_update_branding.sql): acá se
-- le agregan 4 parámetros nuevos a update_branch_branding. Un
-- `create or replace function` con una lista de parámetros DISTINTA a la
-- que ya existe no reemplaza la función vieja -- crea una firma nueva, y
-- Supabase aplica su propio grant automático a `anon` a toda función nueva
-- del esquema public (comprobado en 069 contra la base real; el intento de
-- `alter default privileges` de 063 no lo evita). Por eso acá se dropea la
-- firma vieja de 8 parámetros Y se vuelve a revocar `anon`/`public`
-- explícitamente después de crear la de 12 -- exactamente el patrón de 069.
-- ============================================================

alter table branches
  add column if not exists booking_header_enabled  boolean not null default false,
  add column if not exists booking_header_logo_url  text,
  add column if not exists latitude                 numeric(9,6),
  add column if not exists longitude                numeric(9,6);

comment on column branches.booking_header_enabled is
  'Si es true, esta sucursal presta su nombre (welcome_title/name) y logo para el encabezado del selector de sucursales en /reservar. A lo sumo una sucursal activa puede tenerlo en true (ver branches_one_booking_header).';
comment on column branches.booking_header_logo_url is
  'Logo alternativo SOLO para el encabezado del selector de sucursales. Si es null, se usa logo_url (el logo propio de la sucursal).';
comment on column branches.latitude is
  'Latitud para el mapa de /reservar. Se carga a mano desde /admin/marca (Google Maps: click derecho sobre el punto -> copiar coordenadas).';
comment on column branches.longitude is
  'Longitud para el mapa de /reservar. Ver comentario de latitude.';

-- Exclusividad: como mucho una sucursal con booking_header_enabled = true.
-- Índice único parcial sobre una expresión constante: todas las filas que
-- matchean el where quedarían con el mismo valor indexado, así que una
-- segunda fila con booking_header_enabled = true rompe la unicidad.
drop index if exists branches_one_booking_header;
create unique index branches_one_booking_header
  on branches ((true))
  where booking_header_enabled;

-- ------------------------------------------------------------
-- get_booking_header(): título + logo para el encabezado del selector
-- ------------------------------------------------------------
-- Función nueva, sin `anon` en el ACL automático de Supabase, así que el
-- grant explícito de abajo SÍ hace falta (a diferencia de update_branch_
-- branding, acá el acceso de anon es el comportamiento correcto: la llama
-- /reservar sin sesión, igual que list_public_branches).
--
-- Devuelve 0 filas si ninguna sucursal está marcada -- la pantalla pública
-- cae al comportamiento de siempre (sin encabezado extra) sin configurar
-- nada, igual criterio que el resto de la marca (062).
create or replace function public.get_booking_header()
returns table (title text, logo_url text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(b.welcome_title, b.name), coalesce(b.booking_header_logo_url, b.logo_url)
    from branches b
   where b.is_active
     and b.booking_header_enabled
   limit 1;
$function$;

grant execute on function public.get_booking_header() to anon, authenticated;

-- ------------------------------------------------------------
-- list_public_branches() / get_public_branch(): suman latitude/longitude
-- ------------------------------------------------------------
-- El drop es obligatorio: create or replace no puede cambiar el tipo de
-- retorno de una función existente (mismo gotcha que 062 y 067). El acceso
-- de anon acá es correcto y ya era así -- se reafirma el grant nomás.
drop function if exists public.list_public_branches();
drop function if exists public.get_public_branch(uuid);

create or replace function public.list_public_branches()
returns table (
  id                  uuid,
  name                text,
  address             text,
  logo_url            text,
  welcome_title       text,
  welcome_description text,
  whatsapp_phone      text,
  latitude            numeric,
  longitude           numeric
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select b.id, b.name, b.address, b.logo_url, b.welcome_title,
         b.welcome_description, b.whatsapp_phone, b.latitude, b.longitude
    from branches b
   where b.is_active
   order by b.name;
$function$;

create or replace function public.get_public_branch(p_branch_id uuid default null)
returns table (
  id                  uuid,
  name                text,
  address             text,
  logo_url            text,
  welcome_title       text,
  welcome_description text,
  whatsapp_phone      text,
  latitude            numeric,
  longitude           numeric
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select b.id, b.name, b.address, b.logo_url, b.welcome_title, b.welcome_description,
         b.whatsapp_phone, b.latitude, b.longitude
    from branches b
   where b.is_active
     and (p_branch_id is null or b.id = p_branch_id)
   order by b.name
   limit 1;
$function$;

grant execute on function public.list_public_branches()  to anon, authenticated;
grant execute on function public.get_public_branch(uuid)  to anon, authenticated;

-- ------------------------------------------------------------
-- update_branch_branding(): suma los 4 campos nuevos + chequeo de exclusividad
-- ------------------------------------------------------------
-- Firma vieja (8 parámetros, de 066/069) fuera -- ver nota de seguridad del
-- encabezado del archivo.
drop function if exists public.update_branch_branding(uuid, text, text, text, text, text, text, text);

create or replace function public.update_branch_branding(
  p_branch_id                  uuid,
  p_name                       text,
  p_address                    text default null,
  p_logo_url                   text default null,
  p_welcome_title              text default null,
  p_welcome_description        text default null,
  p_whatsapp_phone             text default null,
  p_default_area_code          text default null,
  p_booking_header_enabled     boolean default false,
  p_booking_header_logo_url    text default null,
  p_latitude                   numeric default null,
  p_longitude                  numeric default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_area   text;
  v_digits text;
  v_phone  text;
  v_glued  text[];
begin
  -- coalesce(..., true): ver 069 -- un NULL en la condición (por ejemplo,
  -- auth.uid() sin perfil) tiene que tratarse como "bloquear", no como
  -- "permitir" (un `IF NULL THEN` en PL/pgSQL no dispara).
  if coalesce(
       (select role from profiles where profiles.id = auth.uid()) is distinct from 'admin'
       or not coalesce(current_admin_has_branch(p_branch_id) or p_branch_id = current_user_branch(), false),
       true
     )
  then
    raise exception 'Sin permisos para configurar esta sucursal';
  end if;

  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'El nombre de la barbería no puede quedar vacío';
  end if;

  v_area := nullif(regexp_replace(coalesce(p_default_area_code, ''), '[^0-9]', '', 'g'), '');
  if v_area is not null and length(v_area) not between 2 and 4 then
    raise exception 'El código de área tiene que tener entre 2 y 4 dígitos: %', v_area;
  end if;

  -- ── Normalización del WhatsApp (sin cambios respecto de 069) ────────
  if p_whatsapp_phone is not null and btrim(p_whatsapp_phone) <> '' then
    v_digits := regexp_replace(p_whatsapp_phone, '[^0-9]', '', 'g');

    if v_digits like '0054%' then v_digits := substr(v_digits, 5); end if;
    if v_digits like '54%'   then v_digits := substr(v_digits, 3); end if;
    if v_digits like '0%'    then v_digits := regexp_replace(v_digits, '^0+', ''); end if;

    v_glued := regexp_match(v_digits, '^(\d{2,4})15(\d{6,8})$');
    if v_glued is not null then v_digits := v_glued[1] || v_glued[2]; end if;

    if length(v_digits) = 11 and v_digits like '9%' then v_digits := substr(v_digits, 2); end if;

    if length(v_digits) between 6 and 8 then
      if v_area is null then
        raise exception 'Falta el código de área. Escribilo junto al número (ej: 3417505219), o cargá primero el código de área por defecto de la sucursal.';
      end if;
      v_digits := v_area || v_digits;
    end if;

    if length(v_digits) <> 10 then
      raise exception 'Número de WhatsApp inválido (quedaron % dígitos entre área y número, se esperan 10): %', length(v_digits), p_whatsapp_phone;
    end if;

    v_phone := '549' || v_digits;
  end if;

  -- Chequeo de exclusividad ANTES del update: da un mensaje legible en vez
  -- de que el cliente reciba la violación cruda del índice único parcial
  -- (que igual queda como red de seguridad ante una carrera entre dos
  -- admins guardando al mismo tiempo).
  if coalesce(p_booking_header_enabled, false) and exists (
    select 1 from branches
     where booking_header_enabled
       and id <> p_branch_id
  ) then
    raise exception 'Ya hay otra sucursal marcada para el encabezado de la reserva. Sacale esa marca ahí antes de asignarla acá.';
  end if;

  update branches
     set name                      = btrim(p_name),
         address                   = nullif(btrim(coalesce(p_address, '')), ''),
         logo_url                  = nullif(btrim(coalesce(p_logo_url, '')), ''),
         welcome_title             = nullif(btrim(coalesce(p_welcome_title, '')), ''),
         welcome_description       = nullif(btrim(coalesce(p_welcome_description, '')), ''),
         whatsapp_phone            = v_phone,
         default_area_code         = v_area,
         booking_header_enabled    = coalesce(p_booking_header_enabled, false),
         booking_header_logo_url   = nullif(btrim(coalesce(p_booking_header_logo_url, '')), ''),
         latitude                  = p_latitude,
         longitude                 = p_longitude
   where id = p_branch_id;
end;
$function$;

-- Re-blindaje explícito, igual que 069: no alcanza con NO otorgarle a
-- anon -- hay que revocárselo a mano porque el default del proyecto se lo
-- concede solo.
revoke execute on function public.update_branch_branding(
  uuid, text, text, text, text, text, text, text, boolean, text, numeric, numeric
) from anon, public;
grant execute on function public.update_branch_branding(
  uuid, text, text, text, text, text, text, text, boolean, text, numeric, numeric
) to authenticated;

$m080$;
  exception when others then
    raise exception 'FALLO LA MIGRACION 080_turnero_encabezado_y_mapa.sql: % (SQLSTATE %)', sqlerrm, sqlstate;
  end;
  v_aplicadas := v_aplicadas || '080 ';

  begin
    execute $m081$
-- ============================================================
-- 081 — PORT de Flowi.estudio 098_horario_de_atencion.sql
-- Porte a BarberiaGest/Valhalla del 2026-10-15. NO SE APLICA SIN REVISION DE BRUNO.
-- Ver PORTING.md (turnero). Cambios respecto del original: chequeos NULL-safe
-- (is distinct from 'admin' / not coalesce(..., false)).
-- ============================================================

-- ============================================================
-- 098 — Horario de atención por sucursal, en la tarjeta del selector
-- ============================================================
-- No existía ningún concepto de "horario de la sucursal": lo único
-- parecido son barber_schedules (por barbero, para calcular
-- disponibilidad de turnos), que no es lo mismo que "el local abre de
-- tal a tal". Se agrega un campo propio, cargado a mano por el admin
-- (no derivado de barber_schedules) para que el dato mostrado en
-- /reservar sea exactamente el que la barbería quiere mostrar.
--
-- Se guarda como jsonb en vez de una tabla aparte, siguiendo el mismo
-- patrón que el resto de la marca (062/097): todo pasa por
-- update_branch_branding en una sola llamada. Forma: array de 7
-- objetos {weekday, open, close}, weekday 0=domingo..6=sábado (mismo
-- criterio que barber_schedules y extract(dow)), open/close "HH:MM".
-- Un día en "00:00"/"00:00" se interpreta como cerrado ese día -- no
-- hace falta un booleano aparte, y así el default (todo en cero) ya es
-- un estado válido ("sin configurar todavía" = "no mostrar ese día").
--
-- 🔒 Mismo aviso de seguridad que 097: update_branch_branding suma un
-- parámetro más, lo que cambia su firma -- hay que dropear la vieja y
-- volver a revocar anon/public de la nueva (ver 069_revocar_anon_
-- update_branch_branding.sql), porque Supabase le da grant a anon por
-- default a toda función nueva del esquema public.
-- ============================================================

alter table branches
  add column if not exists business_hours jsonb not null default (
    '[
      {"weekday":0,"open":"00:00","close":"00:00"},
      {"weekday":1,"open":"00:00","close":"00:00"},
      {"weekday":2,"open":"00:00","close":"00:00"},
      {"weekday":3,"open":"00:00","close":"00:00"},
      {"weekday":4,"open":"00:00","close":"00:00"},
      {"weekday":5,"open":"00:00","close":"00:00"},
      {"weekday":6,"open":"00:00","close":"00:00"}
    ]'::jsonb
  );

comment on column branches.business_hours is
  'Horario de atención, cargado a mano en /admin/marca (no se deriva de barber_schedules). Array de 7 {weekday, open, close}, weekday 0=domingo..6=sabado, open/close "HH:MM". "00:00"/"00:00" = cerrado ese dia o sin configurar.';

-- ------------------------------------------------------------
-- list_public_branches() / get_public_branch(): suman business_hours
-- ------------------------------------------------------------
drop function if exists public.list_public_branches();
drop function if exists public.get_public_branch(uuid);

create or replace function public.list_public_branches()
returns table (
  id                  uuid,
  name                text,
  address             text,
  logo_url            text,
  welcome_title       text,
  welcome_description text,
  whatsapp_phone      text,
  latitude            numeric,
  longitude           numeric,
  business_hours      jsonb
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select b.id, b.name, b.address, b.logo_url, b.welcome_title,
         b.welcome_description, b.whatsapp_phone, b.latitude, b.longitude,
         b.business_hours
    from branches b
   where b.is_active
   order by b.name;
$function$;

create or replace function public.get_public_branch(p_branch_id uuid default null)
returns table (
  id                  uuid,
  name                text,
  address             text,
  logo_url            text,
  welcome_title       text,
  welcome_description text,
  whatsapp_phone      text,
  latitude            numeric,
  longitude           numeric,
  business_hours      jsonb
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select b.id, b.name, b.address, b.logo_url, b.welcome_title, b.welcome_description,
         b.whatsapp_phone, b.latitude, b.longitude, b.business_hours
    from branches b
   where b.is_active
     and (p_branch_id is null or b.id = p_branch_id)
   order by b.name
   limit 1;
$function$;

grant execute on function public.list_public_branches()  to anon, authenticated;
grant execute on function public.get_public_branch(uuid)  to anon, authenticated;

-- ------------------------------------------------------------
-- update_branch_branding(): suma p_business_hours
-- ------------------------------------------------------------
drop function if exists public.update_branch_branding(
  uuid, text, text, text, text, text, text, text, boolean, text, numeric, numeric
);

create or replace function public.update_branch_branding(
  p_branch_id                  uuid,
  p_name                       text,
  p_address                    text default null,
  p_logo_url                   text default null,
  p_welcome_title              text default null,
  p_welcome_description        text default null,
  p_whatsapp_phone             text default null,
  p_default_area_code          text default null,
  p_booking_header_enabled     boolean default false,
  p_booking_header_logo_url    text default null,
  p_latitude                   numeric default null,
  p_longitude                  numeric default null,
  p_business_hours             jsonb default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_area   text;
  v_digits text;
  v_phone  text;
  v_glued  text[];
begin
  if coalesce(
       (select role from profiles where profiles.id = auth.uid()) is distinct from 'admin'
       or not coalesce(current_admin_has_branch(p_branch_id) or p_branch_id = current_user_branch(), false),
       true
     )
  then
    raise exception 'Sin permisos para configurar esta sucursal';
  end if;

  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'El nombre de la barbería no puede quedar vacío';
  end if;

  -- Validación liviana: 7 días, mismo criterio que el resto de esta
  -- función (no se valida formato de texto libre como address/welcome_*,
  -- pero acá sí conviene: un array corrupto rompería la tarjeta pública).
  if p_business_hours is not null and jsonb_array_length(p_business_hours) <> 7 then
    raise exception 'El horario tiene que tener los 7 días de la semana';
  end if;

  v_area := nullif(regexp_replace(coalesce(p_default_area_code, ''), '[^0-9]', '', 'g'), '');
  if v_area is not null and length(v_area) not between 2 and 4 then
    raise exception 'El código de área tiene que tener entre 2 y 4 dígitos: %', v_area;
  end if;

  if p_whatsapp_phone is not null and btrim(p_whatsapp_phone) <> '' then
    v_digits := regexp_replace(p_whatsapp_phone, '[^0-9]', '', 'g');

    if v_digits like '0054%' then v_digits := substr(v_digits, 5); end if;
    if v_digits like '54%'   then v_digits := substr(v_digits, 3); end if;
    if v_digits like '0%'    then v_digits := regexp_replace(v_digits, '^0+', ''); end if;

    v_glued := regexp_match(v_digits, '^(\d{2,4})15(\d{6,8})$');
    if v_glued is not null then v_digits := v_glued[1] || v_glued[2]; end if;

    if length(v_digits) = 11 and v_digits like '9%' then v_digits := substr(v_digits, 2); end if;

    if length(v_digits) between 6 and 8 then
      if v_area is null then
        raise exception 'Falta el código de área. Escribilo junto al número (ej: 3417505219), o cargá primero el código de área por defecto de la sucursal.';
      end if;
      v_digits := v_area || v_digits;
    end if;

    if length(v_digits) <> 10 then
      raise exception 'Número de WhatsApp inválido (quedaron % dígitos entre área y número, se esperan 10): %', length(v_digits), p_whatsapp_phone;
    end if;

    v_phone := '549' || v_digits;
  end if;

  if coalesce(p_booking_header_enabled, false) and exists (
    select 1 from branches
     where booking_header_enabled
       and id <> p_branch_id
  ) then
    raise exception 'Ya hay otra sucursal marcada para el encabezado de la reserva. Sacale esa marca ahí antes de asignarla acá.';
  end if;

  update branches
     set name                      = btrim(p_name),
         address                   = nullif(btrim(coalesce(p_address, '')), ''),
         logo_url                  = nullif(btrim(coalesce(p_logo_url, '')), ''),
         welcome_title             = nullif(btrim(coalesce(p_welcome_title, '')), ''),
         welcome_description       = nullif(btrim(coalesce(p_welcome_description, '')), ''),
         whatsapp_phone            = v_phone,
         default_area_code         = v_area,
         booking_header_enabled    = coalesce(p_booking_header_enabled, false),
         booking_header_logo_url   = nullif(btrim(coalesce(p_booking_header_logo_url, '')), ''),
         latitude                  = p_latitude,
         longitude                 = p_longitude,
         business_hours            = coalesce(p_business_hours, business_hours)
   where id = p_branch_id;
end;
$function$;

revoke execute on function public.update_branch_branding(
  uuid, text, text, text, text, text, text, text, boolean, text, numeric, numeric, jsonb
) from anon, public;
grant execute on function public.update_branch_branding(
  uuid, text, text, text, text, text, text, text, boolean, text, numeric, numeric, jsonb
) to authenticated;

$m081$;
  exception when others then
    raise exception 'FALLO LA MIGRACION 081_turnero_horario_de_atencion.sql: % (SQLSTATE %)', sqlerrm, sqlstate;
  end;
  v_aplicadas := v_aplicadas || '081 ';

  begin
    execute $m082$
-- ============================================================
-- 082 — PORT de Flowi.estudio 099_recordatorio_branch_id.sql
-- Porte a BarberiaGest/Valhalla del 2026-10-15. NO SE APLICA SIN REVISION DE BRUNO.
-- Ver PORTING.md (turnero). Cambios respecto del original: chequeos NULL-safe
-- (is distinct from 'admin' / not coalesce(..., false)).
-- ============================================================

-- ============================================================
-- 099 — branch_id en get_appointments_due_for_reminder
-- ============================================================
-- El recordatorio de WhatsApp va a sumar un botón "Gestionar mi turno" que
-- linkea a /reservar/gestionar?ref=...&sucursal=... -- mismo patrón que ya
-- usa confirmar-email/route.ts y confirmar-whatsapp/route.ts para que
-- "reservar otro turno" desde ahí vuelva a la misma sucursal en vez del
-- selector. Para eso el cron necesita el branch_id, no solo el nombre.
--
-- El drop es obligatorio: create or replace no puede cambiar el
-- RETURNS TABLE de una función existente (mismo gotcha de 062/065/078).
-- ============================================================

drop function if exists public.get_appointments_due_for_reminder(integer);

create or replace function public.get_appointments_due_for_reminder(p_minutes_ahead integer default 60)
returns table (
  appointment_id uuid,
  reference      text,
  starts_at      timestamptz,
  client_name    text,
  client_phone   text,
  branch_id      uuid,
  branch_name    text,
  services       text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select a.id, a.reference, a.starts_at, c.full_name, c.phone, b.id, b.name,
         (select string_agg(aps.service_name, ', ' order by aps.service_name)
            from appointment_services aps
           where aps.appointment_id = a.id)
    from appointments a
    join appointment_clients c on c.id = a.client_id
    join branches b on b.id = a.branch_id
   where a.status = 'reservado'
     and a.reminder_sent_at is null
     and a.starts_at > now()
     and a.starts_at <= now() + make_interval(mins => p_minutes_ahead);
$function$;

-- Mismo caveat que 068: Supabase le aplica su propio grant a anon/
-- authenticated/service_role a toda función nueva del esquema public, sin
-- importar el `revoke ... from public` de 063 -- hay que revocar explícito
-- sobre ESTA función después de crearla.
grant execute on function public.get_appointments_due_for_reminder(integer) to service_role;
revoke execute on function public.get_appointments_due_for_reminder(integer) from anon, authenticated, public;

$m082$;
  exception when others then
    raise exception 'FALLO LA MIGRACION 082_turnero_recordatorio_con_sucursal.sql: % (SQLSTATE %)', sqlerrm, sqlstate;
  end;
  v_aplicadas := v_aplicadas || '082 ';

  begin
    execute $m083$
-- ============================================================
-- 083 — PORT de Flowi.estudio 100_calendario_por_sucursal_y_horario_masivo.sql
-- Porte a BarberiaGest/Valhalla del 2026-10-15. NO SE APLICA SIN REVISION DE BRUNO.
-- Ver PORTING.md (turnero). Cambios respecto del original: solo set_barber_week_schedule; chequeos NULL-safe
-- (is distinct from 'admin' / not coalesce(..., false)).
-- ============================================================

-- ============================================================
-- Carga masiva de horarios (solo la parte 3 de la 100 de Flowi.estudio)
-- ============================================================
-- La 100 original mezcla tres cosas. Aca se porta SOLO set_barber_week_schedule.
-- NO se porta: create_branch_admin (usa la tabla subscription, del modelo SaaS de Flowi), ni
-- el endurecimiento de create_year / delete_year_* (Valhalla tiene sus propios cuerpos: se
-- endurecen aparte), ni el backfill de calendario (Valhalla ya tiene meses y semanas).
-- Usa public._admin_can_manage_branch, que define la 065.
-- ============================================================

-- ── 3. Carga masiva de horarios ─────────────────────────────────────────
-- p_franjas: array de {start_time "HH:MM", end_time "HH:MM",
--            mode "turno"|"orden_llegada", slot_minutes int|null}
create or replace function public.set_barber_week_schedule(
  p_branch_id  uuid,
  p_barber_ids uuid[],
  p_weekdays   smallint[],
  p_franjas    jsonb,
  p_replace    boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_barber  uuid;
  v_day     smallint;
  v_f       jsonb;
  v_mode    schedule_mode;
  v_slot    int;
  v_start   time;
  v_end     time;
  v_created int := 0;
  v_deleted int := 0;
  v_n       int;
begin
  if not _admin_can_manage_branch(p_branch_id) then
    raise exception 'Sin permisos para configurar horarios de esta sucursal';
  end if;

  if coalesce(array_length(p_barber_ids, 1), 0) = 0 then
    raise exception 'Elegí al menos un barbero';
  end if;
  if coalesce(array_length(p_weekdays, 1), 0) = 0 then
    raise exception 'Elegí al menos un día';
  end if;
  if exists (select 1 from unnest(p_weekdays) d where d < 0 or d > 6) then
    raise exception 'Día de la semana inválido';
  end if;
  if jsonb_typeof(p_franjas) <> 'array' or (jsonb_array_length(p_franjas) = 0 and not p_replace) then
    raise exception 'Cargá al menos una franja';
  end if;

  -- Los barberos tienen que ser de esta sucursal: sin esto, un admin podría
  -- escribir horarios de un barbero de otra sucursal con el branch_id propio.
  if exists (
    select 1 from unnest(p_barber_ids) b
    where not exists (select 1 from profiles p where p.id = b and p.branch_id = p_branch_id)
  ) then
    raise exception 'Alguno de los barberos no pertenece a esta sucursal';
  end if;

  if p_replace then
    delete from barber_schedules
     where barber_id = any(p_barber_ids)
       and weekday = any(p_weekdays);
    get diagnostics v_deleted = row_count;
  end if;

  foreach v_barber in array p_barber_ids loop
    foreach v_day in array p_weekdays loop
      for v_f in select * from jsonb_array_elements(p_franjas) loop
        v_start := (v_f->>'start_time')::time;
        v_end   := (v_f->>'end_time')::time;
        v_mode  := (v_f->>'mode')::schedule_mode;
        v_slot  := case when v_mode = 'turno' then nullif(v_f->>'slot_minutes', '')::int else null end;

        if v_start is null or v_end is null or v_end <= v_start then
          raise exception 'Franja %–%: el fin tiene que ser posterior al inicio',
            coalesce(v_f->>'start_time', '?'), coalesce(v_f->>'end_time', '?');
        end if;
        if v_mode = 'turno' and (v_slot is null or v_slot <= 0) then
          raise exception 'Franja %–%: indicá cada cuántos minutos se reserva',
            v_f->>'start_time', v_f->>'end_time';
        end if;

        insert into barber_schedules (barber_id, branch_id, weekday, start_time, end_time, mode, slot_minutes)
        values (v_barber, p_branch_id, v_day, v_start, v_end, v_mode, v_slot);
        v_created := v_created + 1;
      end loop;
    end loop;
  end loop;

  return jsonb_build_object('created', v_created, 'deleted', v_deleted);
exception
  when exclusion_violation then
    raise exception 'Hay franjas que se superponen (entre sí o con las que ya tenía el barbero ese día). No se guardó nada.';
end;
$function$;

revoke execute on function public.set_barber_week_schedule(uuid, uuid[], smallint[], jsonb, boolean) from public, anon;
grant  execute on function public.set_barber_week_schedule(uuid, uuid[], smallint[], jsonb, boolean) to authenticated;

$m083$;
  exception when others then
    raise exception 'FALLO LA MIGRACION 083_turnero_carga_masiva_de_horarios.sql: % (SQLSTATE %)', sqlerrm, sqlstate;
  end;
  v_aplicadas := v_aplicadas || '083 ';

  begin
    execute $m084$
-- ============================================================
-- 084 — PORT de Flowi.estudio 107_avisos_de_turno_una_sola_vez.sql
-- Porte a BarberiaGest/Valhalla del 2026-10-15. NO SE APLICA SIN REVISION DE BRUNO.
-- Ver PORTING.md (turnero). Cambios respecto del original: chequeos NULL-safe
-- (is distinct from 'admin' / not coalesce(..., false)).
-- ============================================================

-- ============================================================
-- 107 — Cada aviso automático de un turno sale una sola vez
-- ============================================================
-- Las rutas públicas /api/reservar/confirmar-email, confirmar-whatsapp y
-- cancelar-whatsapp no piden sesión: alcanza con la referencia y el
-- teléfono de un turno, que cualquiera tiene si reservó uno. Sin freno, un
-- atacante reservaba una vez y después llamaba a la ruta del mail en loop,
-- y la instalación mandaba cientos de mails (o mensajes pagos de WhatsApp)
-- desde su propio dominio. Además el destinatario y el nombre de la
-- sucursal salían del body (auditoría 2026-09-29).
--
-- Ahora las rutas leen todo de la base y "reclaman" el envío con un
-- update ... where <columna> is null: el primero que llega lo manda, los
-- demás no. Las columnas solo las escribe el service role.
-- ============================================================

alter table public.appointments
  add column if not exists confirmation_email_sent_at    timestamptz,
  add column if not exists confirmation_whatsapp_sent_at timestamptz,
  add column if not exists cancellation_whatsapp_sent_at timestamptz;

$m084$;
  exception when others then
    raise exception 'FALLO LA MIGRACION 084_turnero_avisos_una_sola_vez.sql: % (SQLSTATE %)', sqlerrm, sqlstate;
  end;
  v_aplicadas := v_aplicadas || '084 ';

  begin
    execute $m085$
-- ============================================================
-- 085 — PORT de Flowi.estudio 109_limite_de_reservas_por_ip.sql
-- Porte a BarberiaGest/Valhalla del 2026-10-15. NO SE APLICA SIN REVISION DE BRUNO.
-- Ver PORTING.md (turnero). Cambios respecto del original: chequeos NULL-safe
-- (is distinct from 'admin' / not coalesce(..., false)).
-- ============================================================

-- ============================================================
-- 109 — Tope de reservas públicas por IP y por día
-- ============================================================
-- El freno que había (3 turnos activos por teléfono) no sirve contra
-- alguien que va cambiando el número: podía llenar la agenda de turnos
-- falsos (auditoría 2026-09-29). Ahora, además, una misma conexión puede
-- sacar como mucho 20 reservas por día (hora de Argentina). Decisión de
-- Bruno: 20 queda muy por encima de un cliente o una familia — y de varios
-- clientes que comparten IP (datos móviles, el Wi-Fi del local) — y
-- chico para alguien que quiera sabotear.
--
-- Cómo:
--   · La reserva pública deja de ir directo del navegador a Supabase: pasa
--     por /api/reservar/crear, que lee la IP real (la pone Vercel, no se
--     puede falsificar desde afuera) y llama a create_appointment_public_rl
--     con el service role. A anon/authenticated se les saca el execute de
--     create_appointment_public: sin eso, el tope se salteaba llamando
--     directo a la RPC.
--   · Se guarda un hash de la IP (sha256 con sal del servidor), nunca la IP.
--   · create_appointment_public_rl bloquea la fila del contador, chequea el
--     tope, crea el turno y recién ahí suma 1, todo en la misma
--     transacción: una reserva que falla (horario tomado, datos inválidos)
--     no gasta cupo, y dos pedidos simultáneos no se pasan del tope.
--   · Las reservas que carga el admin o el barbero desde el panel usan
--     otras RPC y no tienen tope.
-- ============================================================

create table if not exists public.booking_rate_limits (
  ip_hash  text    not null,
  day      date    not null,
  bookings integer not null default 0,
  primary key (ip_hash, day)
);

-- Solo la toca el service role (vía la función de abajo).
alter table public.booking_rate_limits enable row level security;
revoke all on public.booking_rate_limits from anon, authenticated;

create or replace function public.create_appointment_public_rl(
  p_ip_hash     text,
  p_branch_id   uuid,
  p_barber_id   uuid,
  p_client_name text,
  p_client_phone text,
  p_starts_at   timestamptz,
  p_service_ids uuid[],
  p_client_email text default null
)
returns table(reference text, starts_at timestamptz, ends_at timestamptz)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  c_tope constant integer := 20;
  v_day  date := (now() at time zone flowi_tz())::date;
  v_n    integer;
begin
  if coalesce(p_ip_hash, '') = '' then
    raise exception 'No pudimos identificar tu conexión. Probá de nuevo.';
  end if;

  -- Limpieza al pasar: el contador solo sirve para el día en curso.
  delete from booking_rate_limits where day < v_day - 1;

  insert into booking_rate_limits (ip_hash, day) values (p_ip_hash, v_day)
  on conflict do nothing;

  select bookings into v_n
  from booking_rate_limits
  where ip_hash = p_ip_hash and day = v_day
  for update;

  if v_n >= c_tope then
    raise exception 'Se hicieron muchas reservas hoy desde esta conexión. Si necesitás otro turno, escribinos por WhatsApp.';
  end if;

  return query
    select r.reference, r.starts_at, r.ends_at
    from create_appointment_public(
      p_branch_id, p_barber_id, p_client_name, p_client_phone,
      p_starts_at, p_service_ids, p_client_email
    ) r;

  update booking_rate_limits
  set bookings = bookings + 1
  where ip_hash = p_ip_hash and day = v_day;
end;
$$;

revoke execute on function public.create_appointment_public_rl(text, uuid, uuid, text, text, timestamptz, uuid[], text)
  from public, anon, authenticated;
grant execute on function public.create_appointment_public_rl(text, uuid, uuid, text, text, timestamptz, uuid[], text)
  to service_role;

revoke execute on function public.create_appointment_public(uuid, uuid, text, text, timestamptz, uuid[], text)
  from public, anon, authenticated;
grant execute on function public.create_appointment_public(uuid, uuid, text, text, timestamptz, uuid[], text)
  to service_role;

$m085$;
  exception when others then
    raise exception 'FALLO LA MIGRACION 085_turnero_tope_de_reservas_por_ip.sql: % (SQLSTATE %)', sqlerrm, sqlstate;
  end;
  v_aplicadas := v_aplicadas || '085 ';

  begin
    execute $m086$
-- ============================================================
-- 086 — PORT de Flowi.estudio 110_whatsapp_mensajes_y_estados.sql
-- Porte a BarberiaGest/Valhalla del 2026-10-15. NO SE APLICA SIN REVISION DE BRUNO.
-- Ver PORTING.md (turnero). Cambios respecto del original: chequeos NULL-safe
-- (is distinct from 'admin' / not coalesce(..., false)).
-- ============================================================

-- ============================================================
-- 110 — Registro de mensajes de WhatsApp y de su estado de entrega
-- ============================================================
-- Hasta acá la app mandaba la plantilla a Meta, recibía `sent: true` y no
-- volvía a saber nada: Meta ACEPTA el pedido de forma síncrona pero entrega
-- (o no) más tarde, y los motivos de rechazo reales -- método de pago
-- faltante (131042), número sin WhatsApp (131026), plantilla pausada, etc. --
-- llegan solo por el webhook de estados. Sin esto, un mensaje que nunca
-- llega es invisible para la barbería.
--
-- Cómo:
--   · Al enviar, el servidor registra el `wamid` (id del mensaje que
--     devuelve Meta) junto con el turno y el tipo de aviso.
--   · /api/whatsapp/webhook recibe los estados (sent / delivered / read /
--     failed) y los vuelca acá. Los estados pueden llegar desordenados o
--     ANTES de que el servidor termine de registrar el envío, por eso las
--     dos funciones hacen upsert y el estado solo avanza, nunca retrocede.
--   · Solo escribe el service role. El admin lee los de su sucursal.
-- ============================================================

create table if not exists public.whatsapp_messages (
  wamid          text        primary key,
  -- Nulos hasta que el servidor registra el envío (si el estado llegó antes).
  branch_id      uuid        references public.branches(id) on delete cascade,
  appointment_id uuid        references public.appointments(id) on delete set null,
  kind           text        check (kind in ('confirmacion', 'recordatorio', 'cancelacion', 'difusion')),
  recipient      text,
  status         text        not null default 'accepted'
                             check (status in ('accepted', 'sent', 'delivered', 'read', 'failed')),
  error_code     integer,
  error_title    text,
  error_detail   text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_whatsapp_messages_branch_created
  on public.whatsapp_messages (branch_id, created_at desc);
create index if not exists idx_whatsapp_messages_appointment
  on public.whatsapp_messages (appointment_id);

alter table public.whatsapp_messages enable row level security;

-- Lectura solo para el admin de la sucursal (el teléfono del cliente está
-- acá). Ninguna política de escritura: escribe el service role.
drop policy if exists whatsapp_messages_admin_read on public.whatsapp_messages;
create policy whatsapp_messages_admin_read on public.whatsapp_messages
  for select to authenticated
  using (branch_id is not null and public._admin_can_manage_branch(branch_id));

revoke all on public.whatsapp_messages from anon, authenticated;
grant select on public.whatsapp_messages to authenticated;

-- ------------------------------------------------------------
-- Orden de los estados. `failed` le gana a accepted/sent pero no a
-- delivered/read: si Meta ya entregó, un "failed" tardío no corresponde.
-- ------------------------------------------------------------
create or replace function public._wa_status_rank(p_status text)
returns integer
language sql
immutable
set search_path to 'public'
as $$
  select case p_status
    when 'accepted'  then 0
    when 'sent'      then 1
    when 'failed'    then 2
    when 'delivered' then 3
    when 'read'      then 4
    else -1
  end;
$$;

-- ------------------------------------------------------------
-- Alta del envío (la llama el servidor justo después de mandar).
-- No toca status/error_*: si el webhook llegó primero, se conserva.
-- ------------------------------------------------------------
create or replace function public.register_whatsapp_message(
  p_wamid          text,
  p_branch_id      uuid,
  p_appointment_id uuid,
  p_kind           text,
  p_recipient      text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if coalesce(p_wamid, '') = '' then
    return;
  end if;

  insert into whatsapp_messages (wamid, branch_id, appointment_id, kind, recipient)
  values (p_wamid, p_branch_id, p_appointment_id, p_kind, p_recipient)
  on conflict (wamid) do update
    set branch_id      = excluded.branch_id,
        appointment_id = excluded.appointment_id,
        kind           = excluded.kind,
        recipient      = coalesce(excluded.recipient, whatsapp_messages.recipient);
end;
$$;

-- ------------------------------------------------------------
-- Estado que informa el webhook. Upsert monótono: el estado solo avanza.
-- ------------------------------------------------------------
create or replace function public.record_whatsapp_status(
  p_wamid        text,
  p_status       text,
  p_recipient    text,
  p_error_code   integer,
  p_error_title  text,
  p_error_detail text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if coalesce(p_wamid, '') = '' or public._wa_status_rank(p_status) < 0 then
    return;
  end if;

  insert into whatsapp_messages (wamid, status, recipient, error_code, error_title, error_detail)
  values (
    p_wamid, p_status, p_recipient,
    case when p_status = 'failed' then p_error_code end,
    case when p_status = 'failed' then left(p_error_title, 200) end,
    case when p_status = 'failed' then left(p_error_detail, 500) end
  )
  on conflict (wamid) do update
    set status = case
          when public._wa_status_rank(excluded.status) > public._wa_status_rank(whatsapp_messages.status)
            then excluded.status
          else whatsapp_messages.status
        end,
        error_code = case
          when excluded.status = 'failed'
           and public._wa_status_rank(whatsapp_messages.status) < 3
            then excluded.error_code
          else whatsapp_messages.error_code
        end,
        error_title = case
          when excluded.status = 'failed'
           and public._wa_status_rank(whatsapp_messages.status) < 3
            then excluded.error_title
          else whatsapp_messages.error_title
        end,
        error_detail = case
          when excluded.status = 'failed'
           and public._wa_status_rank(whatsapp_messages.status) < 3
            then excluded.error_detail
          else whatsapp_messages.error_detail
        end,
        recipient  = coalesce(whatsapp_messages.recipient, excluded.recipient),
        updated_at = now();
end;
$$;

-- Explícito función por función: el `alter default privileges` de la 063 no
-- protege las funciones nuevas en Supabase (ver ESTADO_SESION 5.22).
revoke execute on function public._wa_status_rank(text) from public, anon, authenticated;
grant  execute on function public._wa_status_rank(text) to service_role;

revoke execute on function public.register_whatsapp_message(text, uuid, uuid, text, text)
  from public, anon, authenticated;
grant  execute on function public.register_whatsapp_message(text, uuid, uuid, text, text)
  to service_role;

revoke execute on function public.record_whatsapp_status(text, text, text, integer, text, text)
  from public, anon, authenticated;
grant  execute on function public.record_whatsapp_status(text, text, text, integer, text, text)
  to service_role;

$m086$;
  exception when others then
    raise exception 'FALLO LA MIGRACION 086_turnero_mensajes_de_whatsapp.sql: % (SQLSTATE %)', sqlerrm, sqlstate;
  end;
  v_aplicadas := v_aplicadas || '086 ';

  begin
    execute $m087$
-- ============================================================
-- 087 — PORT de Flowi.estudio 111_base_de_clientes.sql
-- Porte a BarberiaGest/Valhalla del 2026-10-15. NO SE APLICA SIN REVISION DE BRUNO.
-- Ver PORTING.md (turnero). Cambios respecto del original: chequeos NULL-safe
-- (is distinct from 'admin' / not coalesce(..., false)).
-- ============================================================

-- ============================================================
-- 111 — Base de clientes del turnero (lista para el admin)
-- ============================================================
-- Cada persona que reserva queda guardada en `appointment_clients` desde la
-- Fase 1, pero nada la mostraba. Esta función arma la lista con lo que la
-- barbería necesita para decidir a quién escribirle: cuántas veces vino,
-- cuándo fue la última, si tiene un turno por delante y cuántas veces faltó.
--
-- Es `security invoker`: las políticas RLS de appointment_clients y
-- appointments siguen aplicando, y además se chequea a mano que quien llama
-- sea ADMIN de la sucursal (esas políticas dejan leer también al barbero, y
-- la lista completa de teléfonos no es para él).
--
-- RETURNS TABLE crea variables implícitas con el nombre de cada columna
-- (full_name, phone, ...): todas las referencias van calificadas con alias
-- para que no queden ambiguas (mismo gotcha de create_appointment_admin).
-- ============================================================

create or replace function public.list_appointment_clients(p_branch_id uuid)
returns table (
  client_id     uuid,
  full_name     text,
  phone         text,
  email         text,
  created_at    timestamptz,
  total_turnos  integer,
  atendidos     integer,
  no_vino       integer,
  cancelados    integer,
  ultimo_turno  timestamptz,
  proximo_turno timestamptz
)
language plpgsql
stable
security invoker
set search_path to 'public'
as $$
begin
  if not public._admin_can_manage_branch(p_branch_id) then
    raise exception 'Sin permiso sobre esta sucursal';
  end if;

  return query
    select
      c.id,
      c.full_name,
      c.phone,
      c.email,
      c.created_at,
      count(a.id)::integer,
      (count(a.id) filter (where a.status = 'atendido'))::integer,
      (count(a.id) filter (where a.status = 'no_vino'))::integer,
      (count(a.id) filter (where a.status = 'cancelado'))::integer,
      -- Última vez que vino de verdad (atendido o llegó), no la última reserva.
      max(a.starts_at) filter (where a.status in ('atendido', 'llego')),
      min(a.starts_at) filter (where a.status = 'reservado' and a.starts_at > now())
    from appointment_clients c
    left join appointments a on a.client_id = c.id
    where c.branch_id = p_branch_id
    group by c.id, c.full_name, c.phone, c.email, c.created_at
    order by 10 desc nulls last, 2;
end;
$$;

revoke execute on function public.list_appointment_clients(uuid) from public, anon;
grant  execute on function public.list_appointment_clients(uuid) to authenticated;

$m087$;
  exception when others then
    raise exception 'FALLO LA MIGRACION 087_turnero_base_de_clientes.sql: % (SQLSTATE %)', sqlerrm, sqlstate;
  end;
  v_aplicadas := v_aplicadas || '087 ';

  begin
    execute $m088$
-- ============================================================
-- 088 — PORT de Flowi.estudio 112_whatsapp_numero_por_sucursal.sql
-- Porte a BarberiaGest/Valhalla del 2026-10-15. NO SE APLICA SIN REVISION DE BRUNO.
-- Ver PORTING.md (turnero). Cambios respecto del original: chequeos NULL-safe
-- (is distinct from 'admin' / not coalesce(..., false)).
-- ============================================================

-- ============================================================
-- 112 — Número de WhatsApp (API de Meta) por sucursal
-- ============================================================
-- Hasta acá toda la instalación mandaba los avisos desde UN solo número
-- (WHATSAPP_PHONE_NUMBER_ID, variable de entorno). Una cadena con un número
-- por sucursal (caso Valhalla: 4 sucursales, 4 números) no se podía servir.
--
-- Ahora cada sucursal puede tener el suyo. Ojo con la diferencia:
--   · branches.whatsapp_phone        -> el número que ve el CLIENTE en la
--                                       reserva (botón wa.me). Ya existía.
--   · branches.whatsapp_phone_number_id -> el "Phone Number ID" de Meta,
--                                       desde el que SALEN los avisos
--                                       automáticos. Es un id interno de la
--                                       Cloud API, no el teléfono.
-- El token de acceso NO va acá: sigue siendo uno por instalación, en
-- WHATSAPP_ACCESS_TOKEN (un usuario del sistema de Meta puede tener varios
-- números asignados). El Phone Number ID no es un secreto: sin el token no
-- permite mandar nada.
--
-- Si una sucursal no tiene el suyo cargado, el servidor cae a la variable
-- de entorno WHATSAPP_PHONE_NUMBER_ID (instalaciones con un solo número).
-- En una instalación multi-número conviene NO definir esa variable, así una
-- sucursal sin configurar no manda desde el número de otra.
-- ============================================================

alter table public.branches
  add column if not exists whatsapp_phone_number_id text;

alter table public.branches
  drop constraint if exists branches_whatsapp_phone_number_id_formato;
alter table public.branches
  add constraint branches_whatsapp_phone_number_id_formato
  check (whatsapp_phone_number_id is null or whatsapp_phone_number_id ~ '^[0-9]{5,25}$');

-- Dos sucursales SÍ pueden compartir número (un cliente que atiende varias
-- sucursales con una sola línea): los estados de entrega se cruzan por el
-- id del mensaje (wamid), no por el número, así que no se confunden.

comment on column public.branches.whatsapp_phone_number_id is
  'Phone Number ID de la Cloud API de Meta desde el que salen los avisos automaticos de esta sucursal. Si es null se usa WHATSAPP_PHONE_NUMBER_ID del entorno.';

-- ------------------------------------------------------------
-- Escritura: función propia (no se toca update_branch_branding, que ya
-- tiene 13 parámetros y tres sobrecargas históricas).
-- ------------------------------------------------------------
create or replace function public.set_branch_whatsapp_sender(
  p_branch_id        uuid,
  p_phone_number_id  text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id text;
begin
  if not public._admin_can_manage_branch(p_branch_id) then
    raise exception 'Sin permisos para configurar esta sucursal';
  end if;

  v_id := nullif(btrim(coalesce(p_phone_number_id, '')), '');
  if v_id is not null and v_id !~ '^[0-9]{5,25}$' then
    raise exception 'El Phone Number ID tiene que ser solo números (5 a 25 dígitos)';
  end if;

  update branches set whatsapp_phone_number_id = v_id where id = p_branch_id;
end;
$function$;

revoke all on function public.set_branch_whatsapp_sender(uuid, text) from public, anon;
grant execute on function public.set_branch_whatsapp_sender(uuid, text) to authenticated;

$m088$;
  exception when others then
    raise exception 'FALLO LA MIGRACION 088_turnero_numero_de_whatsapp_por_sucursal.sql: % (SQLSTATE %)', sqlerrm, sqlstate;
  end;
  v_aplicadas := v_aplicadas || '088 ';

  begin
    execute $m089$
-- ============================================================
-- 089 — PORT de Flowi.estudio 113_reserva_sin_preferencia_de_barbero.sql
-- Porte a BarberiaGest/Valhalla del 2026-10-15. NO SE APLICA SIN REVISION DE BRUNO.
-- Ver PORTING.md (turnero). Cambios respecto del original: chequeos NULL-safe
-- (is distinct from 'admin' / not coalesce(..., false)).
-- ============================================================

-- ============================================================
-- 113 — Reserva "sin preferencia de barbero" + servicio más elegido
-- ============================================================
-- El cliente nuevo no conoce a los barberos. En vez de obligarlo a elegir,
-- puede dejar que el sistema asigne uno. Decisiones de Bruno (2026-10-15):
--
--   · El cliente elige servicio, día y horario viendo TODOS los horarios
--     libres de la sucursal (la unión de los de cada barbero), no los de un
--     barbero sorteado de antemano: sortear primero le escondería horarios
--     que otros barberos sí tienen libres.
--   · Al confirmar, la base asigna entre los barberos libres en ese horario:
--       1. el que menos cortes tiene en la semana del turno,
--       2. si empatan (ej. arranca la semana y todos están en cero), el que
--          menos tuvo la semana anterior,
--       3. si siguen empatados, al azar.
--   · "Cortes" = lo cargado en caja (transactions) + los turnos de la app de
--     esa semana que todavía no pasaron a caja. Un turno ya vinculado a una
--     transacción (appointments.transaction_id) se cuenta UNA sola vez, por
--     la transacción: sin esto se duplicaba.
--   · Semana = lunes a domingo, en la hora de Argentina.
--   · Servicio "más elegido": el más pedido de la sucursal en los últimos 30
--     días (turnos + caja), con un mínimo de 3 para no etiquetar por azar.
--
-- La asignación la hace la base y no la pantalla: un cálculo hecho en el
-- navegador se manipula (mismo criterio que get_available_slots).
--
-- Lo que NO cambia: el turno se guarda con un barbero real (barber_id), así
-- que agenda, recordatorios, cancelación y avisos funcionan igual que antes.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Carga de un barbero en un rango [desde, hasta)
-- ------------------------------------------------------------
create or replace function public._barber_load(
  p_branch_id uuid,
  p_barber_id uuid,
  p_from      date,
  p_to        date
)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $function$
  select (
    select count(*) from transactions t
     where t.branch_id = p_branch_id
       and t.barber_id = p_barber_id
       and t.transaction_date >= p_from
       and t.transaction_date <  p_to
  )::integer + (
    select count(*) from appointments a
     where a.branch_id = p_branch_id
       and a.barber_id = p_barber_id
       and a.transaction_id is null
       and a.status in ('reservado', 'llego', 'atendido')
       and (a.starts_at at time zone flowi_tz())::date >= p_from
       and (a.starts_at at time zone flowi_tz())::date <  p_to
  )::integer;
$function$;

-- ------------------------------------------------------------
-- 2. Barberos libres en un horario, en orden de prioridad
-- ------------------------------------------------------------
-- Volátil a propósito (usa random() para el último desempate).
create or replace function public._barbers_free_for_slot(
  p_branch_id   uuid,
  p_starts_at   timestamptz,
  p_service_ids uuid[]
)
returns table (barber_id uuid)
language sql
security definer
set search_path to 'public'
as $function$
  with ctx as (
    select (p_starts_at at time zone flowi_tz())::date as d
  ), wk as (
    select date_trunc('week', ctx.d::timestamp)::date as w0 from ctx
  )
  select b.id
    from get_public_barbers(p_branch_id) b
   cross join ctx
   cross join wk
   where exists (
           select 1
             from get_available_slots(p_branch_id, b.id, ctx.d, p_service_ids) s
            where s.slot_at = p_starts_at
         )
   order by _barber_load(p_branch_id, b.id, wk.w0,     wk.w0 + 7),
            _barber_load(p_branch_id, b.id, wk.w0 - 7, wk.w0),
            random();
$function$;

-- ------------------------------------------------------------
-- 3. Horarios libres de cualquier barbero (lo que ve el cliente)
-- ------------------------------------------------------------
create or replace function public.get_available_slots_any(
  p_branch_id   uuid,
  p_date        date,
  p_service_ids uuid[]
)
returns table (slot_at timestamptz, period text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select distinct s.slot_at, s.period
    from get_public_barbers(p_branch_id) b
   cross join lateral get_available_slots(p_branch_id, b.id, p_date, p_service_ids) s
   order by s.slot_at;
$function$;

-- ------------------------------------------------------------
-- 4. Servicio más elegido de la sucursal
-- ------------------------------------------------------------
-- Devuelve null si ninguno llega a 3 pedidos en 30 días (sin historial no
-- se muestra la etiqueta).
create or replace function public.get_popular_service(p_branch_id uuid)
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select u.service_id
    from (
      select aps.service_id, count(*) as n
        from appointment_services aps
        join appointments a on a.id = aps.appointment_id
       where a.branch_id = p_branch_id
         and a.transaction_id is null
         and a.status in ('reservado', 'llego', 'atendido')
         and a.starts_at >= now() - interval '30 days'
         and aps.service_id is not null
       group by aps.service_id
      union all
      select t.service_id, count(*)
        from transactions t
       where t.branch_id = p_branch_id
         and t.transaction_date >= (now() at time zone flowi_tz())::date - 30
         and t.service_id is not null
       group by t.service_id
    ) u
    join service_catalog sc on sc.id = u.service_id
   where sc.branch_id = p_branch_id
     and sc.is_active
     and sc.is_bookable
     and sc.duration_min is not null
   group by u.service_id, sc.name
  having sum(u.n) >= 3
   order by sum(u.n) desc, sc.name
   limit 1;
$function$;

-- ------------------------------------------------------------
-- 5. Reserva pública con tope por IP: ahora acepta barbero null
-- ------------------------------------------------------------
-- Misma firma y mismo comportamiento que en 109 cuando viene un barbero. Con
-- p_barber_id null prueba los barberos libres en orden de prioridad hasta que
-- uno la acepta: si dos clientes toman el mismo horario a la vez, el segundo
-- pasa al siguiente barbero libre en vez de fallar. Solo se reintenta ante los
-- mensajes de "horario no disponible"; cualquier otro error (nombre vacío,
-- tope de 3 turnos por teléfono, etc.) se propaga tal cual.
create or replace function public.create_appointment_public_rl(
  p_ip_hash      text,
  p_branch_id    uuid,
  p_barber_id    uuid,
  p_client_name  text,
  p_client_phone text,
  p_starts_at    timestamptz,
  p_service_ids  uuid[],
  p_client_email text default null
)
returns table(reference text, starts_at timestamptz, ends_at timestamptz)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  c_tope constant integer := 20;
  v_day  date := (now() at time zone flowi_tz())::date;
  v_n    integer;
  v_cand uuid;
  v_ref  text;
  v_ini  timestamptz;
  v_fin  timestamptz;
  v_ok   boolean := false;
begin
  if coalesce(p_ip_hash, '') = '' then
    raise exception 'No pudimos identificar tu conexión. Probá de nuevo.';
  end if;

  -- Limpieza al pasar: el contador solo sirve para el día en curso.
  delete from booking_rate_limits where day < v_day - 1;

  insert into booking_rate_limits (ip_hash, day) values (p_ip_hash, v_day)
  on conflict do nothing;

  select bookings into v_n
  from booking_rate_limits
  where ip_hash = p_ip_hash and day = v_day
  for update;

  if v_n >= c_tope then
    raise exception 'Se hicieron muchas reservas hoy desde esta conexión. Si necesitás otro turno, escribinos por WhatsApp.';
  end if;

  if p_barber_id is not null then
    select r.reference, r.starts_at, r.ends_at into v_ref, v_ini, v_fin
    from create_appointment_public(
      p_branch_id, p_barber_id, p_client_name, p_client_phone,
      p_starts_at, p_service_ids, p_client_email
    ) r;
  else
    for v_cand in
      select f.barber_id from _barbers_free_for_slot(p_branch_id, p_starts_at, p_service_ids) f
    loop
      begin
        select r.reference, r.starts_at, r.ends_at into v_ref, v_ini, v_fin
        from create_appointment_public(
          p_branch_id, v_cand, p_client_name, p_client_phone,
          p_starts_at, p_service_ids, p_client_email
        ) r;
        v_ok := true;
        exit;
      exception when others then
        if sqlerrm not like 'Ese horario%' then
          raise;
        end if;
      end;
    end loop;

    if not v_ok then
      raise exception 'Ese horario ya no está disponible. Elegí otro.';
    end if;
  end if;

  update booking_rate_limits
  set bookings = bookings + 1
  where ip_hash = p_ip_hash and day = v_day;

  return query select v_ref, v_ini, v_fin;
end;
$$;

-- ------------------------------------------------------------
-- PERMISOS
-- ------------------------------------------------------------
-- Las dos de ayuda son internas: solo las llaman otras funciones security
-- definer (que corren con el dueño), así que ningún rol necesita ejecutarlas.
-- Revoke explícito: Supabase le da su propio grant a anon/authenticated a
-- toda función nueva (ver el caveat de 068 y 109).
revoke execute on function public._barber_load(uuid, uuid, date, date)
  from public, anon, authenticated;
revoke execute on function public._barbers_free_for_slot(uuid, timestamptz, uuid[])
  from public, anon, authenticated;
grant execute on function public._barber_load(uuid, uuid, date, date) to service_role;
grant execute on function public._barbers_free_for_slot(uuid, timestamptz, uuid[]) to service_role;

-- Las dos nuevas de lectura pública, igual que get_available_slots.
revoke execute on function public.get_available_slots_any(uuid, date, uuid[]) from public;
revoke execute on function public.get_popular_service(uuid) from public;
grant execute on function public.get_available_slots_any(uuid, date, uuid[]) to anon, authenticated, service_role;
grant execute on function public.get_popular_service(uuid) to anon, authenticated, service_role;

-- create or replace conserva los permisos de 109; se repite por claridad.
revoke execute on function public.create_appointment_public_rl(text, uuid, uuid, text, text, timestamptz, uuid[], text)
  from public, anon, authenticated;
grant execute on function public.create_appointment_public_rl(text, uuid, uuid, text, text, timestamptz, uuid[], text)
  to service_role;

$m089$;
  exception when others then
    raise exception 'FALLO LA MIGRACION 089_turnero_reserva_sin_preferencia.sql: % (SQLSTATE %)', sqlerrm, sqlstate;
  end;
  v_aplicadas := v_aplicadas || '089 ';

  begin
    execute $m090$
-- ============================================================
-- 090 — PORT de Flowi.estudio 114_detalle_del_turno_con_cancelacion.sql
-- Porte a BarberiaGest/Valhalla del 2026-10-15. NO SE APLICA SIN REVISION DE BRUNO.
-- Ver PORTING.md (turnero). Cambios respecto del original: chequeos NULL-safe
-- (is distinct from 'admin' / not coalesce(..., false)).
-- ============================================================

-- ============================================================
-- 114 — Detalle completo del turno en "Gestionar mi turno"
-- ============================================================
-- La pantalla pública de gestión (código + teléfono) mostraba muy poco de un
-- turno ya cancelado: sin etiqueta de estado, sin dirección, sin código y sin
-- saber cuándo se canceló. Referencia: la ficha de una reserva cancelada de
-- WeiBook (decisión de Bruno, 2026-10-15).
--
-- Qué hace:
--   1. appointments.cancelled_at: cuándo pasó a "cancelado". Lo llena un
--      trigger, así vale para TODOS los caminos (el cliente desde el link, el
--      admin, el barbero, set_appointment_status). Los turnos ya cancelados
--      antes de esta migración quedan en null: no se inventa una fecha.
--   2. get_appointment_by_reference devuelve además la sucursal (nombre,
--      dirección y coordenadas, para "Cómo llegar"), la fecha de creación, la
--      de cancelación y la duración de cada servicio.
--
-- Sigue exigiendo código + teléfono juntos y sin distinguir "no existe" de
-- "teléfono distinto". No suma ningún dato del cliente: la dirección y el
-- nombre de la sucursal ya son públicos (list_public_branches).
-- ============================================================

alter table public.appointments
  add column if not exists cancelled_at timestamptz;

-- ------------------------------------------------------------
-- Trigger: cancelled_at sigue al estado
-- ------------------------------------------------------------
create or replace function public.set_appointment_cancelled_at()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.status = 'cancelado' and old.status is distinct from 'cancelado' then
    new.cancelled_at := now();
  elsif new.status <> 'cancelado' and old.status = 'cancelado' then
    -- Si alguien reabre un turno cancelado, la fecha de cancelación deja de valer.
    new.cancelled_at := null;
  end if;
  return new;
end;
$function$;

-- Función de trigger: nadie la llama a mano. Supabase le da su propio grant a
-- anon/authenticated a toda función nueva (ver el caveat de 068 y 109).
revoke execute on function public.set_appointment_cancelled_at()
  from public, anon, authenticated;

drop trigger if exists appointments_cancelled_at on public.appointments;
create trigger appointments_cancelled_at
  before update of status on public.appointments
  for each row execute function public.set_appointment_cancelled_at();

-- ------------------------------------------------------------
-- Consulta pública del turno, con más datos
-- ------------------------------------------------------------
-- El drop es obligatorio: create or replace no puede cambiar el RETURNS TABLE
-- de una función existente (mismo gotcha de 062/065/078).
drop function if exists public.get_appointment_by_reference(text, text);

create or replace function public.get_appointment_by_reference(
  p_reference text,
  p_phone     text
)
returns table (
  reference         text,
  starts_at         timestamptz,
  ends_at           timestamptz,
  status            appointment_status,
  barber_name       text,
  client_name       text,
  total_price       numeric,
  services          jsonb,
  branch_name       text,
  branch_address    text,
  branch_latitude   numeric,
  branch_longitude  numeric,
  created_at        timestamptz,
  cancelled_at      timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select a.reference, a.starts_at, a.ends_at, a.status,
         p.full_name, c.full_name,
         coalesce(sum(s.price), 0),
         coalesce(jsonb_agg(jsonb_build_object('name', s.service_name,
                                               'price', s.price,
                                               'duration_min', s.duration_min)
                            order by s.created_at) filter (where s.id is not null), '[]'::jsonb),
         b.name, b.address, b.latitude, b.longitude,
         a.created_at, a.cancelled_at
    from appointments a
    join profiles p            on p.id = a.barber_id
    join appointment_clients c on c.id = a.client_id
    join branches b            on b.id = a.branch_id
    left join appointment_services s on s.appointment_id = a.id
   where upper(btrim(p_reference)) = a.reference
     and c.phone = btrim(p_phone)
   group by a.reference, a.starts_at, a.ends_at, a.status, p.full_name, c.full_name,
            b.name, b.address, b.latitude, b.longitude, a.created_at, a.cancelled_at;
$function$;

revoke execute on function public.get_appointment_by_reference(text, text) from public;
grant execute on function public.get_appointment_by_reference(text, text) to anon, authenticated, service_role;

$m090$;
  exception when others then
    raise exception 'FALLO LA MIGRACION 090_turnero_detalle_del_turno.sql: % (SQLSTATE %)', sqlerrm, sqlstate;
  end;
  v_aplicadas := v_aplicadas || '090 ';

  begin
    execute $m091$
-- ============================================================
-- 091 — Turnero: permisos y blindaje final
-- ============================================================
-- Cierra lo que las migraciones 066-090 dejan abierto por el default de Supabase: toda funcion
-- nueva del esquema public nace con EXECUTE para anon y authenticated (comprobado en Flowi,
-- 069). Los intentos de arreglarlo con "alter default privileges" no funcionaron alli.
-- Por eso se revoca de forma EXPLICITA funcion por funcion, y se otorga a anon SOLO la
-- superficie publica de la reserva.
--
-- Esto NO es la 063 de Flowi (que hacia "revoke ... on all functions in schema public" y
-- reabria a authenticated todo el esquema): aca solo se tocan las funciones del turnero.
-- El resto de las funciones de Valhalla las trata la 065.
---- Superficie publica (anon): flowi_tz, get_public_branch, list_public_branches, get_bookable_services, get_public_barbers, get_walkin_windows, get_available_slots, get_appointment_by_reference, cancel_appointment_public, get_booking_header, get_available_slots_any, get_popular_service.
-- create_appointment_public NO es publica: desde la 085 solo la ejecuta service_role (la
-- reserva pasa por /api/reservar/crear, que aplica el tope por IP).
-- ============================================================

do $$
declare
  r record;
  v_publicas constant text[] := array['flowi_tz', 'get_public_branch', 'list_public_branches', 'get_bookable_services', 'get_public_barbers', 'get_walkin_windows', 'get_available_slots', 'get_appointment_by_reference', 'cancel_appointment_public', 'get_booking_header', 'get_available_slots_any', 'get_popular_service'];
  v_todas    constant text[] := array['_barber_load', '_barbers_free_for_slot', '_wa_status_rank', 'cancel_appointment', 'cancel_appointment_public', 'create_appointment_admin', 'create_appointment_barber', 'create_appointment_public', 'create_appointment_public_rl', 'create_barber_schedule', 'create_schedule_exception', 'create_schedule_exception_barber', 'delete_barber_schedule', 'delete_schedule_exception', 'flowi_tz', 'get_admin_agenda', 'get_appointment_by_reference', 'get_appointments_due_for_reminder', 'get_available_slots', 'get_available_slots_any', 'get_barber_agenda', 'get_bookable_services', 'get_booking_header', 'get_popular_service', 'get_public_barbers', 'get_public_branch', 'get_walkin_windows', 'link_appointment_transaction', 'list_appointment_clients', 'list_public_branches', 'move_appointment', 'record_whatsapp_status', 'register_whatsapp_message', 'set_appointment_cancelled_at', 'set_appointment_status', 'set_barber_week_schedule', 'set_branch_whatsapp_sender', 'update_branch_branding'];
begin
  -- 1. Todo lo del turnero que no es publico: fuera anon y PUBLIC.
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = any (v_todas)
       and p.proname <> all (v_publicas)
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
  end loop;

  -- 2. La superficie publica, nombrada: anon, authenticated y service_role.
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = any (v_publicas)
  loop
    execute format('revoke execute on function %s from public', r.sig);
    execute format('grant execute on function %s to anon, authenticated, service_role', r.sig);
  end loop;
end $$;

-- 3. Tablas del turnero: anon no toca nada; authenticated solo lee (RLS acota por sucursal).
--    Toda escritura pasa por funciones SECURITY DEFINER.
revoke all on public.barber_schedules, public.schedule_exceptions, public.appointment_clients,
              public.appointments, public.appointment_services from anon;
revoke insert, update, delete, truncate, references, trigger on
              public.barber_schedules, public.schedule_exceptions, public.appointment_clients,
              public.appointments, public.appointment_services from authenticated;

-- 4. create_appointment_public: solo service_role (la 085 ya lo hizo; se reafirma).
revoke execute on function public.create_appointment_public(uuid, uuid, text, text, timestamptz, uuid[], text)
  from public, anon, authenticated;
grant execute on function public.create_appointment_public(uuid, uuid, text, text, timestamptz, uuid[], text)
  to service_role;
$m091$;
  exception when others then
    raise exception 'FALLO LA MIGRACION 091_turnero_permisos_y_blindaje.sql: % (SQLSTATE %)', sqlerrm, sqlstate;
  end;
  v_aplicadas := v_aplicadas || '091 ';

  begin
    execute $m092$
-- 092 - Aplicada a Valhalla el 2026-10-19 (no existe en Flowi.estudio).
-- btree_gist se habia instalado en public al aplicar la 067/068 y trajo ~100 funciones de soporte de
-- indices ejecutables por anon. Se muda al esquema extensions, que es el que usa Supabase. Las
-- restricciones de exclusion ya creadas siguen andando (referencian la clase de operadores por oid).
-- En una base nueva esto ya no hace falta: la 067/068 crean la extension directamente ahi.
do $$ begin
  if exists (select 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'btree_gist' and n.nspname <> 'extensions') then
    alter extension btree_gist set schema extensions;
  end if;
end $$;

$m092$;
  exception when others then
    raise exception 'FALLO LA MIGRACION 092_turnero_btree_gist_en_extensions.sql: % (SQLSTATE %)', sqlerrm, sqlstate;
  end;
  v_aplicadas := v_aplicadas || '092 ';

  begin
    execute $m093$
-- 093 - Aplicada a Valhalla el 2026-10-19. flowi_tz() sin search_path fijo (aviso del linter de Supabase).
-- En una base nueva ya viene con search_path desde la 069.
alter function public.flowi_tz() set search_path to 'public';

$m093$;
  exception when others then
    raise exception 'FALLO LA MIGRACION 093_turnero_flowi_tz_search_path.sql: % (SQLSTATE %)', sqlerrm, sqlstate;
  end;
  v_aplicadas := v_aplicadas || '093 ';


  -- ---------------------------------------------------------------------------------------
  -- Pruebas despues de aplicar
  -- ---------------------------------------------------------------------------------------
  v_s065 := pg_temp.suite065();

  begin
    v_flow := pg_temp.flow_reserva();
    raise exception using message = '__undo__';
  exception when others then
    if sqlerrm <> '__undo__' then v_flow := coalesce(v_flow, '') || 'FAIL [turnero] error inesperado: ' || sqlerrm || E'\n'; end if;
  end;

  -- Superficie de anon: exactamente la publica del turnero y nada mas
  v_priv := pg_temp.ck('[permisos] anon ejecuta SOLO la superficie publica',
    (select coalesce(string_agg(p.proname, ',' order by p.proname collate "C"), 'ninguna')
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute')),
    '^cancel_appointment_public,flowi_tz,get_appointment_by_reference,get_available_slots,get_available_slots_any,get_bookable_services,get_booking_header,get_popular_service,get_public_barbers,get_public_branch,get_walkin_windows,list_public_branches$');
  -- authenticated conserva todo lo que ya tenia (salvo los *_core, que se cierran a proposito)
  v_priv := v_priv || pg_temp.ck('[permisos] authenticated no pierde ninguna funcion que tenia',
    (select count(*)::text from pre_auth a join pg_proc p on p.oid = a.oid
      where not has_function_privilege('authenticated', a.oid, 'execute') and p.proname not like '\_%\_core'),
    '^0$');
  v_priv := v_priv || pg_temp.ck('[permisos] los *_core no los ejecuta authenticated',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like '\_%\_core' and has_function_privilege('authenticated', p.oid, 'execute')),
    '^0$');
  v_priv := v_priv || pg_temp.ck('[permisos] politicas viejas de profiles y transactions eliminadas',
    (select count(*)::text from pg_policies where schemaname = 'public' and policyname in ('profiles_update_own','barber_update_own_profile','transactions_barber_insert')),
    '^0$');
  v_priv := v_priv || pg_temp.ck('[permisos] trigger de guarda de perfiles creado',
    (select count(*)::text from pg_trigger where tgname = 'trg_guard_profile_update' and not tgisinternal), '^1$');
  v_priv := v_priv || pg_temp.ck('[permisos] buckets creados con tope de tamano',
    coalesce((select string_agg(id || '=' || coalesce(file_size_limit::text, 'sin tope'), ',' order by id) from storage.buckets), 'ninguno'),
    '^barber-photos=3145728,branch-logos=2097152$');
  v_priv := v_priv || pg_temp.ck('[permisos] funciones security definer del turnero sin search_path',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef and p.proconfig is null
        and p.oid not in (select oid from pre_all)
        and p.proname not like '\_%\_core'), '^0$');

  v_todo := v_antes || E'\n--- Bateria 065 ---\n' || v_s065 || E'\n--- Flujo del turnero ---\n' || v_flow || E'\n--- Permisos y estructura ---\n' || v_priv;
  v_pass := (length(v_todo) - length(replace(v_todo, E'\nPASS ', ''))) / 6;
  v_fail := (length(v_todo) - length(replace(v_todo, E'\nFAIL ', ''))) / 6;

  raise exception E'PRUEBA_TERMINADA_ROLLBACK_FORZADO\nMigraciones aplicadas en la prueba: %\nRESUMEN: PASS=%  FAIL=%  (nada quedo guardado)\n\n%', v_aplicadas, v_pass, v_fail, v_todo;
end
$prueba$;