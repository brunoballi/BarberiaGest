# Flujo de Cierre de Semana + Liquidaciones

## 1. ¿QUÉ PASA AL CERRAR UNA SEMANA?

### Orden de ejecución (en la UI, weeks-view.tsx):
```
1. Filtrar barberos ACTIVOS (is_active = true)
2. RPC calculateAllSettlementsForWeek(weekId, barberIds)
   └─ Iteración server-side dentro de Postgres (una sola transacción, 1 round-trip)
3. RPC closeWeek(weekId, userId)
   └─ Actualiza weeks.status = 'closed'
```

### ¿Se generan liquidaciones automáticamente en estado DRAFT?
**SÍ.** La función `calculate_settlement` hace:
```sql
INSERT INTO settlements (week_id, barber_id, ..., status)
VALUES (..., 'draft')
ON CONFLICT (week_id, barber_id) DO UPDATE SET ...
```

Esto significa:
- **Primera vez**: Crea 1 liquidación por barbero activo, status='draft'
- **Si llamas de nuevo**: Recalcula todo (on conflict do update)
- **Las liquidaciones siempre se crean en draft**, listo para que el admin revise

## 2. ESTRUCTURA DE CÁLCULO (función calculate_settlement)

```
Para cada barbero en la semana:

1. LEE transacciones de esa semana
   - Sumo: cantidad de cortes, monto total, barber_share, adelantos cobrados
   - Agrego: desglose por payment_method (cash/transfer/card)

2. APLICA modelo de compensación
   - salary → base_salary_rate + bonos presentismo/objetivo
   - percentage → suma los barber_share de transacciones
   - box_rental → 0 (no suma nada, solo caja)

3. CALCULA bonos (solo si es salary):
   - presentismo_met: si fue seteado manualmente, lo PRESERVA
   - objetivo_met: if total_cuts >= objetivo_min_cuts

4. RESTA deducibles
   - already_collected (pagos en negro durante la semana)
   - advances_deducted (adelantos pendientes)

5. RESULTADO: net_payable = total_earned - total_deductions

6. ALMACENA snapshots de las tasas del barbero en ese momento
   - base_salary_rate_snap, presentismo_rate_snap, etc.
```

## 3. ¿QUÉ PASA SI NECESITO CORREGIR UN TRANSACTION?

### Escenario: Registré mal un transaction ANTES de cerrar la semana
✅ **Fácil**:
1. Editar el transaction
2. El cálculo es server-side on-demand, no hay problema

### Escenario: Registré mal un transaction DESPUÉS de cerrar la semana
⚠️ **Más cuidado, pero posible**:

**Opción A: Corregir la liquidación directamente** (si el admin permite editar liquidaciones estado=draft)
- El admin ve la liquidación en draft
- Hace click "Editar" (si existe botón) y cambia montos
- Confirma cuando esté bien

**Opción B: Modificar transaction + recalcular**
1. Editar el transaction (la RLS del admin permite update en transacciones)
2. Llamar de nuevo a `calculate_settlement(weekId, barberId)`
   - El on-conflict do update recalculará todo
3. La liquidación se actualiza automáticamente
4. El admin revisa y confirma

**RESTRICCIÓN IMPORTANTE:**
Si la semana está en status='closed', necesito verificar las RLS policies:
- `weeks` tiene policy: `using (current_user_role() = 'admin' and branch_id = current_user_branch())`
- Permite update en semanas cerradas (no hay validación status='open')

## 4. ¿Y SI NECESITO MODIFICAR LIQUIDACIÓN CONFIRMADA O PAGADA?

Las liquidaciones tienen status: `draft → confirmed → paid`

Si es **draft**: El admin puede editarla o recalcularla sin problemas

Si es **confirmed/paid**: 
- Las RLS policies de settlements solo permiten update si es admin
- Pero probablemente hay lógica en la UI que previene editar liquidaciones confirmadas
- **Solución**: Admin baja a draft manualmente, corrige, vuelve a confirmar

## 5. FLUJO COMPLETO DE CORRECCIÓN

```
Escenario: Descubrí un error en un transaction registrado hace 3 días

1. Admin abre la semana correspondiente
2. Ve las liquidaciones en draft/confirmed
3. Edita el transaction incorrecto
4. Opción A: Recalcula (botón "Recalcular" o similar)
   - Llama RPC calculate_settlement nuevamente
   - Actualiza liquidación (on conflict do update)
5. Opción B: Edita manualmente la liquidación
   - Cambia montos si es necesario
6. Confirma cuando todo esté correcto
7. Si ya estaba pagada, el admin nota que no coincide con lo pagado
   - Registra una nota de auditoría o ajuste manual
```

## 6. PROTECCIONES Y RESTRICCIONES

### ¿Qué protege la integridad?
- **Snapshots**: Se guardan las tasas de compensación AL MOMENTO del cálculo
  - Si cambia la tasa después, no afecta liquidaciones anteriores
- **Transacciones atómicas**: El on-conflict do update sucede en una sola transacción Postgres
- **RLS**: Solo admins pueden ver/modificar liquidaciones
- **Unique constraint**: `UNIQUE(week_id, barber_id)` → 1 liquidación por barbero por semana

### ¿Qué NO está protegido automáticamente?
- El admin puede editar un transaction de una semana ya cerrada (RLS no lo previene)
- No hay "auditoria de cambios" automática (pero existe tabla auditoria manual)
- Si el admin recalcula manualmente, sobrescribe todo (no hay undo)

## 7. RESPUESTAS A TUS PREGUNTAS ESPECÍFICAS

### P: "¿Al cerrar semana se generan automáticamente liquidaciones en draft?"
✅ **SÍ**. Para todos los barberos activos, status='draft'.

### P: "¿Qué pasa si tengo que modificar una liquidación por error en un transaction?"
- Si está en **draft**: Recalcula con el nuevo transaction (on conflict do update)
- Si está **confirmada/pagada**: El admin puede bajarla a draft, corregir, confirmar de nuevo
- No hay bloqueo automático en RLS para prevenir esto

### P: "¿El cliente siempre genera liquidaciones en draft o depende?"
**Siempre draft**. La lógica es:
```sql
status = 'draft'  -- siempre al calcular
```
El estado solo cambia cuando el admin hace click en "Confirmar" → status='confirmed'.

