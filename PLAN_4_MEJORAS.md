# Plan: 7 Mejoras al Sistema de Gestión de Barberías

## Context

El sistema requiere 4 mejoras operacionales para refinar el flujo de:
1. **Descuentos → Beneficios**: Modelo actual (descuentos manuales) → modelo de beneficios predefinidos por admin
2. **Semanas martes-sábado**: Reflejar las horas reales de negocio (martes a sábado, no lunes a domingo)
3. **Configuración de transferencias**: Permitir que cada barbero configure si recibe transferencias o todo va a Valhalla
4. **Retiros de socios**: Separar retiros de socios de "gastos" y reportarlos por separado

---

## 1. Descuentos → Beneficios (Parámetro Admin) ✅ COMPLETADA

> Verificado: tabla `benefits` + RLS en prod, CRUD en `supabase.client` (getBenefitsByBranch,
> createBenefit, updateBenefit, computeBenefitDiscount), página `/admin/beneficios` (con link
> en el nav), dropdown en manual-cut-modal y en la vista del barbero, `registerCut` guarda `benefit_id`.

### Objetivo
Reemplazar campo manual `discount_amount` + `discount_reason` por un sistema de **beneficios predefinidos**. El admin configura beneficios en las sucursales; barberos/admin seleccionan de un dropdown al registrar cortes.

### Cambios en Base de Datos

**1.1 Nueva tabla `benefits`:**
```sql
CREATE TABLE public.benefits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES public.branches(id),
  name TEXT NOT NULL,          -- "Corte para jubilados", "Happy hour", etc.
  description TEXT,
  discount_type TEXT NOT NULL, -- 'fixed' (monto fijo) | 'percentage' (%)
  discount_value NUMERIC(10,2) NOT NULL, -- $ o %
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT now(),
  UNIQUE(branch_id, name)
);
```

**1.2 Migración SQL:**
- Agregar tabla `benefits`
- Reemplazar `discount_amount`, `discount_reason` en tabla `transactions` con `benefit_id UUID` (foreign key a benefits)
- Deprecar/mantener las columnas antiguas por retrocompatibilidad (migration con `IF NOT EXISTS`)

### Cambios en Frontend

**1.3 Manual-cut-modal.tsx:**
- Remover inputs de `discount_amount` + `discount_reason`
- Agregar **dropdown de beneficios** (SELECT con búsqueda)
- Cargar beneficios desde `supabase.client.ts` → función `getBenefitsByBranch(branchId)`
- El cálculo de `barber_share` + `branch_share` sigue igual (50/50 en descuentos)

**1.4 Barber-mobile-view.tsx:**
- Agregar **dropdown de beneficios** igual que en admin (barbero selecciona al cargar)
- Mostrar monto ahorrado: "Ahorras $X con este beneficio" antes de confirmar
- Beneficio es **opcional** (puede dejar sin beneficio)
- Al confirmar, guarda `benefit_id` en la transacción

**1.5 Admin-dashboard.tsx:**
- Nueva sección: **Beneficios por sucursal** (CRUD)
  - Tabla con: Nombre, Tipo (fijo/%), Monto, Activo/Inactivo
  - Botones: Agregar, Editar, Desactivar
  - Función `createBenefit()`, `updateBenefit()`, `deleteBenefit()` en supabase.client.ts

### Verificación
- ✅ Crear sucursal con 2-3 beneficios predefinidos
- ✅ Registrar corte con beneficio → validar cálculo 50/50
- ✅ Dashboard muestra beneficios activos/inactivos
- ✅ Reportes seguen incluyendo descuentos en resumen

---

## 2. Semanas: Martes a Sábado ✅ COMPLETADA (2026-05-30)

> **Enfoque real (no cambia la generación de semanas):** verificado en prod que TODAS
> las semanas son lunes→domingo (7 días) y los datos cargados ya son mar-sáb. En vez de
> migrar rangos (destructivo), se restringe a nivel de día en la vista del barbero:
> - Barbero: solo carga mar(2)–sáb(6). Dom/lun grisados y bloqueados (`isBarberAllowedDay`,
>   bloqueo en botón + `handleSubmit`).
> - Admin: sin límite (carga cualquier día vía manual-cut).
> - Override: nueva columna `weeks.barber_extra_days date[]` (migración 004, aplicada).
>   El admin habilita un dom/lun puntual desde el detalle de la semana en weeks-view
>   (`updateBarberExtraDays`); el barbero respeta esas fechas.
>
> **NO** se cambió `generateWeekRangesForMonth`, el RPC de año, ni el cron.

### Objetivo (propuesta original — descartada por destructiva)
Cambiar rango de semana de **lunes-domingo (7 días)** a **martes-sábado (6 días)**. Los barberos solo pueden cargar martes-sábado; admin puede cargar lunes/domingo si es necesario.

### Cambios en Base de Datos

**2.1 Tabla `weeks` (agregar configuración):**
```sql
ALTER TABLE public.weeks ADD COLUMN IF NOT EXISTS
  start_day_of_week SMALLINT DEFAULT 2; -- 0=Dom, 1=Lun, 2=Mar, ... (martes)
```

**2.2 CHECK constraint:**
```sql
ALTER TABLE public.weeks
ADD CONSTRAINT valid_week_range CHECK (
  EXTRACT(DOW FROM start_date) = start_day_of_week
  AND (end_date - start_date) = 5  -- exactamente 6 días (0-5)
);
```

### Cambios en Frontend

**2.3 Supabase.client.ts - `generateWeekRangesForMonth()`:**
- Cambiar lógica de retroceso:
  - **Antes**: `daysBack = (dow === 0 ? 6 : dow - 1)` (retrocede a lunes)
  - **Después**: `daysBack = (dow === 0 ? 4 : dow + (2 - dow) % 7)` (retrocede a martes)
- Generar increments de **6 días** (no 7)
- Ejemplo: Enero 2025 → semana 1: mar 31/12/2024 - sáb 04/01/2025

**2.4 Barber-mobile-view.tsx - Grilla de días:**
- Cambiar `Array.from({ length: 7 })` → `Array.from({ length: 6 })`
- Etiquetas: `['Mar', 'Mié', 'Jue', 'Vie', 'Sáb']` (quitar lun y dom)
- Validación: Si barbero intenta cargar **fuera de martes-sábado** → error
  ```typescript
  if (!isValidDayForBarber(selectedDate, week)) {
    return "Solo puedes cargar cortes martes a sábado. "
           "Contacta al admin para lunes/domingo."
  }
  ```

**2.5 Weeks-view.tsx (admin):**
- Validación al crear semana: `start_date` **debe ser martes**
- Mostrar rango como "mar 31 - sáb 04" (no "lun 30 - dom 05")
- Permitir override admin: checkbox "Permitir cortes lunes/domingo en esta semana"

**2.6 Calendario en home:**
- Actualizar help text: "Semana de martes a sábado" (en lugar de "lunes a domingo")
- Mostrar puntos/circulitos solo martes-sábado (no incluir lun/dom)

### Verificación
- ✅ Generar mes y validar semanas comienzan martes
- ✅ Barbero intenta cargar lunes → bloquea con error
- ✅ Admin puede cargar lunes/domingo si lo permite
- ✅ Calendario muestra martes-sábado en detalle de semana

---

## 3. Configuración de Transferencias por Barbero ✅ COMPLETADA

> Verificado: columna `profiles.receives_transfers` (migración 003, aplicada), checkbox en
> edición de barbero (barbers-abm), badge "Transf → Valhalla", y `registerCut` respeta el flag
> en el split de pago.

### Objetivo
Cada barbero configura si recibe transferencias en su cuenta (sí/no). Si no, todo va a Valhalla.

### Cambios en Base de Datos

**3.1 Tabla `profiles` (agregar campo):**
```sql
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS
  receives_transfers BOOLEAN DEFAULT true; -- true = recibe en su cuenta
```

### Cambios en Frontend

**3.2 Admin-dashboard.tsx - Sección Barberos:**
- En modal de **Editar barbero**, agregar checkbox:
  ```
  ☐ Recibe transferencias en su cuenta
  ```
- Si unchecked → todo se acumula en cuenta Valhalla
- Actualizar `updateBarber()` para incluir este flag

**3.3 Supabase.client.ts - Liquidación:**
- En `calculateSettlement()`, validar en CADA transacción:
  ```typescript
  if (!barber.receives_transfers) {
    transfer_amount = 0
    branch_receives_transfer = barber_transfer_amount
  }
  ```
- **IMPORTANTE**: Si admin cambia `receives_transfers` de true → false:
  - Recalcular liquidaciones **previas no cerradas** (status='open' o 'closed')
  - Actualizar `settlements.transfer_amount`, `net_payable` para esas semanas
  - Transacciones ya cerradas (`status='paid'`) se respetan (no modificar)

**3.4 Admin-dashboard.tsx - Reportes/Liquidaciones:**
- Mostrar nota si barbero no recibe transfers: ⚠️ "Transferencias → Valhalla"

### Verificación
- ✅ Crear barbero con transfers = false
- ✅ Registrar transacción con transfer → validar va a Valhalla
- ✅ Liquidación muestra nota

---

## 4. Retiros de Socios (Separar de Gastos) ✅ COMPLETADA (vía categoría)

> Verificado: categoría `retiro_socio` en EXPENSE_CATEGORIES; `getReportByPeriod` calcula
> `partnerWithdrawals` por separado y NO lo resta de `netProfit` (netProfit = branchShare -
> totalExpenses, excluyendo retiros); reportes-view muestra filas "Retiros de socios". Se
> registra como gasto con esa categoría (no se usó tabla `partner_withdrawals` separada).

### Objetivo
Crear categoría/tabla separada para retiros de socios. Impacte en reportes de forma diferenciada (no restar de ganancia, sino mostrar aparte).

### Cambios en Base de Datos

**4.1 Nueva tabla `partner_withdrawals` (alternativa a categoría):**
```sql
CREATE TABLE public.partner_withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES public.branches(id),
  partner_id UUID NOT NULL REFERENCES public.profiles(id),
  amount NUMERIC(12,2) NOT NULL,
  withdrawal_date DATE NOT NULL,
  reason TEXT,
  week_id UUID REFERENCES public.weeks(id),
  created_at TIMESTAMP DEFAULT now()
);
```

**Alternativa (SIN tabla nueva):** Mantener `expenses.category = 'retiro_socio'` pero agregar flag:
```sql
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS
  is_withdrawal_not_expense BOOLEAN DEFAULT false;
```

**Decisión:** Usar tabla separada (más limpio) pero mantener categoría en expenses para retrocompatibilidad.

### Cambios en Frontend

**4.2 Admin-dashboard.tsx - Sección Retiros:**
- Crear **nueva sección "Retiros de Socios"** (no en gastos)
- Tabla: Socio, Monto, Fecha, Motivo
- Botones: Agregar, Editar, Eliminar
- **Permisos**: Solo visible/editable para admins de esa sucursal
  - Función `canManageWithdrawals()` valida `isAdmin && branch_id match`
- Función `createWithdrawal()`, `deleteWithdrawal()` en supabase.client.ts
  - Validar en BD que `created_by` sea admin de la `branch_id`

**4.3 Reportes (reportes-view.tsx):**
- Agregar sección **"Retiros de Socios"** en BranchReport:
  ```
  Retiros de Socios: $X.XX
  - Socio A: $Y
  - Socio B: $Z
  ```
- **NO restar** de netProfit (mostrar aparte)
- Cálculo: `netProfit = branchShare - totalExpenses` (sin contar retiros)

**4.4 Sincronizar labels (reportes-view.tsx):**
```typescript
// Actualizar EXPENSE_LABELS:
const EXPENSE_LABELS: Record<ExpenseCategory, string> = {
  alquiler: 'Alquiler',
  servicios: 'Servicios',
  personal: 'Personal',
  insumos: 'Insumos',       // ← AGREGAR
  marketing: 'Marketing',
  impuestos: 'Impuestos',
  retiro_socio: 'Retiro de Socios',  // ← YA EXISTE, SINCRONIZAR
  otros: 'Otros'
}
```

### Verificación
- ✅ Crear retiro de socio → aparece en sección separada
- ✅ Reporte muestra retiros sin restar de ganancia
- ✅ Labels sincronizados en reportes

---

## 5. Home — Mantener Fecha Actual

### Objetivo
Cuando el usuario navega por módulos (barberos, gastos, reportes, etc.) y vuelve al home, debe abrir siempre **el mes actual**, no volver a enero o a una fecha fija.

### Cambios en Base de Datos
**Sin cambios en BD** - es puramente de frontend/estado

### Cambios en Frontend

**5.1 Contexto Global de Mes (nuevo):**
- Crear `MonthContext` o usar Zustand para almacenar mes/año seleccionado
- Persistir en `localStorage` bajo clave `selected_month`
- Actualizar cada vez que usuario selecciona un mes diferente

**5.2 Home (barber-mobile-view.tsx / home-view.tsx):**
```typescript
useEffect(() => {
  // En primer render, si NO hay mes guardado → usar mes actual
  if (!localStorage.getItem('selected_month')) {
    const today = new Date()
    setSelectedMonth({
      year: today.getFullYear(),
      month: today.getMonth() // 0-11
    })
  } else {
    // Cargar mes guardado
    const saved = JSON.parse(localStorage.getItem('selected_month'))
    setSelectedMonth(saved)
  }
}, [])
```

**5.3 Navegación:**
- Al volver del módulo Barberos/Gastos/Reportes → `useEffect` verifica `localStorage`
- Si el mes guardado es muy antiguo (> 2 meses) → resetear a mes actual
- Help text: "Mes actual: [nombre mes año]"

### Verificación
- ✅ Abrir home → muestra mes actual
- ✅ Ir a Reportes → cambiar a enero
- ✅ Volver a home → vuelve a mes actual
- ✅ Cerrar app y abrir → recuerda mes (si fue guardado)

---

## 6. Cerrar Semana por Barbero ✅ COMPLETADA (2026-05-30)

> **Enfoque elegido: reusar la liquidación existente (NO tabla nueva ni trigger).**
> Ya existe una liquidación por barbero (`settlements`, una por `week_id + barber_id`,
> estados `draft → confirmed → paid`). "Cerrar la semana de un barbero" = confirmar
> su liquidación (`confirmSettlement`, ya existe en el dashboard, tab Liquidaciones).
>
> **Bloqueo: solo el barbero** (el admin sigue pudiendo cargar/corregir cortes manuales).
>
> **Cambios aplicados:**
> - `supabase.client.ts`: `getSettlementStatusForWeek(weekId, barberId)` → estado o null.
> - `barber-mobile-view.tsx`: estado `weekClosed` (true si `confirmed`/`paid`); se carga
>   junto con las transacciones; bloquea botón "Registrar corte" + guard en `handleSubmit`
>   y `goToRegister`; muestra "Semana cerrada: tu liquidación ya fue confirmada".
> - **No se necesita** `week_barber_closures` ni el trigger DB propuestos abajo.

### Objetivo (propuesta original — descartada por redundante)
Nuevo flujo: Admin puede "cerrar" una semana de un barbero específico. Una semana cerrada no puede recibir más transacciones.

### Cambios en Base de Datos

**6.1 Nueva tabla `week_barbery_closure`:**
```sql
CREATE TABLE public.week_barber_closures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_id UUID NOT NULL REFERENCES public.weeks(id),
  barber_id UUID NOT NULL REFERENCES public.profiles(id),
  closed_at TIMESTAMP DEFAULT now(),
  closed_by UUID NOT NULL REFERENCES public.profiles(id), -- admin que cerró
  reason TEXT,
  UNIQUE(week_id, barber_id)
);
```

**6.2 Constraint en `transactions`:**
```sql
-- Trigger para prevenir insertar transacciones en semana cerrada
CREATE OR REPLACE FUNCTION prevent_closed_week_transaction()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM week_barber_closures
    WHERE week_id = NEW.week_id AND barber_id = NEW.barber_id
  ) THEN
    RAISE EXCEPTION 'Semana cerrada para este barbero';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER check_week_closure BEFORE INSERT ON transactions
FOR EACH ROW EXECUTE FUNCTION prevent_closed_week_transaction();
```

### Cambios en Frontend

**6.3 Admin-dashboard.tsx - Sección Semanas:**
- En tabla de semanas, agregar columna "Barberos" con estado:
  ```
  Juan: [cerrado] | María: [abierto] | Carlos: [cerrado]
  ```
- Botón por barbero: **"Cerrar semana"** (modal con confirmación)
- Modal muestra: Barbero, Semana, Motivo (opcional)
- Al confirmar → POST `/api/close-week-for-barber` con `week_id, barber_id, reason`

**6.4 Supabase.client.ts:**
```typescript
async function closeWeekForBarber(
  weekId: string,
  barberId: string,
  reason?: string
) {
  return await supabase
    .from('week_barber_closures')
    .insert({
      week_id: weekId,
      barber_id: barberId,
      closed_by: currentUser.id,
      reason
    })
}

async function isWeekClosedForBarber(weekId: string, barberId: string) {
  const { data } = await supabase
    .from('week_barber_closures')
    .select('id')
    .eq('week_id', weekId)
    .eq('barber_id', barberId)
    .single()
  return !!data
}
```

**6.5 Barber-mobile-view.tsx - Validación:**
- Antes de permitir registrar transacción:
```typescript
const isClosed = await isWeekClosedForBarber(weekId, barberId)
if (isClosed) {
  showError('Semana cerrada. Contacta al admin.')
  return
}
```

**6.6 Reportes (reportes-view.tsx):**
- Mostrar nota si semana de barbero está cerrada:
  ```
  ⚠️ Semana cerrada por [admin] el [fecha]. Motivo: [reason]
  ```

### Verificación
- ✅ Admin cierra semana de barbero → transacciones bloqueadas
- ✅ Barbero intenta cargar → error "semana cerrada"
- ✅ Reporte muestra nota de cierre
- ✅ Otra semana sigue abierta

---

## 7. Gastos — Auditoría (quién registró) ✅ COMPLETADA (2026-05-30)

> **Nota:** La infraestructura ya existía. La tabla `expenses` tiene `registered_by` (NOT NULL),
> `createExpense` ya lo guarda, y existe un sistema `audit_log` (trigger DB) + página
> `/admin/auditoria` con filtros y diffs para INSERT/UPDATE/DELETE de gastos.
> **NO se necesita** la tabla `expense_audit_logs` propuesta abajo (redundante).
>
> **Único cambio aplicado:** mostrar "Registrado por" en la lista de gastos:
> - `supabase.client.ts`: tipo `ExpenseWithUser` + `getExpensesByWeek` resuelve `full_name`.
> - `admin-dashboard.tsx`: columna "Registrado por" en la tabla de gastos.

### Objetivo
Agregar campo de auditoría en gastos: registrar **quién** (admin/usuario) creó/editó cada gasto, y **cuándo**.

### Cambios en Base de Datos

**7.1 Nueva tabla `expense_audit_logs`:**
```sql
CREATE TABLE public.expense_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id UUID NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  action TEXT NOT NULL, -- 'create' | 'update' | 'delete'
  changed_by UUID NOT NULL REFERENCES public.profiles(id),
  changed_at TIMESTAMP DEFAULT now(),
  previous_values JSONB, -- valores anteriores (para updates)
  new_values JSONB       -- nuevos valores
);
```

**Alternativa (más simple):** Agregar campos directamente en `expenses`:
```sql
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS
  created_by UUID REFERENCES public.profiles(id);

ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS
  updated_by UUID REFERENCES public.profiles(id);

ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS
  updated_at TIMESTAMP;
```

**Decisión:** Usar tabla separada (mejor auditoría) pero también mantener `created_by` en `expenses` para rapidez.

### Cambios en Frontend

**7.2 Admin-dashboard.tsx - Sección Gastos:**
- En tabla de gastos, agregar columnas:
  - **Registrado por**: nombre admin
  - **Fecha registro**: timestamp legible
  - **Última edición**: "por [admin], [fecha]" (tooltip con hora exacta)
- Modal de editar gasto → mostrar footer:
  ```
  Creado por: Juan (30/5/2026 14:30)
  Última edición: María (30/5/2026 15:45)
  ```

**7.3 Supabase.client.ts:**
```typescript
async function createExpense(expense: ExpenseInput) {
  return await supabase
    .from('expenses')
    .insert({
      ...expense,
      created_by: currentUser.id,
      created_at: new Date()
    })
    .select()
    .single()
}

async function updateExpense(id: string, updates: Partial<ExpenseInput>) {
  return await supabase
    .from('expenses')
    .update({
      ...updates,
      updated_by: currentUser.id,
      updated_at: new Date()
    })
    .eq('id', id)
    .select()
    .single()
}

// Obtener historial de auditoría
async function getExpenseAuditLog(expenseId: string) {
  return await supabase
    .from('expense_audit_logs')
    .select('*, changed_by(email, name)')
    .eq('expense_id', expenseId)
    .order('changed_at', { ascending: false })
}
```

**7.4 Configuracion-view.tsx o Modal de Auditoría:**
- Nuevo botón: **"Ver historial"** de gastos
- Modal muestra tabla con:
  - Acción (Creado/Actualizado)
  - Usuario
  - Fecha/Hora
  - Cambios (si es update, mostrar qué se modificó)
- Filtro por fecha/usuario

**7.5 Permisos:**
- Solo admins ven auditoría
- Barberos ven quién registró gasto en reporte, pero sin acceso a historial

### Verificación
- ✅ Crear gasto → registra `created_by` y fecha
- ✅ Editar gasto → actualiza `updated_by` y `updated_at`
- ✅ Tabla muestra "Registrado por [nombre]"
- ✅ Historial accesible desde modal
- ✅ Reporte muestra auditor (opcional)

---

## Archivos Clave a Modificar

| Mejora | Archivos |
|--------|----------|
| 1. Beneficios | `lib/supabase/supabase.client.ts`, `lib/supabase/database.types.ts`, `app/admin/admin-dashboard.tsx`, `app/admin/manual-cut-modal.tsx` |
| 2. Semanas martes-sábado | `lib/supabase/supabase.client.ts` (generateWeekRangesForMonth), `app/barber/barber-mobile-view.tsx`, `app/admin/semanas/weeks-view.tsx` |
| 3. Transferencias | `lib/supabase/supabase.client.ts`, `app/admin/admin-dashboard.tsx` (barber edit) |
| 4. Retiros socios | `app/admin/admin-dashboard.tsx`, `app/admin/reportes/reportes-view.tsx`, `lib/supabase/supabase.client.ts` |
| 5. Home — Fecha actual | `app/barber/barber-mobile-view.tsx`, `app/components/` (contexto/hook), `lib/utils/storage.ts` |
| 6. Cerrar semana por barbero | `lib/supabase/supabase.client.ts`, `lib/supabase/database.types.ts`, `app/admin/admin-dashboard.tsx`, `app/barber/barber-mobile-view.tsx` |
| 7. Gastos — Auditoría | `lib/supabase/supabase.client.ts`, `lib/supabase/database.types.ts`, `app/admin/admin-dashboard.tsx`, `app/admin/configuracion/configuracion-view.tsx` |

### Migrations
- `supabase/migrations/XXX_add_benefits_table.sql`
- `supabase/migrations/XXX_add_weeks_day_config.sql`
- `supabase/migrations/XXX_add_barber_transfer_config.sql`
- `supabase/migrations/XXX_add_partner_withdrawals_table.sql`
- `supabase/migrations/XXX_add_week_barber_closures.sql` (mejora 6)
- `supabase/migrations/XXX_add_expense_audit_logs.sql` (mejora 7)

---

## Testing / Verificación

### Mejora 1: Beneficios
- [ ] Crear beneficio fijo ($5) y porcentaje (10%)
- [ ] Registrar corte con beneficio → validar cálculo barber_share/branch_share (50/50)
- [ ] Editar/desactivar beneficio → no aparece en dropdown
- [ ] Reportes incluyen descuentos aplicados

### Mejora 2: Semanas
- [ ] Generar mes → semanas comienzan martes
- [ ] Barbero carga lunes → error "solo martes-sábado"
- [ ] Admin checkbox "permitir lunes/domingo" → desbloquea
- [ ] Calendario muestra mar-sáb en help text

### Mejora 3: Transferencias
- [ ] Crear barbero con transfers=false
- [ ] Transacción con transfer → suma a Valhalla, no barbero
- [ ] Liquidación muestra nota

### Mejora 4: Retiros
- [ ] Crear retiro de socio
- [ ] Reporte muestra en sección separada
- [ ] Retiros NO restan de netProfit
- [ ] Labels sincronizados

### Mejora 5: Home — Fecha Actual
- [ ] Navegar a Reportes → cambiar mes
- [ ] Volver a home → muestra mes actual
- [ ] Cerrar app y abrir → recuerda mes guardado (si corresponde)
- [ ] Help text muestra mes actual correcto

### Mejora 6: Cerrar Semana por Barbero
- [ ] Admin cierra semana de un barbero
- [ ] Barbero intenta cargar transacción → error "semana cerrada"
- [ ] Otra semana sigue abierta (no se cierran todas)
- [ ] Reporte muestra nota de cierre con fecha y admin

### Mejora 7: Gastos — Auditoría
- [ ] Crear gasto → registra `created_by` y fecha
- [ ] Editar gasto → actualiza `updated_by` y `updated_at`
- [ ] Tabla de gastos muestra "Registrado por [nombre]"
- [ ] Historial accesible (ver cambios previos)
- [ ] Solo admin ve auditoría

---

## Notas de Implementación

1. **Migración**: Mantener compatibilidad hacia atrás (deprecar columnas, no borrar)
2. **Performance**: Cachear beneficios en componente (revalidate cada 5 min)
3. **Validaciones**: 
   - Beneficio activo al registrar
   - Semana válida (martes start_date)
   - Socio válido para retiro
4. **UX**: Mostrar beneficio aplicado en transacción (tooltip con monto ahorrado)
