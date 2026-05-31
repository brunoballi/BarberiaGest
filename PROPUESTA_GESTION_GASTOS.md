# Propuesta: Gestión Completa de Gastos + Retiro de Socios

## Estado Actual
- ✅ Tabla `expenses` existe en DB
- ✅ EXPENSE_LABELS ya tiene `retiro_socio`
- ❌ NO hay UI para crear/editar/eliminar gastos
- ❌ `retiro_socio` se cuenta como gasto normal (no diferenciado en reportes)

---

## 1. CREAR NUEVA VISTA: `/admin/gastos`

### Estructura de carpetas
```
app/admin/gastos/
  ├── page.tsx              (wrapper)
  ├── gastos-view.tsx       (componente principal)
  └── expenses-modal.tsx    (crear/editar modal)
```

### Funcionalidad propuesta
```
┌─────────────────────────────────┐
│ GASTOS (admin/gastos)           │
├─────────────────────────────────┤
│ [Nuevo Gasto +]                 │
│                                 │
│ Filtros:                        │
│ - Semana  [dropdown]            │
│ - Categoría [dropdown]          │
│ - Mostrar: Todos / Solo activos │
│                                 │
│ Tabla:                          │
│ Fecha  │ Concepto  │ Categoría  │ Monto   │ Acciones
│ 1-Jun │ Alquiler  │ alquiler   │ 50.000  │ [✎ Editar] [🗑 Eliminar]
│ 2-Jun │ Retiro    │ retiro_soc │ 10.000  │ [✎ Editar] [🗑 Eliminar]
│ ...   │ ...       │ ...        │ ...     │ ...
│                                 │
│ Total:                          │
│ Gastos normales: $50.000        │
│ Retiro de socios: $10.000       │
│ Total: $60.000                  │
└─────────────────────────────────┘
```

---

## 2. RPC FUNCTIONS (Nueva migración)

```sql
-- 010_expense_crud.sql

-- Crear gasto
create or replace function create_expense(
  p_branch_id uuid,
  p_concept text,
  p_category text,
  p_amount numeric,
  p_expense_date date,
  p_week_id uuid,
  p_notes text
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_expense_id uuid;
begin
  insert into expenses (
    branch_id, concept, category, amount, expense_date,
    week_id, notes, registered_by, paid_by
  ) values (
    p_branch_id, p_concept, p_category, p_amount, p_expense_date,
    p_week_id, p_notes, auth.uid(), auth.uid()
  )
  returning id into v_expense_id;
  
  return v_expense_id;
end;
$$;

-- Actualizar gasto
create or replace function update_expense(
  p_expense_id uuid,
  p_concept text,
  p_category text,
  p_amount numeric,
  p_expense_date date,
  p_notes text
)
returns void
language plpgsql
security definer
as $$
begin
  update expenses
  set
    concept = p_concept,
    category = p_category,
    amount = p_amount,
    expense_date = p_expense_date,
    notes = p_notes
  where id = p_expense_id;
end;
$$;

-- Eliminar gasto
create or replace function delete_expense(p_expense_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  delete from expenses where id = p_expense_id;
end;
$$;
```

---

## 3. FUNCIONES EN supabase.client.ts

```typescript
export async function createExpense(data: {
  branchId: string
  concept: string
  category: string
  amount: number
  expenseDate: string
  weekId?: string
  notes?: string
}): Promise<string> {
  const { data: result, error } = await supabase.rpc('create_expense', {
    p_branch_id: data.branchId,
    p_concept: data.concept,
    p_category: data.category,
    p_amount: data.amount,
    p_expense_date: data.expenseDate,
    p_week_id: data.weekId || null,
    p_notes: data.notes || null,
  })
  if (error) throw new Error(`[createExpense] ${error.message}`)
  return result
}

export async function updateExpense(
  expenseId: string,
  data: {
    concept: string
    category: string
    amount: number
    expenseDate: string
    notes?: string
  }
): Promise<void> {
  const { error } = await supabase.rpc('update_expense', {
    p_expense_id: expenseId,
    p_concept: data.concept,
    p_category: data.category,
    p_amount: data.amount,
    p_expense_date: data.expenseDate,
    p_notes: data.notes || null,
  })
  if (error) throw new Error(`[updateExpense] ${error.message}`)
}

export async function deleteExpense(expenseId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_expense', {
    p_expense_id: expenseId,
  })
  if (error) throw new Error(`[deleteExpense] ${error.message}`)
}

// Obtener gastos por semana
export async function getExpensesByWeek(weekId: string): Promise<Expense[]> {
  const { data, error } = await supabase
    .from('expenses')
    .select('*')
    .eq('week_id', weekId)
    .order('expense_date', { ascending: false })
  
  if (error) throw new Error(`[getExpensesByWeek] ${error.message}`)
  return data || []
}
```

---

## 4. ACTUALIZAR REPORTE: `retiro_socio` como "Ganancia x Socios"

### En reportes-view.tsx

```typescript
// Cambiar logic para separar retiro_socios
const calculateReportMetrics = (expenses: Expense[]) => {
  let totalExpenses = 0
  let partnerWithdrawals = 0
  
  expenses.forEach(exp => {
    if (exp.category === 'retiro_socio') {
      partnerWithdrawals += exp.amount
    } else {
      totalExpenses += exp.amount
    }
  })
  
  return { totalExpenses, partnerWithdrawals }
}

// En el reporte final, mostrar ambas líneas:
// "Gastos operacionales: $50.000"
// "Ganancia x socios: $10.000"
// "Total descontado: $60.000"
```

### En la RPC `report_by_period` (migración 008)

Actualizar para separar categorías:
```sql
SELECT
  SUM(CASE WHEN category != 'retiro_socio' THEN amount ELSE 0 END) as total_expenses,
  SUM(CASE WHEN category = 'retiro_socio' THEN amount ELSE 0 END) as partner_withdrawals,
  SUM(amount) as total_deductions
FROM expenses
WHERE week_id IN (SELECT id FROM weeks WHERE branch_id = ...)
```

---

## 5. UI COMPONENTS

### gastos-view.tsx (componente principal)
```tsx
'use client'

export default function GastosView() {
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [selectedWeek, setSelectedWeek] = useState<string>('')
  const [showModal, setShowModal] = useState(false)
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null)
  
  const handleCreate = () => {
    setEditingExpense(null)
    setShowModal(true)
  }
  
  const handleEdit = (expense: Expense) => {
    setEditingExpense(expense)
    setShowModal(true)
  }
  
  const handleDelete = async (expenseId: string) => {
    if (!confirm('¿Eliminar gasto?')) return
    await deleteExpense(expenseId)
    setExpenses(expenses.filter(e => e.id !== expenseId))
  }
  
  const handleSave = async (data: ExpenseForm) => {
    if (editingExpense) {
      await updateExpense(editingExpense.id, data)
    } else {
      await createExpense(data)
    }
    setShowModal(false)
    // Reload expenses
  }
  
  return (
    <div>
      <button onClick={handleCreate}>+ Nuevo Gasto</button>
      
      <table>
        <tbody>
          {expenses.map(exp => (
            <tr key={exp.id}>
              <td>{exp.expense_date}</td>
              <td>{exp.concept}</td>
              <td>{EXPENSE_LABELS[exp.category]}</td>
              <td>{formatARS(exp.amount)}</td>
              <td>
                <button onClick={() => handleEdit(exp)}>✎ Editar</button>
                <button onClick={() => handleDelete(exp.id)}>🗑 Eliminar</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      
      {showModal && (
        <ExpensesModal
          expense={editingExpense}
          onSave={handleSave}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  )
}
```

### expenses-modal.tsx (crear/editar)
```tsx
export function ExpensesModal({
  expense,
  onSave,
  onClose,
}: {
  expense: Expense | null
  onSave: (data: ExpenseForm) => Promise<void>
  onClose: () => void
}) {
  const [form, setForm] = useState<ExpenseForm>(
    expense || { concept: '', category: '', amount: 0, expenseDate: '' }
  )
  
  return (
    <Dialog>
      <h2>{expense ? 'Editar Gasto' : 'Nuevo Gasto'}</h2>
      <input
        type="text"
        placeholder="Concepto (ej: Alquiler, Servicios)"
        value={form.concept}
        onChange={e => setForm({ ...form, concept: e.target.value })}
      />
      <select
        value={form.category}
        onChange={e => setForm({ ...form, category: e.target.value })}
      >
        <option value="">Seleccionar categoría</option>
        {Object.entries(EXPENSE_LABELS).map(([k, v]) => (
          <option key={k} value={k}>{v}</option>
        ))}
      </select>
      <input
        type="number"
        placeholder="Monto"
        value={form.amount}
        onChange={e => setForm({ ...form, amount: Number(e.target.value) })}
      />
      <input
        type="date"
        value={form.expenseDate}
        onChange={e => setForm({ ...form, expenseDate: e.target.value })}
      />
      <textarea
        placeholder="Notas (opcional)"
        value={form.notes || ''}
        onChange={e => setForm({ ...form, notes: e.target.value })}
      />
      
      <button onClick={() => onSave(form)}>Guardar</button>
      <button onClick={onClose}>Cancelar</button>
    </Dialog>
  )
}
```

---

## 6. NUEVAS RUTAS

- `/admin/gastos` → Vista de gestión de gastos
- En admin dashboard → agregar link a "Gastos"

---

## 7. ACTUALIZAR TYPES

```typescript
// En database.types.ts
export type Expense = {
  id: string
  branch_id: string
  concept: string
  category: string
  amount: number
  expense_date: string
  week_id?: string
  notes?: string
  paid_by?: string
  registered_by: string
  created_at: string
}

export type ExpenseForm = Omit<Expense, 'id' | 'created_at' | 'registered_by'>
```

---

## Resumen de Cambios

✅ Nueva migración `010_expense_crud.sql` con RPCs  
✅ 3 nuevas funciones en `supabase.client.ts`  
✅ Nueva carpeta `/admin/gastos/` con 2 componentes  
✅ Actualizar `report_by_period` para separar `retiro_socio`  
✅ Actualizar reportes UI para mostrar ambas líneas  
✅ Nuevos types en `database.types.ts`  

