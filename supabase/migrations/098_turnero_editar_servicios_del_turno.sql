-- 098 — Editar los servicios de un turno (además de mover fecha/hora/barbero)
--
-- El admin puede cambiar los servicios de un turno desde "Editar turno". La
-- función nueva hace TODO junto (servicios + horario + barbero) en una sola
-- transacción: recalcula el fin del turno con la duración de los servicios
-- nuevos y vuelve a chequear bloqueos y solapamientos.
--
-- move_appointment queda como estaba: la pantalla la sigue usando cuando solo
-- cambia el horario o el barbero, así que no depende de esta migración.
--
-- Reglas:
--   * Solo admin de la sucursal (mismo criterio que move_appointment).
--   * No se edita un turno cancelado ni uno que ya tiene el corte cargado
--     (transaction_id): cambiar los servicios dejaría el turno distinto del cobro.
--   * Los servicios que ya estaban conservan el precio y la duración con que se
--     reservaron; solo los agregados toman el precio actual del catálogo.

create or replace function public.edit_appointment(
  p_appointment_id uuid,
  p_new_starts_at  timestamptz,
  p_new_barber_id  uuid default null,
  p_service_ids    uuid[] default null
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
  v_tx        uuid;
  v_total_min integer;
  v_new_ends  timestamptz;
  v_bloqueo   text;
  v_svc_count integer;
begin
  select branch_id, barber_id, status, transaction_id
    into v_branch, v_barber, v_status, v_tx
    from appointments where id = p_appointment_id;

  if v_branch is null then
    raise exception 'El turno no existe';
  end if;
  if (select role from profiles where profiles.id = auth.uid()) is distinct from 'admin'
     or not coalesce(current_admin_has_branch(v_branch) or v_branch = current_user_branch(), false) then
    raise exception 'Sin permisos sobre esta sucursal';
  end if;
  if v_status = 'cancelado' then
    raise exception 'Un turno cancelado no se puede editar';
  end if;

  if p_service_ids is not null then
    if v_tx is not null then
      raise exception 'Este turno ya tiene el corte cargado: no se pueden cambiar sus servicios';
    end if;
    if array_length(p_service_ids, 1) is null then
      raise exception 'Elegí al menos un servicio';
    end if;

    -- Los que ya estaban se aceptan aunque hoy estén inactivos; los nuevos tienen
    -- que existir en la sucursal, estar activos y tener duración.
    select count(*) into v_svc_count
      from service_catalog sc
     where sc.id = any(p_service_ids)
       and sc.branch_id = v_branch
       and sc.duration_min is not null
       and (sc.is_active
            or exists (select 1 from appointment_services x
                        where x.appointment_id = p_appointment_id and x.service_id = sc.id));
    if v_svc_count <> (select count(distinct s) from unnest(p_service_ids) s) then
      raise exception 'Algún servicio elegido no existe, está inactivo o no tiene duración configurada';
    end if;

    delete from appointment_services
     where appointment_id = p_appointment_id
       and not (service_id = any(p_service_ids));

    insert into appointment_services (appointment_id, service_id, service_name, price, duration_min)
    select p_appointment_id, sc.id, sc.name, sc.base_price, sc.duration_min
      from service_catalog sc
     where sc.id = any(p_service_ids)
       and not exists (select 1 from appointment_services x
                        where x.appointment_id = p_appointment_id and x.service_id = sc.id);
  end if;

  select coalesce(sum(duration_min), 0) into v_total_min
    from appointment_services where appointment_id = p_appointment_id;

  v_new_ends := p_new_starts_at + make_interval(mins => v_total_min);

  v_bloqueo := public._bloqueo_en_horario(v_branch, coalesce(p_new_barber_id, v_barber), p_new_starts_at, v_new_ends);
  if v_bloqueo is not null then
    raise exception 'Ese horario está bloqueado para este barbero (%). Borrá el bloqueo si querés dejar el turno ahí.', v_bloqueo;
  end if;

  begin
    update appointments
       set starts_at = p_new_starts_at,
           ends_at   = v_new_ends,
           barber_id = coalesce(p_new_barber_id, v_barber)
     where id = p_appointment_id;
  exception
    when exclusion_violation then
      -- La transacción entera se revierte: los servicios no quedan cambiados a medias.
      raise exception 'Ese horario ya no está libre para este barbero';
  end;
end;
$function$;

-- Misma superficie que move_appointment: solo usuarios con sesión.
revoke execute on function public.edit_appointment(uuid, timestamptz, uuid, uuid[]) from public, anon;
grant execute on function public.edit_appointment(uuid, timestamptz, uuid, uuid[]) to authenticated, service_role;
