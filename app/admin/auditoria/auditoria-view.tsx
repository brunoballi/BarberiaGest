'use client'

import { useState, useEffect, useCallback } from 'react'
import { getAuditLog, type AuditLogWithUser, type AuditFilters } from '@/lib/supabase/supabase.client'
import './auditoria.css'

const TABLE_LABELS: Record<string, string> = {
  transactions: 'Transacciones',
  settlements:  'Liquidaciones',
  expenses:     'Gastos',
}

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  INSERT: { label: 'Creado',   color: '#34d399' },
  UPDATE: { label: 'Editado',  color: '#fbbf24' },
  DELETE: { label: 'Borrado',  color: '#f87171' },
}

function formatARS(n: number): string {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'string') return v
  if (typeof v === 'boolean') return v ? 'sí' : 'no'
  return JSON.stringify(v)
}

// Campos legibles para mostrar en el resumen / diff
const FIELD_LABELS: Record<string, string> = {
  amount: 'Monto',
  transaction_date: 'Fecha',
  payment_method: 'Método pago',
  barber_share: 'Parte barbero',
  branch_share: 'Parte negocio',
  client_name: 'Cliente',
  discount_amount: 'Descuento',
  discount_reason: 'Razón descuento',
  cash_amount: 'Efectivo',
  transfer_amount: 'Transferencia',
  card_amount: 'Tarjeta',
  status: 'Estado',
  net_payable: 'Neto a pagar',
  category: 'Categoría',
  description: 'Descripción',
}

const MONEY_FIELDS = new Set([
  'amount','barber_share','branch_share','discount_amount','cash_amount',
  'transfer_amount','card_amount','net_payable','gross_amount','total_earned',
  'already_collected','advances_deducted','total_deductions','barber_gross',
])

function formatField(field: string, v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (MONEY_FIELDS.has(field) && typeof v === 'string') return formatARS(parseFloat(v))
  if (MONEY_FIELDS.has(field) && typeof v === 'number') return formatARS(v)
  return formatValue(v)
}

function shortDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function AuditView() {
  const [logs, setLogs] = useState<AuditLogWithUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Filtros
  const [table,  setTable]  = useState<AuditFilters['table']>(null)
  const [action, setAction] = useState<AuditFilters['action']>(null)
  const [from,   setFrom]   = useState<string>('')
  const [to,     setTo]     = useState<string>('')

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await getAuditLog({ table, action, from: from || undefined, to: to || undefined, limit: 200 })
      setLogs(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error cargando auditoría')
    } finally {
      setLoading(false)
    }
  }, [table, action, from, to])

  useEffect(() => { load() }, [load])

  return (
    <div className="audit-page">
      <header className="audit-header">
        <div>
          <h1 className="audit-title">Auditoría</h1>
          <p className="audit-subtitle">Historial de cambios en transacciones, liquidaciones y gastos</p>
        </div>
      </header>

      {/* Filtros */}
      <div className="audit-filters">
        <div className="audit-filter">
          <label className="audit-filter__label">Tabla</label>
          <select value={table ?? ''} onChange={(e) => setTable((e.target.value || null) as AuditFilters['table'])} className="audit-filter__input">
            <option value="">Todas</option>
            <option value="transactions">Transacciones</option>
            <option value="settlements">Liquidaciones</option>
            <option value="expenses">Gastos</option>
          </select>
        </div>
        <div className="audit-filter">
          <label className="audit-filter__label">Acción</label>
          <select value={action ?? ''} onChange={(e) => setAction((e.target.value || null) as AuditFilters['action'])} className="audit-filter__input">
            <option value="">Todas</option>
            <option value="INSERT">Creado</option>
            <option value="UPDATE">Editado</option>
            <option value="DELETE">Borrado</option>
          </select>
        </div>
        <div className="audit-filter">
          <label className="audit-filter__label">Desde</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="audit-filter__input" />
        </div>
        <div className="audit-filter">
          <label className="audit-filter__label">Hasta</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="audit-filter__input" />
        </div>
      </div>

      {loading && <div className="audit-empty">Cargando...</div>}
      {error && <div className="audit-error">{error}</div>}

      {!loading && !error && logs.length === 0 && (
        <div className="audit-empty">Sin registros que coincidan</div>
      )}

      {!loading && !error && logs.length > 0 && (
        <div className="audit-list">
          {logs.map((log) => {
            const isOpen = expandedId === log.id
            const actionMeta = ACTION_LABELS[log.action]
            const summary = log.action === 'INSERT'
              ? (log.new_data?.amount ? `Monto ${formatARS(parseFloat(String(log.new_data.amount)))}` : `id ${log.record_id.slice(0,8)}`)
              : log.action === 'DELETE'
              ? (log.old_data?.amount ? `Monto ${formatARS(parseFloat(String(log.old_data.amount)))}` : `id ${log.record_id.slice(0,8)}`)
              : log.diff ? `${Object.keys(log.diff).length} ${Object.keys(log.diff).length === 1 ? 'campo' : 'campos'} modificados` : '—'

            return (
              <div key={log.id} className={`audit-row ${isOpen ? 'audit-row--open' : ''}`}>
                <button onClick={() => setExpandedId(isOpen ? null : log.id)} className="audit-row__header">
                  <span className="audit-row__arrow">▶</span>
                  <span className="audit-row__action" style={{ background: `${actionMeta.color}22`, color: actionMeta.color }}>
                    {actionMeta.label}
                  </span>
                  <span className="audit-row__table">{TABLE_LABELS[log.table_name] ?? log.table_name}</span>
                  <span className="audit-row__summary">{summary}</span>
                  <span className="audit-row__user">{log.changed_by_name ?? 'sistema'}</span>
                  <span className="audit-row__date">{shortDate(log.changed_at)}</span>
                </button>

                {isOpen && (
                  <div className="audit-row__body">
                    <p className="audit-row__id">ID: <code>{log.record_id}</code></p>
                    {log.action === 'UPDATE' && log.diff && Object.keys(log.diff).length > 0 ? (
                      <table className="audit-diff">
                        <thead>
                          <tr><th>Campo</th><th>Antes</th><th>→</th><th>Después</th></tr>
                        </thead>
                        <tbody>
                          {Object.entries(log.diff).map(([field, change]) => (
                            <tr key={field}>
                              <td>{FIELD_LABELS[field] ?? field}</td>
                              <td className="audit-diff__old">{formatField(field, change.old)}</td>
                              <td className="audit-diff__arrow">→</td>
                              <td className="audit-diff__new">{formatField(field, change.new)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <pre className="audit-row__json">{JSON.stringify(log.action === 'DELETE' ? log.old_data : log.new_data, null, 2)}</pre>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
