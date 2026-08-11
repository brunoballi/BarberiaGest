# PLAN 06: Sección "Mantenimiento" en mobile + bloqueo en Liquidaciones

> **✅ IMPLEMENTADO — SIN migración de RLS.**
>
> El plan preveía una migración para que el barbero pudiera leer sus ítems. **No hizo falta**: la policy existente `maint_sheet_items_read` ya es `current_admin_has_branch(branch_id) OR branch_id = current_user_branch()`, o sea que un barbero ya podía leer los ítems de su sucursal.
>
> Tampoco hizo falta policy de UPDATE: según lo que definiste, **el barbero solo VE** sus tareas — el admin es quien las marca Sí/No. La vista mobile es de solo lectura (checklist con progreso), lo cual además elimina el riesgo de que un barbero se auto-marque tareas.
>
> **Lo implementado:**
> - `getBarberMaintenanceForWeek()` — checklist del barbero para el mobile.
> - `getMaintenanceStatusByBarber()` — estado de **todos** los barberos de la semana en **una sola query**, para que Liquidaciones no dispare una por fila.
> - Vista `maintenance` en el mobile (barra de progreso + lista, con estados vacíos para "no hay planilla todavía" y "no tenés tareas") + entrada 🧹 en el menú del barbero.
> - En Liquidaciones el campo Mantenimiento pasó de **solo lectura** a toggle gateado: se habilita únicamente si hay planilla y el barbero tiene el 100% de sus tareas. Si no, queda **grisado** con tooltip diciendo exactamente qué falta (`Faltan N de M tarea(s): ...`) o que todavía no se creó la planilla.
> - `handleMantenimiento` reutiliza `setMantenimiento()`, que ya existía y recalcula la liquidación — el bono se sigue calculando igual que antes.
>
> **Decisión de borde:** un barbero **sin tareas asignadas** no queda bloqueado (`allDone = true` cuando `total === 0`). Bloquearlo sería castigarlo por una planilla que no lo incluye.

**Depende de:** PLAN_05 (tareas con `barber_id` propio).

## 📋 ESTADO ACTUAL

**Mobile del barbero** (`app/barber/barber-mobile-view.tsx`): navegación por state machine simple, sin router:
```tsx
type View = 'home' | 'register' | 'success' | 'settlements'
const [view, setView] = useState<View>('home')
```
Cada vista es un `if (view === 'x') return (...)` completo. El menú lateral (`BarberSideDrawer`) dispara los cambios de vista vía callbacks. Hoy el módulo de Mantenimiento (`app/admin/mantenimiento/mantenimiento-view.tsx`) es **100% admin-only** — no expuesto al barbero.

**Liquidaciones — el campo que se reutiliza (decisión ya tomada con el cliente):**
```tsx
// app/admin/semanas/weeks-view.tsx, SettlementRow(), línea ~713-718 — HOY ES SOLO LECTURA
<div>
  <span className="text-zinc-500 text-xs">Mantenimiento </span>
  <span className="text-white text-xs">
    {s.mantenimiento_met ? `Sí (+${formatARS(s.bonus_mantenimiento)})` : 'No'}
  </span>
</div>
```
Comparar con **Presentismo**, que sí es un toggle interactivo (línea ~696-712) y es el patrón a clonar:
```tsx
{canEdit ? (
  <button onClick={() => onPresentismo(s, !s.presentismo_met)} className={...}>
    {s.presentismo_met ? 'Sí ✓' : 'No'}
  </button>
) : (
  <span className="text-white text-xs">{s.presentismo_met ? 'Sí' : 'No'}</span>
)}
```
`canEdit = weekStatus === 'closed' && s.status === 'draft'` (línea ~627). La función que persiste: `setPresentismo()` en `lib/supabase/supabase.client.ts:1563-1577` — update directo a `settlements` + recálculo vía RPC `calculateSettlement()`.

Columnas ya existentes en `settlements` (`database.types.ts` línea ~162-215) que se reutilizan sin cambios de schema: `mantenimiento_met: boolean | null`, `bonus_mantenimiento`, `mantenimiento_rate_snap`, `mantenimiento_min_cuts_snap`, `bonus_mantenimiento_override`.

> ✅ **Confirmado:** Liquidaciones se renderiza en un único archivo (`weeks-view.tsx`) — no hay lógica duplicada que sincronizar en `admin-dashboard.tsx`. Los cambios de este plan se aplican en un solo lugar.

## 🎯 OBJETIVO

1. Nueva sección **"Mantenimiento"** en el mobile del barbero: ve sus tareas de la semana (las que le asignó el admin, PLAN_05), las tilda, se guarda por semana.
2. En Liquidaciones, el toggle **"Mantenimiento"** (campo `mantenimiento_met` ya existente) se **bloquea** si al barbero le falta alguna tarea sin tildar esa semana — con tooltip explicando cuáles. Recién con el checklist 100% completo se habilita para que el admin lo marque Sí/No manualmente (mismo mecanismo de bono que ya existe).

## 🛠️ IMPLEMENTACIÓN

### Paso 1: Query de estado del checklist por barbero/semana

Nueva función en `lib/supabase/supabase.client.ts`:
```ts
export async function getMaintenanceChecklistStatus(barberId: string, weekId: string): Promise<{
  sheetExists: boolean
  total: number
  done: number
  pendingDescriptions: string[]
}> {
  // join maintenance_sheets (week_id) -> maintenance_sheet_items (barber_id, done, description via task)
  // sheetExists=false si el admin todavía no creó la planilla de esa semana
}
```
Esta función la consumen **dos** lugares: la vista mobile (para pintar el checklist) y Liquidaciones (para decidir si el toggle está bloqueado).

### Paso 2: RLS para que el barbero lea/edite solo sus propios items

Nueva migración `supabase/migrations/04X_maintenance_barber_rls.sql`:
- Policy `select` en `maintenance_sheet_items` para `role = 'barber'`: solo filas donde `barber_id = current_user_id()` (o el helper equivalente ya usado en otras policies del proyecto, ver `current_admin_has_branch()` como referencia de estilo).
- Policy `update` acotada: el barbero solo puede cambiar `done`, no `barber_id` ni `description` (evitar que se reasigne tareas a sí mismo).
- Función `setMaintenanceItemDone()` ya existe del lado admin (`supabase.client.ts` ~2295-2545) — confirmar si sirve tal cual para el barbero o si hace falta una versión acotada por RLS únicamente (sin lógica nueva en el cliente, la restricción va en la policy).

### Paso 3: Nueva vista mobile

En `barber-mobile-view.tsx`:
```tsx
type View = 'home' | 'register' | 'success' | 'settlements' | 'maintenance'
```
- Agregar `if (view === 'maintenance') return (...)` con el mismo layout header (`IconBack` + título + `flex-1 overflow-y-auto`) que las demás vistas.
- Carga lazy (mismo patrón que `goToSettlements()`, línea ~242-264): solo al entrar por primera vez, usando `getMaintenanceChecklistStatus()` + el detalle de items para poder tildarlos.
- Checkbox por tarea → `setMaintenanceItemDone(itemId, done)`, actualización optimista de estado local + confirmación server.
- Entrada nueva en `BarberSideDrawer` (prop `onViewMaintenance`) y card en HOME junto a "Liquidaciones"/"Pedir adelanto" (línea ~1553-1576).

### Paso 4: Gate en Liquidaciones

En `weeks-view.tsx` (y en `admin-dashboard.tsx` si aplica, ver advertencia arriba), clonar el patrón de Presentismo para Mantenimiento:

```tsx
const maintenanceStatus = useMaintenanceChecklistStatus(s.barber_id, s.week_id) // hook que envuelve el paso 1
const maintenanceCanEdit = canEdit && maintenanceStatus.sheetExists && maintenanceStatus.done === maintenanceStatus.total

{maintenanceCanEdit ? (
  <button onClick={() => onMantenimiento(s, !s.mantenimiento_met)} className={...}>
    {s.mantenimiento_met ? 'Sí ✓' : 'No'}
  </button>
) : (
  <span
    className="text-zinc-500 text-xs cursor-not-allowed"
    title={
      !maintenanceStatus.sheetExists
        ? 'El admin todavía no creó la planilla de mantenimiento de esta semana'
        : `Faltan ${maintenanceStatus.total - maintenanceStatus.done} tarea(s): ${maintenanceStatus.pendingDescriptions.join(', ')}`
    }
  >
    {s.mantenimiento_met ? 'Sí' : 'Bloqueado'}
  </span>
)}
```
- `onMantenimiento()` → nueva función `setMantenimientoMet()` en `supabase.client.ts`, clon de `setPresentismo()` (update + `calculateSettlement()`).
- **No romper** el flujo actual de `bonus_mantenimiento`/`mantenimiento_rate_snap` — el cálculo del monto del bono sigue igual, solo cambia qué habilita el botón.

## 📝 ARCHIVOS A MODIFICAR / CREAR

1. **Crear** `supabase/migrations/04X_maintenance_barber_rls.sql`
2. **Modificar** `lib/supabase/supabase.client.ts` — `getMaintenanceChecklistStatus()`, `setMantenimientoMet()`
3. **Modificar** `app/barber/barber-mobile-view.tsx` — vista `maintenance`
4. **Modificar** `app/components/barber-side-drawer.tsx` — entrada nueva
5. **Modificar** `app/admin/semanas/weeks-view.tsx` (y `admin-dashboard.tsx` si corresponde, ver verificación previa) — toggle gateado + tooltip

## ⚠️ RIESGOS

- No confundir con PLAN_05: ahí se resuelve el modelo de datos de las tareas; acá se consume ese modelo. Si PLAN_05 no está deployado, `barber_id` en `maintenance_sheet_items` puede no reflejar reasignaciones hechas por dropdown.
- El barbero no debe poder marcar `done` en tareas de otro barbero ni en semanas ya cerradas/pagadas — cubrir con RLS, no solo con UI (la UI se puede saltear).

## ✅ CHECKLIST

- [ ] RLS probada: un barbero no puede leer ni marcar tareas de otro barbero
- [ ] Checklist mobile funciona y persiste por semana
- [ ] Toggle de Mantenimiento en Liquidaciones bloqueado con tooltip correcto cuando falta algo
- [ ] Toggle se habilita apenas se completa el checklist, sin necesidad de recargar la página (realtime o refetch tras el último tilde)
- [ ] El bono `bonus_mantenimiento` se sigue calculando igual que antes

## 🎯 BENEFICIOS

✅ El barbero tiene trazabilidad de sus tareas de limpieza semana a semana
✅ El admin ya no puede aprobar el bono de mantenimiento "de memoria" sin que las tareas estén realmente hechas
✅ Reusa el mecanismo de bono ya existente — no rompe la lógica de liquidación
