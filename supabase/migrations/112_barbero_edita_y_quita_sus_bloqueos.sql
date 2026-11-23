-- ============================================================
-- 112 — El barbero puede QUITAR y EDITAR los bloqueos que cargó él; el admin puede EDITAR los de su sucursal
-- ============================================================
-- Hasta ahora:
--   * el barbero solo podía CREAR su bloqueo (create_schedule_exception_barber): si se equivocaba de
--     día o de hora no podía corregirlo ni quitarlo, tenía que pedírselo al admin;
--   * delete_schedule_exception era solo del admin;
--   * no existía ninguna función de edición (ni el admin podía editar, solo quitar y volver a cargar).
--
-- Reglas:
--   * Admin de la sucursal: quita y edita cualquier bloqueo de esa sucursal (como antes para quitar).
--   * Barbero: quita y edita SOLO los suyos = barber_id = él Y creados por él (created_by). No puede tocar
--     los de toda la sucursal (barber_id null) ni uno que le puso el admin (por ejemplo una licencia).
--   * Editar no cambia de sucursal ni de barbero: solo fecha, franja y motivo.
-- Las dos funciones son security definer y se llaman solo con sesión (authenticated).
-- ============================================================

create or replace function public.delete_schedule_exception(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_branch  uuid;
  v_barber  uuid;
  v_creator uuid;
  v_ok      boolean;
begin
  select branch_id, barber_id, created_by into v_branch, v_barber, v_creator
    from schedule_exceptions where id = p_id;
  if v_branch is null then
    raise exception 'La excepción no existe';
  end if;

  v_ok := coalesce(
            (select role from profiles where id = auth.uid()) = 'admin'
            and coalesce(current_admin_has_branch(v_branch) or v_branch = current_user_branch(), false),
            false)
          or coalesce(
            v_barber is not null and v_barber = auth.uid() and v_creator = auth.uid()
            and v_branch = current_user_branch(),
            false);
  if not v_ok then
    raise exception 'Sin permisos para configurar excepciones de esta sucursal';
  end if;

  delete from schedule_exceptions where id = p_id;
end;
$function$;

create or replace function public.update_schedule_exception(
  p_id             uuid,
  p_exception_date date,
  p_closed_all_day boolean default true,
  p_start_time     time default null,
  p_end_time       time default null,
  p_reason         text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_branch  uuid;
  v_barber  uuid;
  v_creator uuid;
  v_ok      boolean;
  v_todo    boolean := coalesce(p_closed_all_day, true);
begin
  select branch_id, barber_id, created_by into v_branch, v_barber, v_creator
    from schedule_exceptions where id = p_id;
  if v_branch is null then
    raise exception 'La excepción no existe';
  end if;

  v_ok := coalesce(
            (select role from profiles where id = auth.uid()) = 'admin'
            and coalesce(current_admin_has_branch(v_branch) or v_branch = current_user_branch(), false),
            false)
          or coalesce(
            v_barber is not null and v_barber = auth.uid() and v_creator = auth.uid()
            and v_branch = current_user_branch(),
            false);
  if not v_ok then
    raise exception 'Sin permisos para configurar excepciones de esta sucursal';
  end if;

  if p_exception_date is null then
    raise exception 'Falta la fecha del bloqueo';
  end if;
  if not v_todo and (p_start_time is null or p_end_time is null or p_end_time <= p_start_time) then
    raise exception 'La hora de inicio tiene que ser antes que la de fin';
  end if;

  update schedule_exceptions
     set exception_date = p_exception_date,
         closed_all_day = v_todo,
         start_time     = case when v_todo then null else p_start_time end,
         end_time       = case when v_todo then null else p_end_time end,
         reason         = nullif(btrim(coalesce(p_reason, '')), '')
   where id = p_id;
end;
$function$;

revoke all on function public.update_schedule_exception(uuid, date, boolean, time, time, text) from public, anon;
grant execute on function public.update_schedule_exception(uuid, date, boolean, time, time, text) to authenticated, service_role;
