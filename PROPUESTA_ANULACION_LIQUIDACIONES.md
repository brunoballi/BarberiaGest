# Propuesta: Sistema de Anulación de Liquidaciones

## Problema Actual
- Una vez confirmada (o pagada), una liquidación **no se puede deshacer**
- Si hay error, el admin debe:
  - Editar transacciones
  - Recalcular manualmente
  - Pero el estado sigue siendo "confirmed/paid" sin poder revertir

## Solución Propuesta

### Opción 1: Agregar estado `cancelled` (RECOMENDADA)

**1. Migración: agregar `cancelled` al enum**
```sql
-- Actualizar enum
do $$ begin
  alter type settlement_status add value 'cancelled' after 'paid';
exception when duplicate_object then null;
end $$;
```

**2. Agregar campos a la tabla settlements**
```sql
alter table settlements add column if not exists (
  cancelled_at    timestamptz,
  cancelled_by    uuid references auth.users(id),
  cancellation_reason text
);
```

**3. Crear RPC para anular**
```sql
create or replace function cancel_settlement(
  p_settlement_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
as $$
declare
  v_settlement settlements%rowtype;
begin
  select * into v_settlement 
  from settlements 
  where id = p_settlement_id;
  
  if not found then
    raise exception 'Liquidación no encontrada';
  end if;
  
  -- Solo permitir anular si está confirmed o paid
  if v_settlement.status not in ('confirmed', 'paid') then
    raise exception 'Solo se pueden anular liquidaciones confirmadas o pagadas';
  end if;
  
  update settlements
  set 
    status = 'cancelled',
    cancelled_at = now(),
    cancelled_by = auth.uid(),
    cancellation_reason = p_reason,
    updated_at = now()
  where id = p_settlement_id;
  
  -- REGISTRAR EN AUDITORÍA (ver Opción 2 abajo)
end;
$$;
```

### Opción 2: Registrar en Auditoría

**Crear tabla de auditoría (si no existe)**
```sql
create table if not exists settlement_audit (
  id              uuid primary key default gen_random_uuid(),
  settlement_id   uuid not null references settlements(id),
  action          text not null, -- 'created', 'confirmed', 'paid', 'cancelled', 'recalculated'
  old_status      settlement_status,
  new_status      settlement_status,
  old_net_payable numeric(12,2),
  new_net_payable numeric(12,2),
  reason          text,
  performed_by    uuid not null references auth.users(id),
  created_at      timestamptz not null default now()
);
```

**Actualizar RPC para registrar auditoría**
```sql
-- Cuando se confirma
update settlement_audit set new_status = 'confirmed' ...

-- Cuando se cancela
insert into settlement_audit 
  (settlement_id, action, old_status, new_status, reason, performed_by)
values
  (p_settlement_id, 'cancelled', v_settlement.status, 'cancelled', p_reason, auth.uid());
```

---

## UI Flow Propuesto

### Vista de Liquidaciones (weeks-view.tsx)

```tsx
// En la tabla/card de cada liquidación:

<div className="settlement-actions">
  {settlement.status === 'draft' && (
    <>
      <button onClick={recalculate}>Recalcular</button>
      <button onClick={confirm}>Confirmar</button>
      <button onClick={delete}>Eliminar</button>
    </>
  )}
  
  {settlement.status === 'confirmed' && (
    <>
      <button onClick={markPaid}>Marcar Pagado</button>
      <button onClick={cancelSettlement}>Anular</button>
    </>
  )}
  
  {settlement.status === 'paid' && (
    <>
      <button onClick={cancelSettlement}>Anular Pago</button>
    </>
  )}
  
  {settlement.status === 'cancelled' && (
    <span className="text-red-600">ANULADO</span>
  )}
</div>
```

### Modal de Anulación

```tsx
<Dialog>
  <h2>¿Anular liquidación?</h2>
  
  <div className="info">
    <p>Barbero: {settlement.barber.full_name}</p>
    <p>Semana: {settlement.week}</p>
    <p>Monto a pagar: ${settlement.net_payable}</p>
    <p className="text-amber-600">⚠️ Esta acción no se puede deshacer</p>
  </div>
  
  <textarea 
    placeholder="Motivo de la anulación (auditoría)"
    value={reason}
    onChange={setReason}
  />
  
  <button onClick={confirm} className="bg-red-600">
    Confirmar Anulación
  </button>
</Dialog>
```

### Después de Anular

```
Estado anterior: paid
  ↓
Estado nuevo: cancelled
  ↓
Opciones del admin:
1. Crear liquidación correctiva (recalcular desde cero)
2. Registrar ajuste manual (monto a devolver)
3. Ver en auditoría qué pasó
```

---

## Implementación en Código

### 1. Nueva función en supabase.client.ts
```typescript
export async function cancelSettlement(
  settlementId: string,
  reason: string
): Promise<void> {
  const { error } = await supabase.rpc('cancel_settlement', {
    p_settlement_id: settlementId,
    p_reason: reason,
  })
  if (error) throw new Error(`[cancelSettlement] ${error.message}`)
}
```

### 2. Actualizar types en database.types.ts
```typescript
export type settlement_status = 'draft' | 'confirmed' | 'paid' | 'cancelled'

export const SETTLEMENT_STATUS_LABELS: Record<settlement_status, string> = {
  draft: 'Borrador',
  confirmed: 'Confirmada',
  paid: 'Pagada',
  cancelled: 'Anulada',
}

export const SETTLEMENT_STATUS_COLORS: Record<settlement_status, string> = {
  draft: 'bg-blue-900/50',
  confirmed: 'bg-green-900/50',
  paid: 'bg-zinc-800',
  cancelled: 'bg-red-900/50',
}
```

### 3. Agregar botón en weeks-view.tsx
```tsx
{settlement.status === 'confirmed' || settlement.status === 'paid' ? (
  <button
    onClick={() => {
      setSelectedSettlement(settlement)
      setShowCancelModal(true)
    }}
    className="text-red-500 hover:bg-red-900/20"
  >
    Anular
  </button>
) : null}
```

---

## Decisiones de Diseño

### ¿Qué pasa con el dinero si anulo?
```
Opciones:
A) Registrar como "devolución pendiente" (requerirá liquidación correctiva)
B) Solo marcar como anulado en el sistema (decisión administrativa)
C) Auto-crear liquidación negativa (refund) — MÁS COMPLEJO

Recomendación: A + Modal que avise qué hacer
```

### ¿Se puede anular una liquidación pagada?
```
SÍ, porque:
- El pago podría haber sido un error (pagó el doble)
- Se podría haber pagado el monto equivocado
- La auditoría quedaría registrada

Restricción: Solo admin, con motivo obligatorio
```

### ¿Se puede recrear después de anular?
```
Opción A: Eliminar la liquidación anulada y recalcular
Opción B: Mantenerla anulada y crear una nueva ("v2")
Recomendación: B — Mejor auditoría
```

---

## Ventajas

✅ **Auditoría completa** → Quién anular, cuándo, por qué  
✅ **Reversible** → No es destructivo, solo marca estado  
✅ **Seguro** → Solo admin, con confirmación modal  
✅ **Flexible** → Permite manejar pagos erróneamente confirmados  
✅ **Escala** → Compatible con el flujo actual de draft→confirmed→paid  

## Próximos Pasos

1. Crear migración con enum + campos + RPC
2. Actualizar types de TypeScript
3. Agregar función en supabase.client.ts
4. Implementar UI: botón + modal
5. Mostrar anuladas en auditoría (tabla/vista separada)

