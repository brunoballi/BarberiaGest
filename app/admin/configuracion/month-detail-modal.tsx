'use client'

// ============================================================
// MONTH DETAIL MODAL — Acumulado mensual por barbero
// Misma estructura que WeekDetailModal pero sumando todas las
// semanas del mes. Incluye filtro por barbero + descarga PDF.
// ============================================================
import { useState, useMemo } from 'react'
import type {
  Month,
  TransactionWithRelations,
  SettlementWithBarber,
  PaymentMethod,
} from '@/lib/supabase/database.types'
import { PAYMENT_METHOD_LABELS } from '@/lib/supabase/database.types'
import { MONTH_NAMES } from '@/lib/supabase/supabase.client'
import { generateMonthReport } from '@/lib/pdf/month-report'

function formatARS(n: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(n)
}

function formatDate(d: string): string {
  return new Date(d + 'T12:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })
}

export interface MonthDetailData {
  transactions: TransactionWithRelations[]
  settlements: SettlementWithBarber[]
}

interface BarberAgg {
  barberId: string
  barberName: string
  cuts: number
  billed: number
  commission: number
  toCollect: number
}

interface MonthDetailModalProps {
  month: Month
  branchName: string
  data: MonthDetailData | null
  loading: boolean
  onClose: () => void
}

const ALL = '__all__'

export default function MonthDetailModal({ month, branchName, data, loading, onClose }: MonthDetailModalProps) {
  const monthName = MONTH_NAMES[month.month - 1]
  const monthLabel = `${monthName} ${month.year}`
  const [barberFilter, setBarberFilter] = useState<string>(ALL)

  // Lista de barberos únicos del mes (para el dropdown)
  const barbers = useMemo(() => {
    if (!data) return [] as { id: string; name: string }[]
    const map = new Map<string, string>()
    for (const s of data.settlements) map.set(s.barber_id, s.barber.full_name)
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [data])

  // Settlements/transacciones filtrados por barbero
  const filteredSettlements = useMemo(() => {
    if (!data) return []
    return barberFilter === ALL
      ? data.settlements
      : data.settlements.filter((s) => s.barber_id === barberFilter)
  }, [data, barberFilter])

  const filteredTransactions = useMemo(() => {
    if (!data) return []
    const txs = barberFilter === ALL
      ? data.transactions
      : data.transactions.filter((t) => t.barber_id === barberFilter)
    // Ordenar por fecha (más reciente primero); las semanas vienen concatenadas.
    return [...txs].sort((a, b) => {
      const d = b.transaction_date.localeCompare(a.transaction_date)
      return d !== 0 ? d : b.created_at.localeCompare(a.created_at)
    })
  }, [data, barberFilter])

  // Acumulado por barbero (suma de todas las semanas del mes)
  const barberRows = useMemo<BarberAgg[]>(() => {
    const map = new Map<string, BarberAgg>()
    for (const s of filteredSettlements) {
      const cur = map.get(s.barber_id) ?? {
        barberId: s.barber_id,
        barberName: s.barber.full_name,
        cuts: 0, billed: 0, commission: 0, toCollect: 0,
      }
      cur.cuts += s.total_cuts
      cur.billed += s.gross_amount
      cur.commission += s.total_earned
      cur.toCollect += s.net_payable
      map.set(s.barber_id, cur)
    }
    return [...map.values()].sort((a, b) => a.barberName.localeCompare(b.barberName))
  }, [filteredSettlements])

  // Resumen (KPIs) basado en transacciones filtradas
  const summary = useMemo(() => {
    const txs = filteredTransactions
    const byMethod: Record<PaymentMethod, number> = { cash: 0, transfer: 0, card: 0, mixed: 0 }
    let totalBilled = 0
    for (const t of txs) { byMethod[t.payment_method] += t.amount; totalBilled += t.amount }
    return { totalCuts: txs.length, totalBilled, byMethod }
  }, [filteredTransactions])

  const totals = useMemo(() => barberRows.reduce(
    (acc, r) => ({
      cuts: acc.cuts + r.cuts,
      billed: acc.billed + r.billed,
      commission: acc.commission + r.commission,
      toCollect: acc.toCollect + r.toCollect,
    }),
    { cuts: 0, billed: 0, commission: 0, toCollect: 0 }
  ), [barberRows])

  function handleDownloadPdf() {
    generateMonthReport({
      monthLabel,
      branchName,
      barberFilterLabel: barberFilter === ALL
        ? 'Todos los barberos'
        : barbers.find((b) => b.id === barberFilter)?.name,
      rows: barberRows.map((r) => ({
        barberName: r.barberName,
        cuts: r.cuts,
        billed: r.billed,
        commission: r.commission,
        toCollect: r.toCollect,
      })),
    })
  }

  return (
    <div className="modal-overlay">
      <div className="modal-box" style={{ maxWidth: '820px', width: '100%' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>
            Detalle mensual · {monthLabel}
            <span style={{ marginLeft: '0.75rem', fontSize: '0.75rem', fontWeight: 400, color: '#71717a' }}>
              acumulado de todas las semanas
            </span>
          </h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body" style={{ gap: '1.25rem' }}>
          {loading && (
            <div className="flex-center" style={{ padding: '2rem' }}>
              <div className="admin-loader" />
            </div>
          )}

          {!loading && data && (
            <>
              {/* --- Filtro por barbero + PDF --- */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <label style={{ fontSize: '0.75rem', color: '#71717a' }}>Barbero</label>
                  <select
                    value={barberFilter}
                    onChange={(e) => setBarberFilter(e.target.value)}
                    style={{
                      background: '#18181b', color: '#e4e4e7', border: '1px solid #3f3f46',
                      borderRadius: '0.5rem', padding: '0.4rem 0.7rem', fontSize: '0.8125rem',
                    }}
                  >
                    <option value={ALL}>Ver todos</option>
                    {barbers.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
                <button
                  className="admin-btn"
                  style={{ background: 'rgba(99,102,241,0.15)', color: '#818cf8', fontSize: '0.8125rem', padding: '0.4rem 0.9rem' }}
                  onClick={handleDownloadPdf}
                  disabled={barberRows.length === 0}
                >
                  ⬇ Descargar PDF
                </button>
              </div>

              {/* --- Resumen --- */}
              <section>
                <p style={{ fontSize: '0.6875rem', color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.75rem' }}>
                  Resumen del mes
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <KpiMini label="Cortes" value={String(summary.totalCuts)} />
                  <KpiMini label="Facturado" value={formatARS(summary.totalBilled)} />
                  <KpiMini label="Efectivo" value={formatARS(summary.byMethod.cash)} color="#34d399" />
                  <KpiMini label="Transfer" value={formatARS(summary.byMethod.transfer)} color="#818cf8" />
                </div>
              </section>

              {/* --- Por barbero (acumulado) --- */}
              <section>
                <p style={{ fontSize: '0.6875rem', color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>
                  Por barbero · acumulado mensual
                </p>
                {barberRows.length === 0 ? (
                  <div className="empty-state"><p>Sin datos para este mes.</p></div>
                ) : (
                  <div className="admin-table-wrap" style={{ padding: 0 }}>
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>Barbero</th>
                          <th>Cortes</th>
                          <th>Facturado</th>
                          <th>Comisión</th>
                          <th>A cobrar</th>
                        </tr>
                      </thead>
                      <tbody>
                        {barberRows.map((row) => (
                          <tr key={row.barberId}>
                            <td>{row.barberName}</td>
                            <td className="td-center">{row.cuts}</td>
                            <td>{formatARS(row.billed)}</td>
                            <td>{formatARS(row.commission)}</td>
                            <td className={row.toCollect >= 0 ? 'net-payable net-payable--pos' : 'net-payable net-payable--neg'}>
                              {formatARS(row.toCollect)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={{ borderTop: '2px solid #3f3f46', fontWeight: 700 }}>
                          <td>TOTAL</td>
                          <td className="td-center">{totals.cuts}</td>
                          <td>{formatARS(totals.billed)}</td>
                          <td>{formatARS(totals.commission)}</td>
                          <td className={totals.toCollect >= 0 ? 'net-payable net-payable--pos' : 'net-payable net-payable--neg'}>
                            {formatARS(totals.toCollect)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </section>

              {/* --- Transacciones --- */}
              <section>
                <p style={{ fontSize: '0.6875rem', color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>
                  Transacciones ({filteredTransactions.length})
                </p>
                {filteredTransactions.length === 0 ? (
                  <div className="empty-state"><p>Sin transacciones en este mes.</p></div>
                ) : (
                  <div className="admin-table-wrap" style={{ padding: 0, maxHeight: '260px', overflowY: 'auto' }}>
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>Fecha</th>
                          <th>Barbero</th>
                          <th>Servicio</th>
                          <th>Método</th>
                          <th>Monto</th>
                          <th>Comisión</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredTransactions.map((t) => (
                          <tr key={t.id}>
                            <td className="td-date">{formatDate(t.transaction_date)}</td>
                            <td>{t.barber.full_name}</td>
                            <td className="td-muted">{t.service?.name ?? '—'}</td>
                            <td>
                              <span className={`dot-badge dot-badge--${t.payment_method}`}>
                                {PAYMENT_METHOD_LABELS[t.payment_method]}
                              </span>
                            </td>
                            <td className="td-bold">{formatARS(t.amount)}</td>
                            <td className="td-amber">{formatARS(t.barber_share)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}
        </div>

        <div className="modal-footer">
          <button className="admin-btn admin-btn--ghost" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  )
}

function KpiMini({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ background: '#18181b', border: '1px solid #27272a', borderRadius: '0.625rem', padding: '0.625rem 0.75rem' }}>
      <p style={{ fontSize: '0.625rem', color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>{label}</p>
      <p style={{ fontSize: '1rem', fontWeight: 700, color: color ?? '#e4e4e7', margin: '0.25rem 0 0' }}>{value}</p>
    </div>
  )
}
