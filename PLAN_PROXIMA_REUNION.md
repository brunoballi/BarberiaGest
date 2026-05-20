# Plan próxima reunión — Valhalla

## 1. Flujo de cierre / liquidación
- Admin puede **cerrar manual**
- Sistema **cierra automático** al pasar el domingo (cron / job)
- Liquidación **editable después de "pagado"** (no estricto, sin lock total)
- **Adelantos visibles en liquidación**: recuperar y restarlos del net_payable
- **Auditoría completa**: tabla `audit_log` con quién/cuándo/qué (settlements, transactions, expenses)

## 2. Apertura automática de siguiente semana
- Al cerrar semana N → buscar/abrir semana N+1
- Si el mes no existe → crearlo automáticamente con sus 4-5 semanas
- Complementado con "Edición manual de semanas" en Configuración → Calendario

## 3. Edición manual de semanas (NUEVO sub-módulo)
Dentro de **Configuración → Calendario** → botón "Edición manual"
- Editar fechas de semana existente
- Crear semanas sueltas
- Reabrir semanas cerradas
- Cargar transacciones retroactivas

## 4. Selección de sucursal al login (REESTRUCTURACIÓN)
**Problema actual**: selector de sucursal duplicado en dashboard + configuración. Inconsistente.

**Nuevo flujo**:
1. Login con email/password
2. Pantalla intermedia: "Elegí sucursal" (solo si admin tiene varias)
3. Toda la sesión queda en contexto de esa sucursal
4. Botón "cambiar sucursal" en algún lugar del header (no selector siempre visible)
5. Eliminar selectores de sucursal en sub-pantallas

## 5. Admin asignado a sucursal(es) específica(s)
- Hoy: `profiles.branch_id` (single) → admin solo asignado a UNA sucursal
- Nuevo: tabla `admin_branches (admin_id, branch_id)` many-to-many
- RLS: admin solo ve sucursales asignadas
- En pantalla de "elegir sucursal" solo aparecen las suyas
- Super-admin global (opcional): puede ver todas

## 6. Mejoras barbero — Registro de cortes
- **Split payment**: dividir un corte en 2 métodos (ej: 50% efectivo + 50% transferencia)
- **Descuento**: campo opcional (monto o %) + razón breve
- **Nombre cliente**: campo opcional para identificar el corte

## 7. Mejoras barbero — Home / Liquidaciones
- Pantalla con transacciones del día (default)
- **Filtro fecha desde-hasta** con calendario
- Vista en **grilla** (no solo lista)
- **Editar transacción** propia (mientras la semana esté abierta)

---

## Orden de implementación sugerido

### Fase A — Reestructuración base (prioridad alta)
1. Tabla `admin_branches` + migración de datos existentes
2. Pantalla "Elegí sucursal" post-login
3. Eliminar selectores duplicados de sucursal
4. RLS por admin asignado

### Fase B — Flujo semana / liquidación
5. Auto-apertura próxima semana al cerrar
6. Cron job de cierre automático (domingo 23:59)
7. Adelantos integrados en vista de liquidación
8. Edición manual de semanas (sub-módulo)
9. Auditoría en settlements, transactions, expenses

### Fase C — Barbero UX
10. Split payment (2 métodos)
11. Descuento + razón
12. Nombre cliente
13. Filtro fecha desde-hasta + grilla editable
