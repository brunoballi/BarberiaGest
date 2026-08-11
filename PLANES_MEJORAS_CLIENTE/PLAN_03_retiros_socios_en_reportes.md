# PLAN 03: Desglose de Retiros de Socios en Reportes

> **✅ IMPLEMENTADO** (rama `feat/modulo-gastos`), migración `046_reportes_desglose_retiros_socios.sql`.
>
> ### ⚠️ Hallazgo grave: la base LOCAL estaba atrasada respecto de PROD
>
> El plan advertía "copiar la función completa de 043, no reescribir desde cero". Al ir a hacerlo apareció algo peor: **había tres versiones distintas de `report_by_period()`**:
>
> | Fuente | Columnas | Estado |
> |---|---|---|
> | Base **local** | 10 | Atrasada — le faltaban `branch_from_cuts`, `branch_from_rent`, `branch_cuts_barbers`, `branch_rent_barbers`. Reparto 50/50 fijo, sin `paid_settlements`. |
> | Archivo `043` del repo | 14 | Coincide en features con prod |
> | **Base de PROD** | 14 | ✅ Fuente de verdad usada |
>
> Si la migración se hubiera escrito sobre lo que tenía la base local (que era el camino "natural", ya que ahí se prueba), **al aplicarla en prod habría borrado el desglose de barbería por barbero y revertido el cálculo a 50/50 fijo**. Se verificó `pg_get_functiondef` contra el proyecto del cliente (solo lectura) y la 046 se escribió sobre **esa** versión.
>
> **Regla para las próximas migraciones que toquen `report_by_period` o cualquier función reescrita completa: sacar la definición de PROD, nunca del repo ni de la base local.**
>
> ### Otras notas
> - Se dropeó la función antes de recrearla: agregar una columna cambia el `RETURNS TABLE` y `create or replace` falla en ese caso.
> - `partner_withdrawals` (total) **ya existía** en la función; esto solo suma `partner_withdrawals_partners` con el detalle.
> - Los retiros con `partner_id` nulo (filas anteriores a la migración 044) se agrupan como **"Sin socio asignado"** en vez de descartarse, para que el desglose siempre sume el total.
> - En la tarjeta Consolidada, un socio que retira de varias sucursales se unifica en una sola línea (si no, aparecía repetido).
>
> **Verificado en local:** con $450.000 de retiros en julio (Ezequiel $300.000 + Jesus $150.000), la fila desplegable muestra el detalle correcto en la tarjeta de sucursal y en la consolidada, y `total_expenses` devolvió 59.389 (solo servicios) — los retiros siguen sin contaminar la ganancia neta.

**Depende de:** PLAN_02 (usa la columna `expenses.partner_id` definida ahí, que referencia `profiles.id` de los admins/socios).

## 📋 ESTADO ACTUAL

El patrón "totalizador con desplegable ▶/▼ por barbero/barbería" que se pidió replicar ya existe en `app/admin/reportes/reportes-view.tsx`:

```tsx
// reportes-view.tsx línea ~535 y ~599
function BranchBreakdownRow({ total, fromCuts, fromRent, cutsBarbers, rentBarbers }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <div className="metric-row" onClick={() => hasBreakdown && setOpen(o=>!o)}>
        <span>{open ? '▼':'▶'} Total barbería</span><span>{formatARS(total)}</span>
      </div>
      {open && cutsBarbers.map(b => <div key={b.barberId}><span>{b.fullName}</span><span>{formatARS(b.total)}</span></div>)}
    </>
  )
}
function BarberBreakdownRow(...) { /* mismo patrón, agrupado por barbero */ }
```

Datos: tipo `BranchReport` (`lib/supabase/database.types.ts` línea ~420-440) con `branchCutsBarbers`, `branchRentBarbers`, `barbers: {barberId, fullName, total}[]`, poblado por el RPC `report_by_period` (última versión: `supabase/migrations/043_reportes_desglose_barberia_por_barbero.sql`), que agrega todo server-side.

## 🎯 OBJETIVO

Agregar una fila más "Retiros de socios" en Reportes, con el mismo comportamiento colapsable, mostrando el total y — al expandir — el desglose por cada socio.

## 🛠️ IMPLEMENTACIÓN

### Paso 1: Nueva migración SQL

Crear `supabase/migrations/04X_reportes_desglose_retiros_socios.sql`, que redefine `report_by_period()` (siguiendo el mismo patrón que `042`/`043`) agregando al JSON de salida:

```sql
-- Nuevo bloque, mismo estilo que barber_agg/branch_split ya usados en la función
, partner_withdrawals as (
    select
      e.partner_id,
      p.full_name as partner_name,
      sum(e.amount) as total
    from expenses e
    join profiles p on p.id = e.partner_id
    where e.category = 'retiro_socio'
      and e.partner_id is not null
      and e.branch_id = any(p_branch_ids)
      and e.expense_date between p_start_date and p_end_date
    group by 1, 2
  )
```
y sumarlo al `jsonb_build_object(...)` de retorno como `'partner_withdrawals', (select jsonb_agg(...) from partner_withdrawals)` + `'partner_withdrawals_total', (select coalesce(sum(total),0) from partner_withdrawals)`. Al usar `partner_id` (FK a `profiles`, definido en PLAN_02) el agrupamiento es exacto — nada de texto libre a interpretar.

### Paso 2: Tipo TypeScript

En `lib/supabase/database.types.ts`, extender `BranchReport` (línea ~420-440):
```ts
partnerWithdrawals: { partnerKey: string; partnerName: string; total: number }[]
partnerWithdrawalsTotal: number
```

### Paso 3: Frontend

En `reportes-view.tsx`, agregar una fila más usando el mismo componente `BranchBreakdownRow` (o una variante `PartnerBreakdownRow` si la forma de los datos difiere), ubicada junto a las filas de "Total barbería" / "Total por barbero" ya existentes, para mantener el mismo layout que el cliente ya conoce.

## 📝 ARCHIVOS A MODIFICAR / CREAR

1. **Crear** `supabase/migrations/04X_reportes_desglose_retiros_socios.sql`
2. **Modificar** `lib/supabase/database.types.ts` — extender `BranchReport`
3. **Modificar** `app/admin/reportes/reportes-view.tsx` — nueva fila colapsable
4. **Modificar** `lib/supabase/supabase.client.ts` — si `getReportByPeriod()` mapea campos explícitos del RPC (no un pass-through directo), sumar el mapeo nuevo

## ⚠️ RIESGOS

- **Migraciones de `report_by_period()` se van pisando una a la otra completas** (008→022→...→043→esta nueva) — copiar la función completa de `043` y agregar el bloque nuevo, no reescribir desde cero, para no perder ningún cálculo ya corregido en versiones anteriores (ver riesgo ya documentado en el grafo: colisión de numeración de migraciones — revisar cuál es el último número real en `supabase/migrations/` antes de nombrar el archivo, el repo puede no reflejar 1:1 lo que está en producción).
- Confirmar contra prod con `list_migrations` (MCP Supabase) el número de la última migración aplicada antes de crear el archivo nuevo, no asumir por lo que hay en el repo local (ver memoria: migraciones repo incompletas / drift).

## ✅ CHECKLIST

- [ ] PLAN_02 (columna `partner_id`) ya deployado antes de arrancar
- [ ] Migración no rompe ningún desglose existente (cortes, alquiler de box)
- [ ] Fila "Retiros de socios" aparece en Reportes con el mismo comportamiento ▶/▼
- [ ] Validado contra prod: total coincide con la suma manual de `expenses` con `category='retiro_socio'` del período

## 🎯 BENEFICIOS

✅ Visibilidad de retiros por socio sin salir de Reportes
✅ Mismo lenguaje visual que ya usa el cliente para barberos/barbería — sin curva de aprendizaje nueva
