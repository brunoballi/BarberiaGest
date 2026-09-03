-- ============================================================
-- 052: EL RECALCULO MASIVO NO PISA LIQUIDACIONES CONFIRMADAS NI PAGADAS
-- ============================================================
-- calculate_settlement no tiene guarda de estado: su 'on conflict do update'
-- pisa una liquidacion confirmada o pagada sin avisar. Los botones "Cerrar
-- semana" y "Recalcular" llaman a calculate_all_settlements para TODOS los
-- barberos de la semana seleccionada, asi que pararse sobre una semana vieja y
-- apretar Recalcular reescribia liquidaciones ya pagadas.
--
-- DONDE VA LA GUARDA — nota importante
-- El plan original era ponerla adentro de calculate_settlement. No se hizo asi,
-- por dos razones:
--
--  1. Un 'raise' adentro de calculate_settlement abortaria el lote entero de
--     "Cerrar semana" en cuanto una sola liquidacion de la semana este paga.
--
--  2. Un 'return' silencioso adentro de calculate_settlement romperia los
--     toggles del dashboard. setPresentismo, setMantenimiento y setObjetivoMet
--     escriben el flag con un UPDATE directo a la tabla y DESPUES llaman a
--     calculate_settlement para recalcular el monto del bono. Esos toggles no
--     estan deshabilitados para liquidaciones confirmadas o pagadas
--     (admin-dashboard.tsx:1190, 1239, 1307: solo miran loading y el gate de
--     mantenimiento). Con la guarda adentro, el flag quedaria marcado y el
--     monto sin recalcular: peor que el problema original.
--
-- Por eso la guarda va en el lote, que es donde vive el riesgo masivo. Los
-- flujos de una sola fila siguen como estaban:
--   * recalculate_settlement_full ya corta con un error claro (esta bien: es
--     una accion explicita del admin sobre una fila puntual).
--   * los toggles siguen recalculando la fila que el admin esta tocando.
--   * refreshSettlementQuietly (registrar/editar un corte) sigue refrescando.
--
-- QUEDA PENDIENTE (fuera de alcance de esta migracion): decidir si los toggles
-- de presentismo / mantenimiento / objetivo deberian deshabilitarse cuando la
-- liquidacion no esta en borrador, como ya hace weeks-view.tsx:660 con
-- canEdit = weekStatus === 'closed' && s.status === 'draft'. Si se
-- deshabilitan, la guarda se puede mover adentro de calculate_settlement y la
-- proteccion pasa a ser total.
--
-- El valor de retorno cambia de sentido: antes contaba los barberos recorridos,
-- ahora cuenta los efectivamente recalculados. Hoy nadie lee ese numero
-- (calculateAllSettlementsForWeek en supabase.client.ts:1462 solo mira el error).
-- ============================================================

create or replace function public.calculate_all_settlements(
  p_week_id uuid,
  p_barber_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
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
$$;

revoke all on function public.calculate_all_settlements(uuid, uuid[]) from public, anon;
grant execute on function public.calculate_all_settlements(uuid, uuid[]) to authenticated;
