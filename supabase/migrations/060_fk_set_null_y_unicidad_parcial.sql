-- ============================================================
-- 060: SOLTAR LAS FK Y LA UNICIDAD PARA QUE EL BORRADO SEA REAL
-- ============================================================
-- Segunda mitad del cambio que arranco en la 059. Esta migracion SI modifica
-- estructura existente: reemplaza tres foreign keys y tres restricciones UNIQUE.
-- Se aplica despues de verificar que la 059 dejo los 3.601 cortes con el nombre
-- del servicio congelado y los 818 con el del beneficio, sin una sola
-- discrepancia contra el catalogo.
--
-- 1. LAS FK PASAN A ON DELETE SET NULL
--    transactions.service_id / benefit_id / lifetime_member_id.
--    Con el nombre ya congelado en el corte (059), el vinculo dejo de ser
--    necesario para que el historial muestre lo que mostraba. Borrar un
--    servicio ahora funciona: los cortes conservan el nombre y quedan sin id.
--
--    Se pierde el VINCULO, no el dato visible. Hoy no hay ningun reporte por
--    servicio, asi que el cliente no nota nada; si mañana se quiere "ventas por
--    servicio" sobre historia vieja hay que agrupar por service_name_snap.
--
--    Los barberos NO entran: settlements es por barbero y todo el reporte
--    financiero se agrupa por el. Un barbero con historial se sigue archivando.
--
-- 2. LA UNICIDAD DE NOMBRE SOLO APLICA A LO NO ARCHIVADO
--    Los UNIQUE (branch_id, name) y (document_number) pasan a indices parciales
--    con "where archived_at is null". Un registro archivado deja de impedir que
--    se cree otro con el mismo nombre, que era la traba que quedaba para los
--    casos que si siguen yendo al cajon (barberos, y servicios usados como
--    corte clasico).
--
--    Consecuencia aceptada: dos registros pueden compartir nombre si uno esta
--    archivado. En la grilla no se cruzan porque el archivado no se muestra.
--
-- 3. admin_delete_or_archive SE ACTUALIZA
--    Los cortes dejan de ser un impedimento para servicios, beneficios y
--    socios: pasan a informarse como "afectados" para que el mensaje al admin
--    diga cuantos cortes conservan el nombre. Sigue bloqueando, a proposito, un
--    servicio que algun barbero tenga como corte clasico: eso es configuracion
--    viva, no historia, y el admin tiene que cambiarsela al barbero primero.
--    Para barberos no cambia nada.
--
-- 4. Se limpia set_benefit_full_amount_snap (056), que quedo huerfana cuando la
--    059 apunto el trigger a set_transaction_snapshots.
-- ============================================================

-- ── 1. FK ──────────────────────────────────────────────────────────────────
alter table public.transactions drop constraint if exists transactions_service_id_fkey;
alter table public.transactions
  add constraint transactions_service_id_fkey
  foreign key (service_id) references public.service_catalog(id) on delete set null;

alter table public.transactions drop constraint if exists transactions_benefit_id_fkey;
alter table public.transactions
  add constraint transactions_benefit_id_fkey
  foreign key (benefit_id) references public.benefits(id) on delete set null;

alter table public.transactions drop constraint if exists transactions_lifetime_member_id_fkey;
alter table public.transactions
  add constraint transactions_lifetime_member_id_fkey
  foreign key (lifetime_member_id) references public.lifetime_members(id) on delete set null;

-- ── 2. Unicidad parcial ────────────────────────────────────────────────────
alter table public.service_catalog drop constraint if exists service_catalog_branch_id_name_key;
create unique index if not exists service_catalog_branch_name_no_archivados
  on public.service_catalog (branch_id, name) where archived_at is null;

alter table public.benefits drop constraint if exists benefits_branch_name_unique;
create unique index if not exists benefits_branch_name_no_archivados
  on public.benefits (branch_id, name) where archived_at is null;

alter table public.lifetime_members drop constraint if exists lifetime_members_document_number_key;
create unique index if not exists lifetime_members_documento_no_archivados
  on public.lifetime_members (document_number) where archived_at is null;

-- ── 3. El RPC deja de contar los cortes como impedimento ───────────────────
create or replace function public.admin_delete_or_archive(p_kind text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nombre    text;
  v_usos      jsonb := '[]'::jsonb;   -- lo que IMPIDE borrar
  v_afectados integer := 0;           -- lo que queda con el nombre congelado
  v_n         integer;
begin
  if (select auth_role()) <> 'admin' then
    raise exception 'Solo administradores pueden eliminar registros';
  end if;

  if p_kind not in ('barbero', 'servicio', 'beneficio', 'socio') then
    raise exception 'Tipo de registro desconocido: %', p_kind;
  end if;

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

    -- Configuracion viva: esto SI impide borrar.
    select count(*) into v_n from profiles where classic_service_id = p_id;
    if v_n > 0 then v_usos := v_usos || jsonb_build_object('que', 'barberos que lo usan como corte clasico', 'n', v_n); end if;
    -- Historia: no impide, el corte se queda con el nombre.
    select count(*) into v_afectados from transactions where service_id = p_id;

  elsif p_kind = 'beneficio' then
    select name into v_nombre from benefits where id = p_id;
    if v_nombre is null then raise exception 'Beneficio no encontrado'; end if;
    select count(*) into v_afectados from transactions where benefit_id = p_id;

  else -- socio
    select full_name into v_nombre from lifetime_members where id = p_id;
    if v_nombre is null then raise exception 'Socio vitalicio no encontrado'; end if;
    select count(*) into v_afectados from transactions where lifetime_member_id = p_id;
  end if;

  if v_usos = '[]'::jsonb then
    begin
      case p_kind
        when 'barbero'   then delete from profiles         where id = p_id;
        when 'servicio'  then delete from service_catalog  where id = p_id;
        when 'beneficio' then delete from benefits         where id = p_id;
        when 'socio'     then delete from lifetime_members where id = p_id;
      end case;
      return jsonb_build_object('eliminado', true, 'nombre', v_nombre, 'afectados', v_afectados);
    exception when foreign_key_violation then
      -- Red de seguridad por si aparece una FK nueva que no contemplamos.
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

-- ── 4. Limpieza ────────────────────────────────────────────────────────────
drop function if exists public.set_benefit_full_amount_snap();
