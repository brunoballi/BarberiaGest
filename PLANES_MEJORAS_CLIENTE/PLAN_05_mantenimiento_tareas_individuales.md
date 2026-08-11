# PLAN 05: Mantenimiento — tareas individuales reasignables

> **✅ IMPLEMENTADO — SIN migración.** (Corregido tras feedback del cliente: el desplegable va en la **plantilla**, no en la planilla semanal.)
>
> ### Dónde quedó el desplegable
> En el modo **Plantilla**, donde antes el nombre del barbero era texto fijo, ahora hay un `<select>`. Cambiar el barbero de un bloque **intercambia** las zonas/tareas con el bloque de ese barbero — no duplica, porque el schema tiene `UNIQUE(branch_id, barber_id)` y la plantilla siempre lista un bloque por barbero activo. Verificado en local: mover las tareas de Beizen a Fabricio y volver atrás persiste bien y sin violar la constraint.
>
> El desplegable que se había puesto en la planilla semanal (por tarea) **se quitó**: no era ahí.
>
> ### Regenerar → Eliminar planilla
> A pedido del cliente, el botón **↻ Regenerar** se reemplazó por **🗑 Eliminar planilla** (`deleteMaintenanceSheet`, los ítems caen por cascade). El flujo pasa a ser "borro y vuelvo a crear" en vez de "regenero encima". `regenerateMaintenanceSheet()` quedó sin usarse en la UI — se dejó en el cliente por si hace falta, avisar si se prefiere borrarla.
>
> ---
> **Nota original del relevamiento (sigue valiendo):**
>
> Al relevar el esquema **de prod** apareció que **`maintenance_sheet_items` ya tiene `barber_id` propio por tarea**: la planilla semanal ya era plana, el acoplamiento "una tarea pertenece al barbero de su bloque" existe solo en la *plantilla*.
>
> Por eso el dolor concreto que se planteó —"no tener que estar sacando de la planilla de mantenimiento en la generación del PDF"— se resuelve **sin tocar el schema**: se agregó un `<select>` de barbero en cada tarea de la planilla semanal (`setMaintenanceItemBarber`), con actualización optimista. Reasignar mueve la tarea al bloque del otro barbero (`groupByBarber` reagrupa por `barber_id`), así el PDF ya sale bien. **No toca la plantilla**: la semana siguiente vuelve a salir como está definida ahí, que es el comportamiento deseado para cubrir una ausencia puntual.
>
> ### Pendiente (opcional): reasignar en la PLANTILLA
> Falta la migración que le da `barber_id` propio a `maintenance_template_tasks` para poder reasignar también a nivel plantilla (hoy se hace moviendo la tarea entre bloques en el modo Plantilla, que ya existe). Se dejó afuera a propósito: obliga a soltar `maintenance_template_blocks.barber_id` y reescribir `getMaintenanceTemplate` / `saveMaintenanceTemplate` / `enterTemplateMode`, con riesgo sobre datos reales, a cambio de un beneficio marginal ahora que la reasignación semanal funciona.

**Bloquea a:** PLAN_06 (mobile + gate en Liquidaciones depende de este modelo nuevo).

## 📋 ESTADO ACTUAL

Esquema actual (`supabase/migrations/021_maintenance.sql`), 5 tablas:

- `maintenance_settings` (branch_id PK, `min_approval_pct`)
- `maintenance_template_blocks` (**`UNIQUE(branch_id, barber_id)`**, `zone_label`) — 1 bloque = 1 barbero
- `maintenance_template_tasks` (`block_id` FK, `item_number`, `description`) — la tarea hereda el barbero **indirectamente**, a través del bloque
- `maintenance_sheets` (`UNIQUE(branch_id, week_id)`) — snapshot semanal
- `maintenance_sheet_items` (`sheet_id` FK, **ya tiene `barber_id` propio**, `done boolean`)

Flujo (`lib/supabase/supabase.client.ts` líneas ~2295-2545, `app/admin/mantenimiento/mantenimiento-view.tsx`):

1. **Plantilla**: `enterTemplateMode()` arma un bloque por cada barbero **activo** de `getBarbersByBranch()`. `saveMaintenanceTemplate()` **borra todos los bloques del branch y reinserta solo los del draft actual**.
2. **Crear planilla semanal**: `createMaintenanceSheetFromTemplate()` lee la plantilla (`getMaintenanceTemplate()`, **sin filtrar por `is_active`**) y copia sus tareas a `maintenance_sheet_items`.
3. **Regenerar**: `regenerateMaintenanceSheet()` borra los items y vuelve a copiar desde la plantilla vigente — misma limitación.
4. **PDF**: `exportPDF()` agrupa `sheet.items` por barbero (`groupByBarber`) y llama a `generateMaintenanceSheet()` — imprime todo lo que recibe, sin filtrar `is_active`.

**Problema concreto que resuelve este plan:** si un barbero se da de baja o falta, hoy hay que entrar manualmente a "Plantilla", vaciarle la zona y volver a guardar — antes de generar cada PDF/planilla. La tarea vive pegada al bloque, y el bloque está pegado 1:1 a un barbero.

## 🎯 OBJETIVO

Decisión ya tomada con el cliente: **cada tarea individual tiene su propio barbero asignado**, con un desplegable para reasignarla al vuelo — tanto en la plantilla como en una planilla semanal ya generada — sin depender de reeditar el bloque completo.

## 🛠️ IMPLEMENTACIÓN

### Paso 1: Migración de schema

Nueva migración `supabase/migrations/04X_maintenance_tasks_per_barber.sql` (**confirmar el próximo número libre contra prod con `list_migrations`, no contra el repo local — hay drift documentado**):

```sql
-- 1. Los bloques dejan de ser 1:1 por barbero — pasan a ser "zonas" a nivel de sucursal
alter table maintenance_template_blocks drop constraint if exists maintenance_template_blocks_branch_id_barber_id_key;
alter table maintenance_template_blocks drop column if exists barber_id;
-- (si zone_label ya identificaba la zona, ahora es simplemente un agrupador visual, no ligado a un barbero)

-- 2. Las tareas pasan a tener su propio barbero
alter table maintenance_template_tasks add column barber_id uuid references profiles(id);

-- 3. Backfill: heredar el barber_id que tenía el bloque antes de soltarlo (correr ANTES del alter #1 en la migración real, orden invertido al de arriba para no perder el dato)
-- (ver nota de orden más abajo)

-- 4. maintenance_sheet_items ya tiene barber_id — no requiere cambio de columna,
--    pero el ORIGEN de ese valor pasa a ser task.barber_id en vez de block.barber_id
```

**Orden real recomendado dentro de la migración** (para no perder el backfill):
1. Agregar `maintenance_template_tasks.barber_id` (nullable).
2. `UPDATE maintenance_template_tasks t SET barber_id = b.barber_id FROM maintenance_template_blocks b WHERE t.block_id = b.id;` — backfill desde el dato viejo.
3. Recién ahí soltar `barber_id` y el `UNIQUE` de `maintenance_template_blocks`.
4. Volver `maintenance_template_tasks.barber_id` `NOT NULL` si el negocio exige que toda tarea tenga dueño (recomendado, para que el checklist de PLAN_06 tenga siempre a quién bloquear).

### Paso 2: Backend (`lib/supabase/supabase.client.ts`)

- `getMaintenanceTemplate()` — el join pasa de `blocks→tasks` (barbero implícito) a traer `tasks.barber_id` directo. Devolver también `full_name` del barbero vía `barber:profiles!barber_id(full_name)` para no tener que resolver IDs en el cliente.
- `saveMaintenanceTemplate()` — ya no valida "1 bloque = 1 barbero"; valida en cambio que cada tarea tenga `barber_id` asignado antes de guardar.
- `createMaintenanceSheetFromTemplate()` y `regenerateMaintenanceSheet()` — al copiar a `maintenance_sheet_items`, tomar `barber_id` de `task.barber_id` (no del bloque). Acá es el lugar natural para **filtrar o marcar** tareas cuyo `barber_id` corresponda a un barbero con `is_active = false` — recomendado: **no excluirlas silenciosamente**, sino generarlas igual pero devolver al frontend la lista de "tareas con barbero inactivo" para que el admin las reasigne desde el dropdown antes de exportar el PDF (evita perder tareas por accidente).
- Nueva función `reassignMaintenanceTask(taskId | itemId, newBarberId)` — update simple de `barber_id`, usable tanto sobre `maintenance_template_tasks` (plantilla, afecta semanas futuras) como sobre `maintenance_sheet_items` (una planilla ya generada, afecta solo esa semana).

### Paso 3: Frontend (`mantenimiento-view.tsx`)

- En modo plantilla y en modo planilla semanal, agregar un `<select>` de barbero por fila de tarea (mismo patrón de `<select>` que ya usa el filtro de barberos en Liquidaciones), que dispara `reassignMaintenanceTask()`.
- El agrupamiento visual (`groupByBarber`, usado para armar el PDF) sigue funcionando igual — ahora agrupa por `item.barber_id` que viene directo de la tarea, sin pasar por el bloque.
- Si se implementó la marca de "barbero inactivo" del Paso 2, mostrar un badge/alerta en esas filas antes de exportar.

### Paso 4: PDF (`lib/pdf/maintenance-sheet.ts`)

Sin cambios estructurales — sigue recibiendo `blocks` ya agrupados por `groupByBarber()`; el cambio es transparente para esta capa mientras el agrupamiento de arriba siga entregando la misma forma de datos.

## 📝 ARCHIVOS A MODIFICAR

1. **Crear** `supabase/migrations/04X_maintenance_tasks_per_barber.sql`
2. **Modificar** `lib/supabase/supabase.client.ts` — funciones de mantenimiento (líneas ~2295-2545)
3. **Modificar** `lib/supabase/database.types.ts` — tipos de `MaintenanceTemplateBlock`/`MaintenanceTemplateTask`/`MaintenanceSheetItem`
4. **Modificar** `app/admin/mantenimiento/mantenimiento-view.tsx` — dropdown de reasignación

## ⚠️ RIESGOS

- **Cambio de schema con datos existentes en prod** — correr primero contra el ambiente local Docker (ver memoria del proyecto), validar el backfill, recién después aplicar a prod vía MCP Supabase con backup previo (mismo procedimiento que las migraciones 031-039 ya deployadas).
- `zone_label` en los bloques pierde sentido de "por barbero" — decidir si sigue existiendo como agrupador libre (ej. "Zona de espera", "Baños") o se elimina el concepto de bloque directamente y las tareas quedan planas con solo `barber_id` + `item_number` + `description`. Evaluar con el cliente qué visual prefiere para el PDF (agrupado por zona vs. agrupado solo por barbero, que es lo que ya hace `groupByBarber`).
- No confundir esto con `settlements.mantenimiento_met` (el bono por tasa/mínimo de cortes) — son conceptos distintos que **PLAN_06** conecta, pero este plan (05) no toca la tabla `settlements` para nada.

## ✅ CHECKLIST

- [ ] Migración probada en local (Docker) con datos de ejemplo antes de tocar prod
- [ ] Backfill de `barber_id` desde los bloques existentes verificado (ningún dato perdido)
- [ ] Dropdown de reasignación funciona tanto en plantilla como en una planilla semanal ya generada
- [ ] PDF sigue agrupando correctamente por barbero
- [ ] Barberos inactivos quedan visibles/marcados en vez de desaparecer silenciosamente

## 🎯 BENEFICIOS

✅ Ya no hace falta editar la plantilla completa para reasignar una tarea puntual
✅ Reasignar en una planilla ya generada no requiere regenerar todo desde la plantilla
✅ Base necesaria para que el barbero, del lado mobile, vea exactamente sus tareas (PLAN_06)
