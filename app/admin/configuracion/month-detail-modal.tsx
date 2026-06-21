'use client'

// ============================================================
// DETAIL MODAL — Detalle del mes por barbero
// Carga todas las semanas del mes y filtra en cliente por barbero.
// La grilla muestra el desglose por semana (fijo). KPIs + donut de
// cortes por servicio + export PDF.
// ============================================================
import { useState, useMemo } from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import type {
  Month,
  Week,
  TransactionWithRelations,
  SettlementWithBarber,
} from '@/lib/supabase/database.types'
import { PAYMENT_METHOD_LABELS } from '@/lib/supabase/database.types'
import { MONTH_NAMES } from '@/lib/supabase/supabase.client'
import { generateMonthReport } from '@/lib/pdf/month-report'

const SERVICE_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#eab308', '#3b82f6', '#f97316']

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

/** Parte de la barbería para una liquidación: facturado − (comisión barbero + bonos). */
function branchShareOf(s: SettlementWithBarber): number {
  return s.gross_amount - s.barber_gross - s.bonus_presentismo - s.bonus_objetivo
}

export interface MonthDetailData {
  transactions: TransactionWithRelations[]
  settlements: SettlementWithBarber[]
}

interface WeekAgg {
  weekId: string
  label: string
  range: string
  cuts: number
  billed: number
  commission: number  // lo que se lleva el barbero (total_earned)
  branch: number      // lo que se lleva la barbería (branch share)
}

interface MonthDetailModalProps {
  month: Month
  weeks: Week[]
  branchName: string
  data: MonthDetailData | null
  loading: boolean
  onClose: () => void
}

const ALL = '__all__'

export default function MonthDetailModal({ month, weeks, branchName, data, loading, onClose }: MonthDetailModalProps) {
  const monthName = MONTH_NAMES[month.month - 1]
  const monthLabel = `${monthName} ${month.year}`
  const [barberFilter, setBarberFilter] = useState<string>(ALL)

  // Semanas del mes ordenadas (para las filas fijas de la grilla)
  const sortedWeeks = useMemo(
    () => [...weeks].sort((a, b) => a.week_number - b.week_number),
    [weeks]
  )

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
    return data.settlements.filter((s) => barberFilter === ALL || s.barber_id === barberFilter)
  }, [data, barberFilter])

  const filteredTransactions = useMemo(() => {
    if (!data) return []
    const txs = data.transactions.filter((t) => barberFilter === ALL || t.barber_id === barberFilter)
    return [...txs].sort((a, b) => {
      const d = b.transaction_date.localeCompare(a.transaction_date)
      return d !== 0 ? d : b.created_at.localeCompare(a.created_at)
    })
  }, [data, barberFilter])

  // Desglose por semana (filas fijas de la grilla)
  const weekRows = useMemo<WeekAgg[]>(() => {
    return sortedWeeks.map((w) => {
      const agg = filteredSettlements
        .filter((s) => s.week_id === w.id)
        .reduce(
          (acc, s) => ({
            cuts: acc.cuts + s.total_cuts,
            billed: acc.billed + s.gross_amount,
            commission: acc.commission + s.total_earned,
            branch: acc.branch + branchShareOf(s),
          }),
          { cuts: 0, billed: 0, commission: 0, branch: 0 }
        )
      return {
        weekId: w.id,
        label: `Semana ${w.week_number}`,
        range: `${formatDate(w.start_date)}–${formatDate(w.end_date)}`,
        ...agg,
      }
    })
  }, [sortedWeeks, filteredSettlements])

  // Cortes por servicio (donut)
  const cortesPorServicio = useMemo(() => {
    const map = new Map<string, number>()
    for (const t of filteredTransactions) {
      const name = t.service?.name ?? 'Sin servicio'
      map.set(name, (map.get(name) ?? 0) + 1)
    }
    return [...map.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
  }, [filteredTransactions])

  // Totales de negocio
  const totals = useMemo(() => filteredSettlements.reduce(
    (acc, s) => ({
      cuts: acc.cuts + s.total_cuts,
      billed: acc.billed + s.gross_amount,
      commission: acc.commission + s.total_earned,
      toCollect: acc.toCollect + s.net_payable,
      branch: acc.branch + branchShareOf(s),
    }),
    { cuts: 0, billed: 0, commission: 0, toCollect: 0, branch: 0 }
  ), [filteredSettlements])

  const totalCuts = filteredTransactions.length

  function handleDownloadPdf() {
    generateMonthReport({
      monthLabel,
      branchName,
      barberFilterLabel: barberFilter === ALL ? 'Todos los barberos' : barbers.find((b) => b.id === barberFilter)?.name,
      rows: weekRows.map((r) => ({
        label: r.label, cuts: r.cuts, billed: r.billed, commission: r.commission, branch: r.branch,
      })),
      transactions: filteredTransactions.map((t) => ({
        date: formatDate(t.transaction_date),
        barberName: t.barber.full_name,
        service: t.service?.name ?? '—',
        method: PAYMENT_METHOD_LABELS[t.payment_method],
        amount: t.amount,
        commission: t.barber_share,
      })),
    })
  }

  const selectStyle = {
    background: '#18181b', color: '#e4e4e7', border: '1px solid #3f3f46',
    borderRadius: '0.5rem', padding: '0.4rem 0.7rem', fontSize: '0.8125rem',
  } as const

  return (
    <div className="modal-overlay">
      <div className="modal-box" style={{ maxWidth: '820px', width: '100%' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>
            Detalle · {monthLabel}
            <span style={{ marginLeft: '0.75rem', fontSize: '0.75rem', fontWeight: 400, color: '#71717a' }}>
              desglose por semana
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
              {/* --- Filtro barbero + PDF --- */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <label style={{ fontSize: '0.75rem', color: '#71717a' }}>Barbero</label>
                  <select value={barberFilter} onChange={(e) => setBarberFilter(e.target.value)} style={selectStyle}>
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
                  disabled={totalCuts === 0}
                >
                  ⬇ Descargar PDF
                </button>
              </div>

              {/* --- Resumen (totales arriba) --- */}
              <section>
                <p style={{ fontSize: '0.6875rem', color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.75rem' }}>
                  Resumen
                </p>

                {/* Cortes por servicio (donut) */}
                <div style={{ background: '#18181b', border: '1px solid #27272a', borderRadius: '0.625rem', padding: '0.75rem 1rem', marginBottom: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                    <div>
                      <p style={{ fontSize: '0.625rem', color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>Cortes</p>
                      <p style={{ fontSize: '1.75rem', fontWeight: 800, color: '#e4e4e7', margin: '0.1rem 0 0' }}>{totalCuts}</p>
                    </div>
                    {cortesPorServicio.length > 0 && (
                      <>
                        <div style={{ width: 140, height: 140, flex: '0 0 auto' }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={cortesPorServicio}
                                dataKey="count"
                                nameKey="name"
                                cx="50%" cy="50%"
                                innerRadius={42}
                                outerRadius={66}
                                paddingAngle={2}
                                stroke="none"
                              >
                                {cortesPorServicio.map((_, i) => (
                                  <Cell key={i} fill={SERVICE_COLORS[i % SERVICE_COLORS.length]} />
                                ))}
                              </Pie>
                              <Tooltip
                                formatter={(v, n) => [`${v} cortes`, n]}
                                contentStyle={{ background: '#0f0f0f', border: '1px solid #3f3f46', borderRadius: 8, fontSize: '0.75rem' }}
                              />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                        <div style={{ flex: 1, minWidth: 180, display: 'flex', flexDirection: 'column', gap: '0.3rem', maxHeight: '9rem', overflowY: 'auto' }}>
                          {cortesPorServicio.map((c, i) => (
                            <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem' }}>
                              <span style={{ width: 10, height: 10, borderRadius: 3, background: SERVICE_COLORS[i % SERVICE_COLORS.length], flex: '0 0 auto' }} />
                              <span style={{ color: '#a1a1aa', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                              <span style={{ color: '#e4e4e7', fontWeight: 700 }}>×{c.count}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Totales de plata */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <KpiMini label="Facturado" value={formatARS(totals.billed)} />
                  <KpiMini label="Total barbero" value={formatARS(totals.commission)} color="#f59e0b" />
                  <KpiMini label="Total barbería" value={formatARS(totals.branch)} color="#34d399" />
                </div>
              </section>

              {/* --- Por semana (filas fijas) --- */}
              <section>
                <p style={{ fontSize: '0.6875rem', color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>
                  Por semana
                </p>
                {weekRows.length === 0 ? (
                  <div className="empty-state"><p>Sin semanas en este mes.</p></div>
                ) : (
                  <div className="admin-table-wrap" style={{ padding: 0 }}>
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>Semana</th>
                          <th>Cortes</th>
                          <th>Facturado</th>
                          <th>Comisión</th>
                          <th>Barbería</th>
                        </tr>
                      </thead>
                      <tbody>
                        {weekRows.map((row) => (
                          <tr key={row.weekId}>
                            <td>
                              {row.label}
                              <span style={{ display: 'block', fontSize: '0.7rem', color: '#71717a' }}>{row.range}</span>
                            </td>
                            <td className="td-center">{row.cuts}</td>
                            <td>{formatARS(row.billed)}</td>
                            <td style={{ color: '#f59e0b', fontWeight: 600 }}>{formatARS(row.commission)}</td>
                            <td style={{ color: '#34d399', fontWeight: 600 }}>{formatARS(row.branch)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={{ borderTop: '2px solid #3f3f46', fontWeight: 700 }}>
                          <td>TOTAL</td>
                          <td className="td-center">{totals.cuts}</td>
                          <td>{formatARS(totals.billed)}</td>
                          <td style={{ color: '#f59e0b' }}>{formatARS(totals.commission)}</td>
                          <td style={{ color: '#34d399' }}>{formatARS(totals.branch)}</td>
                        </tr>
                      </tfoot>
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
