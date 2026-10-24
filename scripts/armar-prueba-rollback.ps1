param([switch]$Solo065)
# Arma supabase/pendientes/PRUEBA_rollback_065_a_091.sql a partir de las migraciones reales.
#
# El script generado es UNA SOLA sentencia (un bloque DO), asi que es atomica: aplica la 065 y la
# 066-091 dentro de la transaccion, corre las pruebas con usuarios simulados y termina con un
# RAISE EXCEPTION, que deshace TODO. No persiste nada.
#
# Uso:  powershell -File scripts\armar-prueba-rollback.ps1
# Luego: pegar el archivo generado en Supabase > SQL Editor del proyecto de Valhalla y correrlo.
# El resultado aparece como un "error" que empieza con PRUEBA_TERMINADA_ROLLBACK_FORZADO.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$mig  = Join-Path $root 'supabase\migrations'
$out  = Join-Path $root 'supabase\pendientes\PRUEBA_rollback_065_a_091.sql'
$enc  = [Text.UTF8Encoding]::new($false)

$files = @()
$files += Get-ChildItem $mig -Filter '065_cierre_escalada_de_privilegios.sql'
$files += Get-ChildItem $mig | Where-Object { $_.Name -match '^(06[6-9]|0[7-9]\d)_turnero_.*\.sql$' } | Sort-Object Name
if ($Solo065) { $files = @($files | Select-Object -First 1); $out = Join-Path $root 'supabase\pendientes\PRUEBA_rollback_065_solo.sql' } elseif ($files.Count -lt 27) { throw "Se esperaban al menos 27 archivos y hay $($files.Count)" }

$publicas = @('cancel_appointment_public','flowi_tz','get_appointment_by_reference','get_available_slots','get_available_slots_any','get_bookable_services','get_booking_header','get_popular_service','get_public_barbers','get_public_branch','get_walkin_windows','list_public_branches')
$publicasEsperadas = ($publicas | Sort-Object { $_ } -CaseSensitive) -join ','

$apply = New-Object System.Text.StringBuilder
foreach ($f in $files) {
  $num = $f.Name.Substring(0, 3)
  $tag = 'm' + $num
  $body = [IO.File]::ReadAllText($f.FullName, $enc).TrimStart([char]0xFEFF) -replace "`r`n", "`n"
  if ($body.Contains('$' + $tag + '$')) { throw "El archivo $($f.Name) contiene el delimitador $tag" }
  [void]$apply.Append("  begin`n    execute `$$tag`$`n")
  [void]$apply.Append($body)
  [void]$apply.Append("`n`$$tag`$;`n  exception when others then`n    raise exception 'FALLO LA MIGRACION $($f.Name): % (SQLSTATE %)', sqlerrm, sqlstate;`n  end;`n")
  [void]$apply.Append("  v_aplicadas := v_aplicadas || '$num ';`n`n")
}

$flowBlockFull = @'
  begin
    v_flow := pg_temp.flow_reserva();
    raise exception using message = '__undo__';
  exception when others then
    if sqlerrm <> '__undo__' then v_flow := coalesce(v_flow, '') || 'FAIL [turnero] error inesperado: ' || sqlerrm || E'\n'; end if;
  end;

'@
$bucketsFull = @'
  v_priv := v_priv || pg_temp.ck('[permisos] buckets creados con tope de tamano',
    coalesce((select string_agg(id || '=' || coalesce(file_size_limit::text, 'sin tope'), ',' order by id) from storage.buckets), 'ninguno'),
    '^barber-photos=3145728,branch-logos=2097152$');
'@

$tpl = @'
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
/*MIGRACIONES*/
  -- ---------------------------------------------------------------------------------------
  -- Pruebas despues de aplicar
  -- ---------------------------------------------------------------------------------------
  v_s065 := pg_temp.suite065();

/*FLOW*/
  -- Superficie de anon: exactamente la publica del turnero y nada mas
  v_priv := pg_temp.ck('[permisos] anon ejecuta SOLO la superficie publica',
    (select coalesce(string_agg(p.proname, ',' order by p.proname collate "C"), 'ninguna')
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute')),
    '^/*PUBLICAS*/$');
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
/*BUCKETS*/
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
'@

if ($Solo065) { $flowTxt = ''; $bucketsTxt = ''; $publicasEsperadas = 'ninguna'; $tpl = $tpl.Replace('PRUEBA DE PUNTA A PUNTA CON ROLLBACK FORZADO: migraciones 065 + 066 a 091 (turnero)', 'PRUEBA CON ROLLBACK FORZADO: SOLO la migracion 065') } else { $flowTxt = $flowBlockFull; $bucketsTxt = $bucketsFull }
$tpl = $tpl.Replace('/*FLOW*/', $flowTxt).Replace('/*BUCKETS*/', $bucketsTxt).Replace('/*MIGRACIONES*/', $apply.ToString()).Replace('/*PUBLICAS*/', $publicasEsperadas)
New-Item -ItemType Directory -Force (Split-Path $out) | Out-Null
[IO.File]::WriteAllText($out, ($tpl -replace "`r`n", "`n"), $enc)
$sz = [Math]::Round((Get-Item $out).Length / 1KB)
"Generado: $out  ($sz KB, $($files.Count) migraciones)"
