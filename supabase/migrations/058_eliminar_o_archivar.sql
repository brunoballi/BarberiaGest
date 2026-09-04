-- ============================================================
-- 058: ELIMINAR DE VERDAD LO QUE NO TIENE HISTORIAL, ARCHIVAR EL RESTO
-- ============================================================
-- Hoy "eliminar" un barbero, un servicio, un beneficio o un socio vitalicio en
-- realidad solo pone is_active = false, y la tarjeta se sigue dibujando (con
-- opacity-60 en services-view y benefits-view). Queda como desactivado, se
-- malinterpreta y ensucia la pantalla.
--
-- Borrar siempre no es opcion: transactions.barber_id, settlements.barber_id,
-- transactions.service_id y transactions.benefit_id son NO ACTION, asi que la
-- base rechaza el borrado en cuanto hay un solo corte. Y forzarlo con CASCADE
-- destruiria la historia que blindaron las migraciones 049-057: un barbero
-- borrado se llevaria puestas sus liquidaciones pagadas.
--
-- Peor todavia, hay cuatro FK que YA son CASCADE y que nadie ve:
--   admin_branches.admin_id, barber_debt_payments.barber_id,
--   maintenance_sheet_items.barber_id, maintenance_template_blocks.barber_id
-- Un delete "exitoso" de un barbero se llevaria en silencio sus pagos de deuda,
-- sus planillas de mantenimiento y sus permisos de sucursal. Por eso esas
-- relaciones se chequean ANTES a mano; para el resto alcanza con capturar
-- foreign_key_violation, que no se puede escapar ninguna.
--
-- COMPORTAMIENTO
--   sin historial -> DELETE real, desaparece de la tabla
--   con historial -> is_active = false + archived_at = now(), y la UI lo saca
--                    de la grilla principal (queda detras de "Ver archivados")
--                    devolviendo el detalle de por que no se pudo, para que el
--                    admin vea el motivo concreto y no un "no se puede" pelado.
--
-- archived_at es distinto de is_active a proposito: "Desactivar" sigue siendo
-- pausar (se ve, atenuado) y "Eliminar" es sacar de la vista. Son dos acciones
-- con dos intenciones distintas y el cliente las usa distinto.
--
-- Estado al aplicar: de los 8 registros hoy desactivados, 5 se pueden borrar de
-- verdad (Bruno, Clientes Fijos, Clientes Vip, Desc. % Clientes Fijos, Promo
-- miercoles corte clasico & barba) y 3 no (Matias Alvarez con 81 cortes y 6
-- liquidaciones, PROMO CORTE + BARBA EXPRESS con 5, Promo miercoles corte
-- degrade + barba con 2). Esta migracion no toca ninguno: solo da la
-- herramienta, la decision es del admin desde la pantalla.
-- ============================================================

alter table public.profiles        add column if not exists archived_at timestamptz;
alter table public.service_catalog add column if not exists archived_at timestamptz;
alter table public.benefits        add column if not exists archived_at timestamptz;
alter table public.lifetime_members add column if not exists archived_at timestamptz;

comment on column public.profiles.archived_at is
  'Se intento eliminar pero tenia historial: queda fuera de la grilla principal. Distinto de is_active = false, que es una pausa deliberada y sigue visible.';
comment on column public.service_catalog.archived_at is 'Ver profiles.archived_at.';
comment on column public.benefits.archived_at is 'Ver profiles.archived_at.';
comment on column public.lifetime_members.archived_at is 'Ver profiles.archived_at.';

create or replace function public.admin_delete_or_archive(p_kind text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nombre text;
  v_usos   jsonb := '[]'::jsonb;
  v_n      integer;
begin
  if (select auth_role()) <> 'admin' then
    raise exception 'Solo administradores pueden eliminar registros';
  end if;

  if p_kind not in ('barbero', 'servicio', 'beneficio', 'socio') then
    raise exception 'Tipo de registro desconocido: %', p_kind;
  end if;

  -- ── Nombre + conteo de usos, para el mensaje al admin ──────────────────
  if p_kind = 'barbero' then
    select full_name into v_nombre from profiles where id = p_id;
    if v_nombre is null then raise exception 'Barbero no encontrado'; end if;

    select count(*) into v_n from transactions where barber_id = p_id;
    if v_n > 0 then v_usos := v_usos || jsonb_build_object('que', 'cortes registrados', 'n', v_n); end if;
    select count(*) into v_n from settlements where barber_id = p_id;
    if v_n > 0 then v_usos := v_usos || jsonb_build_object('que', 'liquidaciones', 'n', v_n); end if;
    select count(*) into v_n from advances where barber_id = p_id;
    if v_n > 0 then v_usos := v_usos || jsonb_build_object('que', 'adelantos', 'n', v_n); end if;
    select count(*) into v_n from barber_debt_payments where barber_id = p_id;
    if v_n > 0 then v_usos := v_usos || jsonb_build_object('que', 'pagos de deuda', 'n', v_n); end if;
    select count(*) into v_n from maintenance_sheet_items where barber_id = p_id;
    if v_n > 0 then v_usos := v_usos || jsonb_build_object('que', 'items de mantenimiento', 'n', v_n); end if;
    select count(*) into v_n from maintenance_template_blocks where barber_id = p_id;
    if v_n > 0 then v_usos := v_usos || jsonb_build_object('que', 'bloques de plantilla', 'n', v_n); end if;
    select count(*) into v_n from admin_branches where admin_id = p_id;
    if v_n > 0 then v_usos := v_usos || jsonb_build_object('que', 'permisos de sucursal', 'n', v_n); end if;
    select count(*) into v_n from expenses where partner_id = p_id;
    if v_n > 0 then v_usos := v_usos || jsonb_build_object('que', 'retiros como socio', 'n', v_n); end if;

  elsif p_kind = 'servicio' then
    select name into v_nombre from service_catalog where id = p_id;
    if v_nombre is null then raise exception 'Servicio no encontrado'; end if;

    select count(*) into v_n from transactions where service_id = p_id;
    if v_n > 0 then v_usos := v_usos || jsonb_build_object('que', 'cortes registrados', 'n', v_n); end if;
    select count(*) into v_n from profiles where classic_service_id = p_id;
    if v_n > 0 then v_usos := v_usos || jsonb_build_object('que', 'barberos que lo usan como corte clasico', 'n', v_n); end if;

  elsif p_kind = 'beneficio' then
    select name into v_nombre from benefits where id = p_id;
    if v_nombre is null then raise exception 'Beneficio no encontrado'; end if;

    select count(*) into v_n from transactions where benefit_id = p_id;
    if v_n > 0 then v_usos := v_usos || jsonb_build_object('que', 'cortes registrados', 'n', v_n); end if;

  else -- socio
    select full_name into v_nombre from lifetime_members where id = p_id;
    if v_nombre is null then raise exception 'Socio vitalicio no encontrado'; end if;

    select count(*) into v_n from transactions where lifetime_member_id = p_id;
    if v_n > 0 then v_usos := v_usos || jsonb_build_object('que', 'cortes registrados', 'n', v_n); end if;
  end if;

  -- ── Sin usos: borrado real. Con usos: archivar. ────────────────────────
  -- El chequeo de arriba cubre las relaciones CASCADE (que borrarian en
  -- silencio); el exception handler cubre cualquier NO ACTION que se nos
  -- escape, ahora o cuando alguien agregue una FK nueva.
  if v_usos = '[]'::jsonb then
    begin
      case p_kind
        when 'barbero'   then delete from profiles         where id = p_id;
        when 'servicio'  then delete from service_catalog  where id = p_id;
        when 'beneficio' then delete from benefits         where id = p_id;
        when 'socio'     then delete from lifetime_members where id = p_id;
      end case;
      return jsonb_build_object('eliminado', true, 'nombre', v_nombre);
    exception when foreign_key_violation then
      v_usos := jsonb_build_array(
        jsonb_build_object('que', 'referencias en otros registros', 'n', null));
    end;
  end if;

  case p_kind
    when 'barbero'   then update profiles         set is_active = false, archived_at = now() where id = p_id;
    when 'servicio'  then update service_catalog  set is_active = false, archived_at = now() where id = p_id;
    when 'beneficio' then update benefits         set is_active = false, archived_at = now() where id = p_id;
    when 'socio'     then update lifetime_members set is_active = false, archived_at = now() where id = p_id;
  end case;

  return jsonb_build_object(
    'eliminado', false, 'archivado', true, 'nombre', v_nombre, 'usos', v_usos);
end;
$$;

revoke all on function public.admin_delete_or_archive(text, uuid) from public, anon;
grant execute on function public.admin_delete_or_archive(text, uuid) to authenticated;

-- Desarchivar, para el caso de que se hayan mandado.
create or replace function public.admin_unarchive(p_kind text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select auth_role()) <> 'admin' then
    raise exception 'Solo administradores pueden desarchivar registros';
  end if;

  case p_kind
    when 'barbero'   then update profiles         set archived_at = null where id = p_id;
    when 'servicio'  then update service_catalog  set archived_at = null where id = p_id;
    when 'beneficio' then update benefits         set archived_at = null where id = p_id;
    when 'socio'     then update lifetime_members set archived_at = null where id = p_id;
    else raise exception 'Tipo de registro desconocido: %', p_kind;
  end case;
end;
$$;

revoke all on function public.admin_unarchive(text, uuid) from public, anon;
grant execute on function public.admin_unarchive(text, uuid) to authenticated;
