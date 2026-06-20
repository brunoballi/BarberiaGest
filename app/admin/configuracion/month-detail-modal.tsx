'use client'

// ============================================================
// DETAIL MODAL — Detalle de mes/semana por barbero
// Carga todas las semanas del mes y filtra en cliente por barbero
// y por semana. KPIs de negocio + tabla por barbero + export PDF.
// ============================================================
import { useState, useMemo } from 'react'
import type {
  Month,
  Week,
  TransactionWithRelations,
  SettlementWithBarber,
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

/** Parte de la barbería para una liquidación: facturado − (comisión barbero + bonos). */
function branchShareOf(s: SettlementWithBarber): number {
  return s.gross_amount - s.barber_gross - s.bonus_presentismo - s.bonus_objetivo
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
  weeks: Week[]
  branchName: string
  data: MonthDetailData | null
  loading: boolean
  initialWeekId?: string | null
  onClose: () => void
}

const ALL = '__all__'

export default function MonthDetailModal({ month, weeks, branchName, data, loading, initialWeekId, onClose }: MonthDetailModalProps) {
  const monthName = MONTH_NAMES[month.month - 1]
  const monthLabel = `${monthName} ${month.year}`
  const [barberFilter, setBarberFilter] = useState<string>(ALL)
  const [weekFilter, setWeekFilter] = useState<string>(initialWeekId ?? ALL)

  // Etiqueta de la semana seleccionada (para títulos/PDF)
  const weekLabel = useMemo(() => {
    if (weekFilter === ALL) return 'Todas las semanas'
    const w = weeks.find((x) => x.id === weekFilter)
    return w ? `Semana ${w.week_number}` : 'Semana'
  }, [weekFilter, weeks])

  // Lista de barberos únicos del mes (para el dropdown)
  const barbers = useMemo(() => {
    if (!data) return [] as { id: string; name: string }[]
    const map = new Map<string, string>()
    for (const s of data.settlements) map.set(s.barber_id, s.barber.full_name)
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [data])

  // Settlements/transacciones filtrados por barbero + semana
  const filteredSettlements = useMemo(() => {
    if (!data) return []
    return data.settlements.filter((s) =>
      (barberFilter === ALL || s.barber_id === barberFilter) &&
      (weekFilter === ALL || s.week_id === weekFilter)
    )
  }, [data, barberFilter, weekFilter])

  const filteredTransactions = useMemo(() => {
    if (!data) return []
    const txs = data.transactions.filter((t) =>
      (barberFilter === ALL || t.barber_id === barberFilter) &&
      (weekFilter === ALL || t.week_id === weekFilter)
    )
    // Ordenar por fecha (más reciente primero); las semanas vienen concatenadas.
    return [...txs].sort((a, b) => {
      const d = b.transaction_date.localeCompare(a.transaction_date)
      return d !== 0 ? d : b.created_at.localeCompare(a.created_at)
    })
  }, [data, barberFilter, weekFilter])

  // Acumulado por barbero
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

  // Cortes por servicio (desglose dentro de la tarjeta de Cortes)
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
  const totals = useMemo(() => {
    const t = filteredSettlements.reduce(
      (acc, s) => ({
        cuts: acc.cuts + s.total_cuts,
        billed: acc.billed + s.gross_amount,
        commission: acc.commission + s.total_earned,
        toCollect: acc.toCollect + s.net_payable,
        branch: acc.branch + branchShareOf(s),
      }),
      { cuts: 0, billed: 0, commission: 0, toCollect: 0, branch: 0 }
    )
    return t
  }, [filteredSettlements])

  const totalCuts = filteredTransactions.length

  function handleDownloadPdf() {
    const filterParts = [
      barberFilter === ALL ? 'Todos los barberos' : barbers.find((b) => b.id === barberFilter)?.name,
      weekLabel,
    ].filter(Boolean)
    generateMonthReport({
      monthLabel: weekFilter === ALL ? monthLabel : `${monthLabel} · ${weekLabel}`,
      branchName,
      barberFilterLabel: filterParts.join(' · '),
      rows: barberRows.map((r) => ({
        barberName: r.barberName,
        cuts: r.cuts,
        billed: r.billed,
        commission: r.commission,
        toCollect: r.toCollect,
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
              {weekLabel === 'Todas las semanas' ? 'acumulado del mes' : weekLabel}
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
              {/* --- Filtros + PDF --- */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <label style={{ fontSize: '0.75rem', color: '#71717a' }}>Barbero</label>
                    <select value={barberFilter} onChange={(e) => setBarberFilter(e.target.value)} style={selectStyle}>
                      <option value={ALL}>Ver todos</option>
                      {barbers.map((b) => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <label style={{ fontSize: '0.75rem', color: '#71717a' }}>Semana</label>
                    <select value={weekFilter} onChange={(e) => setWeekFilter(e.target.value)} style={selectStyle}>
                      <option value={ALL}>Todas las semanas</option>
                      {weeks.map((w) => (
                        <option key={w.id} value={w.id}>
                          S{w.week_number} · {formatDate(w.start_date)}–{formatDate(w.end_date)}
                        </option>
                      ))}
                    </select>
                  </div>
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
                  Resumen
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" style={{ alignItems: 'start' }}>
                  <KpiMini label="Cortes" value={String(totalCuts)}>
                    {cortesPorServicio.length > 0 && (
                      <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.2rem', maxHeight: '8rem', overflowY: 'auto' }}>
                        {cortesPorServicio.map((c) => (
                          <div key={c.name} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', fontSize: '0.7rem' }}>
                            <span style={{ color: '#a1a1aa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                            <span style={{ color: '#e4e4e7', fontWeight: 600 }}>×{c.count}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </KpiMini>
                  <KpiMini label="Facturado" value={formatARS(totals.billed)} />
                  <KpiMini label="Total barbero" value={formatARS(totals.commission)} color="#f59e0b" />
                  <KpiMini label="Total barbería" value={formatARS(totals.branch)} color="#34d399" />
                </div>
              </section>

              {/* --- Por barbero --- */}
              <section>
                <p style={{ fontSize: '0.6875rem', color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>
                  Por barbero
                </p>
                {barberRows.length === 0 ? (
                  <div className="empty-state"><p>Sin datos para este período.</p></div>
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

function KpiMini({ label, value, color, children }: { label: string; value: string; color?: string; children?: React.ReactNode }) {
  return (
    <div style={{ background: '#18181b', border: '1px solid #27272a', borderRadius: '0.625rem', padding: '0.625rem 0.75rem' }}>
      <p style={{ fontSize: '0.625rem', color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>{label}</p>
      <p style={{ fontSize: '1rem', fontWeight: 700, color: color ?? '#e4e4e7', margin: '0.25rem 0 0' }}>{value}</p>
      {children}
    </div>
  )
}
