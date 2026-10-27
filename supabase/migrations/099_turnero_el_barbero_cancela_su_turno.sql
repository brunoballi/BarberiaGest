-- 099 — El barbero puede cancelar sus propios turnos
--
-- cancel_appointment es solo del admin. Esta es la del barbero: solo sobre SUS
-- turnos (barber_id = quien llama). Hace lo mismo que la del admin: el turno
-- queda en estado 'cancelado' (no se borra, queda el historial) y el horario
-- vuelve a estar libre.
--
-- No se cancela un turno que ya tiene el corte cargado (transaction_id), ni uno
-- ya atendido o marcado "no vino": son hechos consumados, no se deshacen.

create or replace function public.cancel_appointment_barber(
  p_appointment_id uuid,
  p_reason         text default null
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_me     uuid := auth.uid();
  v_barber uuid;
  v_status appointment_status;
  v_tx     uuid;
begin
  if not exists (
    select 1 from profiles
     where profiles.id = v_me and (profiles.role = 'barber' or profiles.is_barber)
  ) then
    raise exception 'Solo barberos pueden cancelar sus turnos';
  end if;

  select barber_id, status, transaction_id
    into v_barber, v_status, v_tx
    from appointments where id = p_appointment_id;

  if v_barber is null then
    raise exception 'El turno no existe';
  end if;
  if v_barber is distinct from v_me then
    raise exception 'Solo podés cancelar tus propios turnos';
  end if;
  if v_status = 'cancelado' then
    raise exception 'El turno ya estaba cancelado';
  end if;
  if v_status in ('atendido', 'no_vino') or v_tx is not null then
    raise exception 'Este turno ya fue atendido: no se puede cancelar';
  end if;

  update appointments
     set status = 'cancelado',
         notes  = case when p_reason is not null and btrim(p_reason) <> ''
                        then coalesce(notes || ' — ', '') || 'Cancelado: ' || p_reason
                        else notes end
   where id = p_appointment_id;
end;
$function$;

-- Misma superficie que cancel_appointment: solo usuarios con sesión.
revoke execute on function public.cancel_appointment_barber(uuid, text) from public, anon;
grant execute on function public.cancel_appointment_barber(uuid, text) to authenticated, service_role;
