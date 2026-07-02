# Box rental — alquiler diario (cortes saldan el alquiler primero)

## Modelo
El barbero de **alquiler de box** paga un **alquiler DIARIO** (`profiles.box_rental_amount`).
Cada día, los primeros $X de cortes (efectivo/transfer/mixto) van a la **barbería** (saldan el
alquiler); superado ese monto, todo lo que registre ese día es del **barbero**. El umbral se
**reinicia cada día**. Si un día no llega al alquiler, la diferencia queda como **deuda**; la
liquidación semanal acumula el total.

Supuesto: el alquiler se devenga **solo los días que el barbero registra cortes**.

## Ya implementado (app, testeable en local)
- **ABM barberos** (`app/admin/barberos/barbers-abm.tsx`): campo renombrado a "Alquiler diario ($)"
  con hint; lista muestra "$X/día".
- **Registro** (`lib/supabase/supabase.client.ts` `registerCut`/`updateCut`): para box_rental parte
  cada corte según el acumulado del día → `branch_share` = parte alquiler, `barber_share` = parte
  del barbero, `barber_already_collected` = su parte.
- **UI barbero** (`app/barber/barber-mobile-view.tsx` + `barber.css`): panel de progreso del alquiler
  del día y reparto de cada corte (barbería / tuyo); "Tu parte" refleja el split; adelantos
  deshabilitados para box_rental.

## ✅ APLICADO (2026-07-02): migración RPC `calculate_settlement`
Migración `024_box_rental_settlement_auto.sql` aplicada en prod vía MCP. Cambios sobre lo
planificado: además `total_earned = gross - box_rent` y `total_deductions` sin box_rent para
box_rental (así "Total ganado" y "Ya cobrado" muestran la diferencia en la grilla), y
`recalculate_settlement_full` también actualiza `barber_already_collected`. UI: "Comisión base"
y demás bonos muestran "—" para box_rental, "Alquiler box" es solo lectura (auto), y la etiqueta
del barbero dice "Alquiler box". La rama box_rental quedó así:
- `box_rent` = alquiler devengado = `box_rental_amount * días_trabajados` (auto).
- `already_collected` = `gross - rent_paid` (lo que el barbero se queda).
- `net_payable` = `rent_paid - rent_owed` = −(alquiler no cubierto) → deuda si un día no llegó.

Y cambiar el `on conflict` de `box_rent = settlements.box_rent` a `box_rent = excluded.box_rent`
(para % y sueldo no cambia nada porque `v_box_rent` se lee del registro existente; para box_rental
gana el valor recalculado).

### SQL (rama box_rental + on conflict)
```sql
-- dentro de calculate_settlement, reemplazar la rama box_rental:
elsif v_barber.compensation_type = 'box_rental' then
  declare
    v_daily_rent numeric := coalesce(v_barber.box_rental_amount, 0);
    v_rent_paid  numeric;
    v_worked_days integer;
  begin
    select coalesce(sum(least(day_gross, v_daily_rent)), 0), count(*)
      into v_rent_paid, v_worked_days
    from (
      select transaction_date, sum(amount) as day_gross
      from transactions
      where week_id = p_week_id and barber_id = p_barber_id
      group by transaction_date
    ) d;
    v_barber_gross      := v_gross_amount;
    v_already_collected := v_gross_amount - v_rent_paid;
    v_box_rent          := v_daily_rent * v_worked_days;  -- alquiler devengado (auto)
  end;
end if;
-- ...
-- en el ON CONFLICT DO UPDATE, cambiar:
--   box_rent = settlements.box_rent
-- por:
--   box_rent = excluded.box_rent
```

### SQL — también corregir `recalculate_settlement_full`
Hoy su rama box_rental hace `set barber_share = amount, branch_share = 0`, que **pisa** el split
diario. Reemplazar por el reparto por umbral respetando el orden cronológico del día:
```sql
elsif v_barber.compensation_type = 'box_rental' then
  update transactions t
  set branch_share = sub.to_shop,
      barber_share = round(t.amount - sub.to_shop, 2)
  from (
    select id,
      greatest(0, least(amount, coalesce(v_barber.box_rental_amount, 0) - acc_before)) as to_shop
    from (
      select id, amount,
        coalesce(sum(amount) over (
          partition by transaction_date
          order by created_at, id
          rows between unbounded preceding and 1 preceding
        ), 0) as acc_before
      from transactions
      where week_id = p_week_id and barber_id = p_barber_id
    ) x
  ) sub
  where t.id = sub.id;
```

## Orden de aplicación
1. Probar app en local (registro + UI barbero + ABM).
2. Aplicar migración (ambos RPC) en la DB del cliente cuando esté OK.
3. Push a Vercel.
