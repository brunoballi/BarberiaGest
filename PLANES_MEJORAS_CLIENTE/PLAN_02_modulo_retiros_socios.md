# PLAN 02: Módulo "Retiros Socios" propio (sale de Gastos)

> **✅ IMPLEMENTADO** (rama `feat/modulo-gastos`). Diferencias y hallazgos respecto de lo planificado:
>
> 1. **El módulo es MENSUAL** (igual que Gastos tras el cambio pedido por el cliente), no semanal.
> 2. **`update_expense` era un RPC con firma fija y hubo que recrearlo.** `createExpense` hace `insert` directo (no usa el RPC `create_expense`), así que alcanzaba con sumar `partner_id` al payload; pero editar sí pasa por el RPC. Se dropeó y recreó con `p_partner_id` — usando `drop function` primero, porque agregar un parámetro cambia la firma y `create or replace` habría dejado **dos sobrecargas conviviendo**, con PostgREST sin saber cuál invocar. Verificado post-migración: queda una sola firma.
> 3. **La función real en la base NO coincidía con `010_expense_crud.sql` del repo** (drift ya documentado). La real usa `coalesce(p_x, x)` —semántica de patch— y tiene un guard de permisos que el archivo del repo no tiene. La migración 044 se escribió sobre la versión **real**, no sobre la del repo.
> 4. **Hizo falta una migración extra (045) por RLS.** El selector de socios salía con un solo nombre: la única policy de SELECT sobre `admin_branches` era `admin_branches_self_read` (`admin_id = auth.uid()`), o sea que cada admin veía únicamente su propia fila. Se agregó `admin_branches_admin_read` para que un admin pueda leer el mapeo admin→sucursal completo. No agrega exposición real (un admin ya podía leer todos los `profiles` vía `admin_all_profiles`, y `/admin/admins` ya muestra esa info).
> 5. **`ExpenseFormModal` quedó compartido** entre los dos módulos, con props `fixedCategory` (oculta el selector de categoría) y `partners` (muestra el selector de socio, obligatorio). La categoría `retiro_socio` se sacó del selector y del filtro de Gastos.
>
> **Verificado en local:** alta con socio, edición cambiando socio y monto (ejercita el RPC nuevo), categoría preservada tras el update, `week_id` derivado de la fecha, los retiros no aparecen en Gastos, y —lo más importante— `month_financials()` sigue excluyendo `retiro_socio`: con $500.000 de alquiler + $250.000 de retiro en el mes, `total_expenses` devolvió 500000.

**Depende de:** PLAN_01 (necesita que exista el patrón de módulo `/admin/gastos` ya separado del dashboard, para no tocar dos cosas a la vez).

## 📋 ESTADO ACTUAL

"Retiro de socios" **no es una tabla propia** — es un valor más de la categoría de `expenses`:

```ts
// lib/supabase/database.types.ts línea ~494-519
export const EXPENSE_CATEGORIES = ['alquiler','servicios','personal','insumos','marketing',
  'impuestos','retiro_socio','inversion','otros'] as const
export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory,string> = {
  ..., retiro_socio: 'Retiro de socios', ...
}
```

La columna `category` en la tabla `expenses` es `text` libre (sin `CHECK` ni enum en SQL, `supabase/migrations/001_initial_schema.sql` línea ~171-183) — el enum vive solo en TypeScript.

**Dato clave de historial:** en `PLAN_4_MEJORAS.md` (ya implementado) se evaluó explícitamente crear una tabla `partner_withdrawals` separada y **se descartó a favor de seguir usando `expenses.category='retiro_socio'`**. Este plan respeta esa decisión — no se crea tabla nueva.

**Acoplamiento crítico a no romper:** la función SQL `month_financials()` (`supabase/migrations/017_month_financials.sql`, redefinida en `022_capital_injections.sql`) **excluye explícitamente** `retiro_socio` del cálculo de gastos totales:
```sql
select coalesce(sum(e.amount) filter (where e.category is distinct from 'retiro_socio'), 0)::float8 as total_expenses
```
Si el "Ganancia neta"/"Saldo del mes" de Reportes deja de calcular bien, **es acá**.

## 🎯 OBJETIVO

Retiros de Socios pasa a tener pantalla propia `/admin/retiros-socios`, con su propio alta/listado, **sin crear tabla nueva** — sigue siendo `expenses` con `category='retiro_socio'`, filtrado en el query, usando los mismos RPC `create_expense`/`update_expense`/`delete_expense` ya existentes.

## 🛠️ IMPLEMENTACIÓN

### Paso 1: Página nueva, filtro por categoría fija

`app/admin/retiros-socios/page.tsx` (mismo patrón server-guard que el resto) → `app/admin/retiros-socios/retiros-socios-view.tsx`:

```ts
// Reusa getExpensesByBranchAndMonth() (o el fetch que ya use gastos-view.tsx tras PLAN_01)
// pero filtrado: category === 'retiro_socio', y con su propio formulario
// (monto, fecha, socio/responsable, motivo) usando create_expense con category fijo:
const payload: ExpenseInsert = {
  ...formValues,
  category: 'retiro_socio', // fijo, no editable por el usuario en este módulo
}
```

- El formulario de este módulo **no muestra el selector de categoría** (a diferencia de `ExpenseFormModal` genérico) porque la categoría siempre es `retiro_socio` — es un caso particular de "gasto", igual que el módulo de Adelantos es un caso particular reusando la tabla `advances`.

### ✅ Decisión: cómo identificar al socio (sin ensuciar el modelo)

La forma más simple es **no crear ninguna tabla nueva de "socios"** — en este sistema los socios ya existen como datos: son los `profiles` con `role='admin'` (los dueños/administradores de la barbería, ya usados en `admins-view.tsx` y en la relación `admin_branches`). Reusar esa identidad evita duplicar personas en dos lugares distintos del sistema.

```sql
alter table expenses add column partner_id uuid references profiles(id);
-- nullable, solo se completa cuando category = 'retiro_socio'
```

En el formulario de `retiros-socios-view.tsx`, un `<select>` de "Socio" poblado con los admins de esa sucursal (mismo query que ya usa `admins-view.tsx`), en vez de texto libre. Al guardar:
```ts
const payload: ExpenseInsert = {
  ...formValues,
  category: 'retiro_socio',
  partner_id: selectedPartnerId, // uuid de profiles
}
```
Para mostrar el nombre en listados/reportes se usa el mismo patrón de join que ya se usa en todo el proyecto para barberos: `partner:profiles!partner_id(full_name)`.

> **Asunción documentada:** esto asume que todo socio que retira plata tiene (o va a tener) una cuenta de admin en el sistema. Si en algún momento hay un socio sin cuenta (inversor que no usa el software), esta columna quedaría en blanco para esos casos — avisar si eso llega a pasar, ahí sí haría falta una tabla liviana de socios sin login.

### Paso 2: Sacar "Retiro de socios" del listado/filtro de Gastos

En `app/admin/gastos/gastos-view.tsx` (creado en PLAN_01): filtrar `category !== 'retiro_socio'` en la grilla y sacar esa opción del `<select>` de categoría del `ExpenseFormModal` **cuando se abre desde Gastos** (para que un admin no cargue un retiro de socio por el lugar equivocado). El RPC sigue aceptando cualquier categoría — el filtro es solo de UI.

### Paso 3: Menú lateral

Agregar en `admin-side-drawer.tsx`, junto a "Gastos":
```tsx
<Link href="/admin/retiros-socios" onClick={onClose} className="drawer-item ...">🏦 Retiros Socios</Link>
```

## 📝 ARCHIVOS A MODIFICAR / CREAR

1. **Crear** `app/admin/retiros-socios/page.tsx`
2. **Crear** `app/admin/retiros-socios/retiros-socios-view.tsx`
3. **Modificar** `app/admin/gastos/gastos-view.tsx` — excluir `retiro_socio` del listado y del selector de categorías
4. **Modificar** `app/components/admin-side-drawer.tsx` — agregar link
5. **Crear** migración `0XX_expenses_partner_id.sql` — agrega `expenses.partner_id uuid references profiles(id)`

## ⚠️ NO TOCAR

- `month_financials()` — sigue excluyendo `category='retiro_socio'` exactamente igual, porque el dato sigue siendo una fila de `expenses` con esa categoría. **No renombrar la categoría ni moverla de tabla**, o hay que reescribir esa función SQL y revalidar Reportes completo.
- RPCs `create_expense`/`update_expense`/`delete_expense` — se siguen usando tal cual.

## ✅ CHECKLIST

- [ ] Migración `partner_id` aplicada y probada en local antes de prod
- [ ] Página `/admin/retiros-socios` permite alta/listado/edición, con selector de socio (no texto libre)
- [ ] Gastos ya no muestra filas de `retiro_socio` en su grilla
- [ ] `month_financials()` sigue devolviendo el mismo "Saldo del mes" que antes (regresión más importante a validar)
- [ ] Link en menú lateral

## 🎯 BENEFICIOS

✅ Los socios pueden ver sus propios retiros sin mezclarse con gastos operativos
✅ Prepara el desglose por socio en Reportes (PLAN_03)
✅ Cero riesgo sobre el cálculo financiero existente (mismo modelo de datos)
