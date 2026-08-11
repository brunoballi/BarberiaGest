# Mejoras relevadas con el cliente — 2026-08

> ## ✅ ESTADO: los 8 planes implementados en la rama `feat/modulo-gastos`
> **Nada aplicado en producción.** Las migraciones 044-047 corrieron **solo contra la base local (Docker)**.
>
> | Plan | Estado |
> |---|---|
> | 01 Módulo Gastos | ✅ (pasó a **mensual** a pedido del cliente) |
> | 02 Módulo Retiros Socios | ✅ migración 044 |
> | 03 Retiros en Reportes | ✅ migración 046 |
> | 04 Limpieza KPIs | ✅ se sacaron las dos cards |
> | 05 Mantenimiento reasignable | ✅ **sin migración** (ver plan); queda opcional la parte de plantilla |
> | 06 Mantenimiento mobile + gate | ✅ **sin migración de RLS** (ver plan) |
> | 07 Socio Vitalicio | ✅ migración 047 |
> | 08 Optimización | ✅ prioridades 1, 3 y 4 (2 y 5 descartadas/pendientes con motivo) |
>
> ### ⚠️ Lo más importante antes de ir a producción
> 1. **La base local estaba DESACTUALIZADA respecto de prod** (le faltaban las migraciones 041-043). Se detectó al escribir la 046: construir esa migración sobre lo que tenía local **habría borrado features en prod**. Regla que quedó: para funciones que se reescriben completas (`report_by_period`, `month_financials`, `update_expense`), sacar la definición **de prod** con `pg_get_functiondef`, nunca del repo ni de local.
> 2. **Migración 045 (RLS de `admin_branches`)** es el cambio más sensible de la tanda — conviene revisarla explícitamente.
> 3. Conviene **refrescar la base local desde prod** antes de seguir probando cosas financieras.


Ocho planes, uno por mejora, escritos tras relevar el código actual (no son ideas sueltas — cada uno cita archivo/línea real y marca qué se rompe si se hace mal). Antes de escribir estos planes se resolvieron 4 ambigüedades con el cliente (ver "Decisiones ya tomadas" abajo) para no planificar sobre una lectura equivocada del pedido.

## Orden recomendado de implementación

```
PLAN_01 (módulo Gastos)
   └─▶ PLAN_02 (módulo Retiros Socios, sale de Gastos)
          └─▶ PLAN_03 (Retiros Socios en Reportes)
                 └─▶ PLAN_04 (recién acá se sacan las KPI cards de Liquidaciones)

PLAN_05 (Mantenimiento: tareas individuales reasignables)
   └─▶ PLAN_06 (Mantenimiento mobile + gate en Liquidaciones)

PLAN_07 (Beneficio Socio Vitalicio)   — independiente, se puede hacer en cualquier momento
PLAN_08 (Optimización de consultas)  — independiente, bajo riesgo, se puede paralelizar con todo lo demás
```

**Por qué este orden:**
- **01→02→03→04** es una cadena real: no tiene sentido sacar las KPI cards de Liquidaciones (04) hasta que el número que mostraban viva en otro lado visible (02 y 03). Si se hace 04 primero, el cliente pierde visibilidad de esos totales por el tiempo que tarde el resto.
- **05→06** es una dependencia de datos, no solo de UX: 06 (mobile + gate) necesita que cada tarea tenga su propio `barber_id` (05) para poder armar el checklist por barbero. Si se hace 06 primero, hay que reescribir la lectura de datos cuando 05 cambie el schema.
- **07 y 08** no tocan nada de lo anterior — se pueden intercalar donde convenga por prioridad de negocio, no por dependencia técnica.

## Decisiones ya tomadas con el cliente (no volver a preguntar)

1. **Columna "Mantenimiento" en Liquidaciones**: se reusa el campo existente (`mantenimiento_met`/`bonus_mantenimiento`, hoy un bono por tasa/mínimo de cortes) — no se crea un indicador separado. El checklist semanal (PLAN_06) pasa a ser una **condición previa** para poder tocar ese mismo campo: se habilita (deja de estar grisado) solo si el barbero tiene el 100% de sus tareas de esa semana completadas; con una sola tarea pendiente, el botón queda grisado y no se puede tocar aunque el admin quiera forzarlo.
2. **KPI cards a sacar de Liquidaciones**: "Retiros socios" y "Devuelto x barberos" (PLAN_04). No se encontró ningún control de "dar de baja barberos" dentro de Liquidaciones — esa acción vive en ABM de Barberos y no se toca.
3. **"Reporte de saldos del mes"** = el módulo Reportes (`/admin/reportes`), específicamente el desglose colapsable ▶/▼ que ya existe ahí para barberos/barbería — no la pantalla de Configuración → Detalle del mes.
4. **Modelo de la planilla de Mantenimiento**: pasa de "bloques 1:1 por barbero" a "tareas individuales con barbero propio y reasignable por dropdown" — es un cambio de schema (PLAN_05), no solo visual.
5. **Identificación del socio en Retiros (PLAN_02)**: no se crea tabla nueva — se reusan los `profiles` con `role='admin'` (ya son los socios/dueños del sistema) vía `expenses.partner_id`. Habilita el desglose exacto por socio en PLAN_03 sin texto libre.
6. **Liquidaciones se renderiza en un solo archivo** (`weeks-view.tsx`) — confirmado, PLAN_06 no tiene que sincronizar dos vistas.
7. **Lista de socios vitalicios (PLAN_07)**: es **global**, no por sucursal — vale en cualquier sucursal de la barbería.
8. **Validación de documento en el beneficio vitalicio (PLAN_07)**: es **bloqueante**. Si el DNI no está en la lista, el registro del corte no se guarda y se muestra: *"El DNI no está en la lista de socios vitalicios. Por favor, comunicate con el administrador."*

## Riesgos transversales a tener presentes en todos los planes

- **Drift entre el repo local y prod en `supabase/migrations/`** (ya documentado en memoria del proyecto) — antes de nombrar cualquier migración nueva, confirmar el último número real aplicado contra prod (`list_migrations` vía MCP Supabase), no contra lo que hay en el repo.
- **`month_financials()` excluye hardcodeado `category='retiro_socio'`** — cualquier cambio al modelado de retiro de socios (PLAN_02) que no sea puramente de UI puede romper el cálculo de "Saldo del mes" en Reportes.
- Probar todo primero contra el ambiente local (Docker), migrar a prod recién después con backup previo — mismo procedimiento ya usado para las migraciones 031-039.
