# PLAN 01: Módulo "Gastos" propio (sale del tab del Dashboard)

> **✅ IMPLEMENTADO** (rama `feat/modulo-gastos`), con dos cambios respecto de lo planificado originalmente:
>
> 1. **El módulo es MENSUAL, no semanal.** El plan asumía heredar el `week_id` del tab viejo. Al implementarlo se verificó que `month_financials()` —la función que calcula ganancia neta y saldo del mes— suma los gastos **por `expense_date`, no por `week_id`**. O sea que la vista semanal estaba desalineada con el cálculo financiero real del sistema. El módulo usa ahora el mismo navegador de mes que Reportes (`MONTH_NAMES[month-1] + year`, flechas ‹ ›, mes siguiente deshabilitado en el mes actual) y consulta con `getExpensesByDateRange(branchId, from, to)`.
> 2. **El `week_id` se sigue guardando, pero derivado de la fecha del gasto** (no de una semana elegida a mano). Esto corrige un bug latente del tab viejo: si el admin estaba parado en una semana y cargaba un gasto con fecha de otra, el gasto quedaba asignado a la semana equivocada.
>
> También se adelantó parte de **PLAN_04**: la KPI card "Retiros socios" ya fue eliminada del tab Liquidaciones (junto con `kpis.partnerWithdrawals`, `operationalExpenses` y `expensesTotal`, que quedaron sin uso). La card "Devuelto x barberos" **sigue en su lugar**.

## 📋 ESTADO ACTUAL

Gastos hoy **no es una página**, es un tab dentro de `app/admin/admin-dashboard.tsx`:

```typescript
// admin-dashboard.tsx línea ~176-184
type Tab = 'live' | 'liquidaciones' | 'transacciones' | 'gastos' | 'saldo' | 'adelantos'
const TAB_LABELS: Record<Tab, string> = {
  live: '🔴 En vivo', liquidaciones: 'Liquidaciones', transacciones: 'Transacciones',
  gastos: 'Gastos', saldo: '💵 Saldo inicial', adelantos: '💰 Adelantos',
}
```

- Grilla + filtros del tab Gastos: `admin-dashboard.tsx` líneas ~1947-2106.
- Modal de alta/edición `ExpenseFormModal`: definido **inline** en el mismo archivo, líneas ~2311-2440 (no es un componente separado).
- Carga de datos: dentro de `loadTabData()` (switch por tab, líneas ~403-430).
- CRUD: RPCs genéricos `create_expense` / `update_expense` / `delete_expense` (`supabase/migrations/010_expense_crud.sql`), ya funcionando — **no se tocan**.
- El menú lateral (`app/components/admin-side-drawer.tsx`) hoy tiene: Registrar corte, Reportes, y el submenu "Configuración" con Calendario / Barberos / Servicios / Beneficios / Mantenimiento / Auditoría / Administradores. **No existe `/admin/gastos` como ruta.**

## 🎯 OBJETIVO

Gastos pasa a ser un módulo con ruta propia `/admin/gastos`, accesible desde el menú lateral (mismo nivel que Reportes/Configuración), y **deja de ser un tab** del Dashboard.

## ⚠️ Riesgo a tener en cuenta (no se resuelve en este plan, ver PLAN_04)

El tab `liquidaciones` del Dashboard muestra hoy una KPI card **"Retiros socios"** que lee del mismo array `expenses` que carga el tab Gastos (`expenses.filter(e => e.category === 'retiro_socio')`, línea ~849). Si en este plan se saca la carga de `expenses` de `loadTabData()` porque "ya no hace falta cargarla para el tab gastos", esa KPI se rompe. **No tocar esa carga acá** — se resuelve recién en PLAN_04 cuando se saquen las KPI cards. Hasta entonces, `expenses` se sigue cargando igual (la sigue necesitando el tab `liquidaciones`), solo cambia **dónde se renderiza**.

## 🛠️ IMPLEMENTACIÓN

### Paso 1: Crear la página y mover el componente

1. Crear `app/admin/gastos/page.tsx` (server component, mismo patrón que el resto de `/admin/*`):
   ```tsx
   import { redirect } from 'next/navigation'
   import { getServerProfile } from '@/lib/supabase/server'
   import GastosView from './gastos-view'

   export default async function GastosPage() {
     const profile = await getServerProfile()
     if (!profile) redirect('/login')
     if (profile.role !== 'admin') redirect('/barber')
     return <GastosView />
   }
   ```
2. Crear `app/admin/gastos/gastos-view.tsx` como componente **cliente** nuevo, extrayendo:
   - El estado y funciones de Gastos que hoy viven en `admin-dashboard.tsx` (filtros, `ExpenseFormModal`, handlers de alta/edición/borrado).
   - Carga propia de datos vía `getCurrentProfile()` + `getMyBranchesCached()` + fetch de `expenses` (mismo patrón que `advances-view.tsx`, que ya quedó como página standalone tras el PLAN de Adelantos).
3. Extraer `ExpenseFormModal` a su propio archivo `app/components/expense-form-modal.tsx` (hoy está inline) para poder importarlo tanto desde `gastos-view.tsx` como desde `admin-dashboard.tsx` (el tab `liquidaciones` puede seguir necesitando dar de alta un gasto rápido — confirmar con el cliente si ese acceso rápido se mantiene o no antes de borrar el modal del dashboard).

### Paso 2: Sacar el tab del Dashboard

En `admin-dashboard.tsx`:
```typescript
// ANTES
type Tab = 'live' | 'liquidaciones' | 'transacciones' | 'gastos' | 'saldo' | 'adelantos'
// DESPUÉS
type Tab = 'live' | 'liquidaciones' | 'transacciones' | 'saldo' | 'adelantos'
```
- Sacar `gastos` de `TAB_LABELS` y del array de tabs renderizados (línea ~990).
- Sacar el `case`/bloque `{tab === 'gastos' && (...)}` del render (líneas ~1947-2106).
- Sacar `else if (tab === 'gastos')` de `loadTabData()` — **pero mantener la carga de `expenses`** en el `else if (tab === 'liquidaciones')` (ver advertencia arriba).

### Paso 3: Agregar el ítem al menú lateral

En `app/components/admin-side-drawer.tsx`, agregar junto a "Reportes" (no dentro del submenu "Configuración", ya que Gastos es un módulo operativo, no una configuración):
```tsx
<Link href="/admin/gastos" onClick={onClose} className="drawer-item ...">💸 Gastos</Link>
```

## 📝 ARCHIVOS A MODIFICAR / CREAR

1. **Crear** `app/admin/gastos/page.tsx`
2. **Crear** `app/admin/gastos/gastos-view.tsx`
3. **Crear** `app/components/expense-form-modal.tsx` (extraído del inline actual)
4. **Modificar** `app/admin/admin-dashboard.tsx` — sacar tab `gastos`, mantener carga de `expenses` para el KPI de Liquidaciones
5. **Modificar** `app/components/admin-side-drawer.tsx` — agregar link "Gastos"

## ✅ CHECKLIST

- [ ] Página `/admin/gastos` funciona igual que el tab viejo (alta, edición, borrado, filtros)
- [ ] El KPI "Retiros socios" del tab Liquidaciones sigue mostrando el mismo número que antes (no se rompió la carga de `expenses`)
- [ ] El tab `gastos` ya no aparece en el Dashboard
- [ ] El link "Gastos" aparece en el menú lateral
- [ ] `EXPENSE_CATEGORY_LABELS` sigue centralizado — no duplicar el mapeo de labels en `gastos-view.tsx` (ya existe una copia duplicada en `reportes-view.tsx`, no sumar una tercera)

## 🎯 BENEFICIOS

✅ Libera espacio en la barra de tabs del Dashboard
✅ Gastos pasa a tener URL propia, se puede linkear/bookmarkear
✅ Prepara el terreno para PLAN_02 (retiros de socios sale de este mismo módulo)
