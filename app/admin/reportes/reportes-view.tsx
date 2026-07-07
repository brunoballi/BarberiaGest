'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
} from 'recharts'
import type { BranchReport } from '@/lib/supabase/database.types'
import {
  getReportByPeriod,
  getMonthsWithWeeks,
  getMonthFinancials,
  getBarberDebtSummary,
  type MonthFinancials,
} from '@/lib/supabase/supabase.client'
import type { BarberDebtSummary } from '@/lib/supabase/database.types'
import { getMyBranchesCached } from '@/lib/hooks/use-catalogs'
import { MONTH_NAMES } from '@/lib/supabase/supabase.client'
import CapitalInjectionsView from './capital-injections-view'
import './reportes.css'

// ── Utilidades ────────────────────────────────────────────────────
function formatARS(n: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(n)
}

function formatPct(n: number): string {
  return `${n >= 0 ? '' : ''}${n.toFixed(1)}%`
}

const EXPENSE_LABELS: Record<string, string> = {
  alquiler: 'Alquiler',
  servicios: 'Servicios',
  personal: 'Personal',
  insumos: 'Insumos',
  marketing: 'Marketing',
  impuestos: 'Impuestos',
  retiro_socio: 'Retiro de socios',
  otros: 'Otros',
  // categorías legacy que pudieran existir en datos antiguos
  productos: 'Productos',
  mantenimiento: 'Mantenimiento',
}

const PIE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899']

const BAR_COLORS = {
  totalIncome: '#3b82f6',
  branchShare: '#10b981',
  barberShare: '#f59e0b',
  totalExpenses: '#ef4444',
  netProfit: '#8b5cf6',
}

// ── Tooltip personalizado ─────────────────────────────────────────
function CustomTooltip({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ name: string; value: number; color: string }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="report-tooltip">
      <p className="report-tooltip__label">{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color }} className="report-tooltip__row">
          {p.name}: <strong>{formatARS(p.value)}</strong>
        </p>
      ))}
    </div>
  )
}

// ── Componente principal ──────────────────────────────────────────
export default function ReportesView() {
  const router = useRouter()
  const today = new Date()
  void router
  const [year, setYear]   = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)  // 1-12
  const [reports, setReports]   = useState<BranchReport[]>([])
  const [monthFins, setMonthFins] = useState<{ branchId: string; branchName: string; monthId: string; fin: MonthFinancials }[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  // Saldo deudor: liquidaciones confirmadas con deuda (independiente del período)
  type DebtRow = BarberDebtSummary & { branchId: string; branchName: string }
  const [debtRows, setDebtRows] = useState<DebtRow[]>([])
  const [multiBranch, setMultiBranch] = useState(false)

  const startDate = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay   = new Date(year, month, 0).getDate()
  const endDate   = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const myBranches = await getMyBranchesCached()
      setMultiBranch(myBranches.length > 1)
      if (myBranches.length === 0) { setReports([]); setMonthFins([]); setDebtRows([]); return }
      const data = await getReportByPeriod(myBranches, startDate, endDate)
      setReports(data)

      // Saldo deudor: liquidaciones confirmadas con deuda por sucursal
      const debtLists = await Promise.all(
        myBranches.map(async (b) => {
          const items = await getBarberDebtSummary(b.id)
          return items.map((it) => ({ ...it, branchId: b.id, branchName: b.name }))
        })
      )
      setDebtRows(debtLists.flat())

      // Detalle mensual (saldo inicial + comisiones + box + inyecciones − gastos = ganancia neta)
      const fins = await Promise.all(
        myBranches.map(async (b) => {
          const ms = await getMonthsWithWeeks(b.id)
          const mrow = ms.find((m) => m.year === year && m.month === month)
          if (!mrow) return null
          const fin = await getMonthFinancials(b.id, mrow.id)
          return { branchId: b.id, branchName: b.name, monthId: mrow.id, fin }
        })
      )
      setMonthFins(fins.filter((x): x is { branchId: string; branchName: string; monthId: string; fin: MonthFinancials } => x !== null))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar reportes')
    } finally {
      setLoading(false)
    }
  }, [startDate, endDate, year, month])

  useEffect(() => { load() }, [load])

  function prevMonth() {
    if (month === 1) { setMonth(12); setYear((y) => y - 1) }
    else setMonth((m) => m - 1)
  }
  function nextMonth() {
    const isCurrentMonth = year === today.getFullYear() && month === today.getMonth() + 1
    if (isCurrentMonth) return
    if (month === 12) { setMonth(1); setYear((y) => y + 1) }
    else setMonth((m) => m + 1)
  }
  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth() + 1

  // ── Totales consolidados ─────────────────────────────────────────
  const total: BranchReport = reports.reduce(
    (acc, r) => ({
      branchId: 'total',
      branchName: 'Total',
      cutCount:       acc.cutCount + r.cutCount,
      totalIncome:    acc.totalIncome + r.totalIncome,
      branchShare:    acc.branchShare + r.branchShare,
      barberShare:    acc.barberShare + r.barberShare,
      barbers:        acc.barbers,
      totalExpenses:  acc.totalExpenses + r.totalExpenses,
      expensesByCategory: acc.expensesByCategory,
      partnerWithdrawals: acc.partnerWithdrawals + r.partnerWithdrawals,
      netProfit:      acc.netProfit + r.netProfit,
      profitMargin:   0,
    }),
    { branchId: 'total', branchName: 'Total', cutCount: 0, totalIncome: 0, branchShare: 0, barberShare: 0, barbers: [], totalExpenses: 0, expensesByCategory: {}, partnerWithdrawals: 0, netProfit: 0, profitMargin: 0 }
  )
  total.profitMargin = total.totalIncome > 0 ? (total.netProfit / total.totalIncome) * 100 : 0
  const avg = {
    totalIncome:   reports.length ? total.totalIncome   / reports.length : 0,
    branchShare:   reports.length ? total.branchShare   / reports.length : 0,
    totalExpenses: reports.length ? total.totalExpenses / reports.length : 0,
    netProfit:     reports.length ? total.netProfit     / reports.length : 0,
    profitMargin:  reports.length ? reports.reduce((s, r) => s + r.profitMargin, 0) / reports.length : 0,
  }

  // ── Datos para BarChart ──────────────────────────────────────────
  // Total adeudado (suma de liquidaciones confirmadas con deuda)
  const totalDebt = debtRows.reduce((s, r) => s + r.debt, 0)

  // ── Datos para BarChart ──────────────────────────────────────────
  const barData = reports.map((r) => ({
    name: r.branchName,
    'Ingresos':        r.totalIncome,
    'Total barbería':  r.branchShare,
    'Total barberos':  r.barberShare,
    'Gastos':          r.totalExpenses,
    'Ganancia neta':   r.netProfit,
  }))

  if (loading) {
    return (
      <div className="report-loading">
        <div className="loader" />
        <p>Cargando reportes...</p>
      </div>
    )
  }

  if (error) {
    return <div className="report-error">{error}</div>
  }

  return (
    <div className="report-page">
      {/* ── Header ────────────────────────────────────────────── */}
      <div className="report-header">
        <div>
          <h1 className="report-title">Reportes</h1>
          <p className="report-subtitle">Rentabilidad por sucursal</p>
        </div>
        <div className="report-period">
          <button onClick={prevMonth} className="report-period__arrow">‹</button>
          <span className="report-period__label">
            {MONTH_NAMES[month - 1].toUpperCase()} {year}
          </span>
          <button
            onClick={nextMonth}
            className={`report-period__arrow ${isCurrentMonth ? 'report-period__arrow--disabled' : ''}`}
            disabled={isCurrentMonth}
          >›</button>
        </div>
      </div>

      {/* ── Historial de inversiones (inyección de dinero) ── */}
      {monthFins.length > 0 && (
        <section className="report-section">
          <h2 className="report-section__title">Historial de inversiones</h2>
          <div className="report-cards-grid">
            {monthFins.map(({ branchId, branchName, monthId }) => (
              <div key={branchId} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                <p className="font-bold text-zinc-100 mb-3">{branchName}</p>
                <CapitalInjectionsView
                  branchId={branchId}
                  monthId={monthId}
                  onInjectionChange={() => load()}
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Saldo deudor: liquidaciones confirmadas con deuda (solo lectura) ── */}
      <section className="report-section">
        <h2 className="report-section__title">Saldo deudor · liquidaciones confirmadas sin pagar</h2>
        <div style={{ background: '#18181b', border: '1px solid #27272a', borderRadius: 14, padding: '0.5rem 0.75rem', overflowX: 'auto' }}>
          {debtRows.length === 0 ? (
            <p style={{ color: '#71717a', fontSize: '0.85rem', textAlign: 'center', padding: '1.5rem 0' }}>
              No hay liquidaciones con deuda pendiente. Se saldan marcándolas como pagadas desde Liquidaciones.
            </p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ color: '#71717a' }}>
                  <th style={{ padding: '0.5rem', textAlign: 'left' }}>Barbero</th>
                  {multiBranch && <th style={{ padding: '0.5rem', textAlign: 'left' }}>Sucursal</th>}
                  <th style={{ padding: '0.5rem', textAlign: 'left' }}>Semana</th>
                  <th style={{ padding: '0.5rem', textAlign: 'right' }}>Debe</th>
                </tr>
              </thead>
              <tbody>
                {debtRows.map((r) => (
                  <tr key={r.settlementId} style={{ borderTop: '1px solid #27272a' }}>
                    <td style={{ padding: '0.6rem 0.5rem', color: '#e4e4e7', fontWeight: 600 }}>{r.fullName}</td>
                    {multiBranch && <td style={{ padding: '0.6rem 0.5rem', color: '#a1a1aa' }}>{r.branchName}</td>}
                    <td style={{ padding: '0.6rem 0.5rem', color: '#a1a1aa' }}>{r.weekStart} → {r.weekEnd}</td>
                    <td style={{ padding: '0.6rem 0.5rem', textAlign: 'right', color: '#f87171', fontWeight: 700 }}>{formatARS(r.debt)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid #3f3f46' }}>
                  <td colSpan={multiBranch ? 3 : 2} style={{ padding: '0.6rem 0.5rem', color: '#a1a1aa', fontWeight: 700 }}>Total adeudado</td>
                  <td style={{ padding: '0.6rem 0.5rem', textAlign: 'right', color: '#f87171', fontWeight: 800 }}>{formatARS(totalDebt)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </section>

      {reports.every((r) => r.cutCount === 0 && r.totalIncome === 0) ? (
        <div className="report-empty">Sin datos para este período</div>
      ) : (
        <>
          {/* ── Tarjetas por sucursal ──────────────────────────── */}
          <h2 className="report-section__title">Ganancia Neta por Sucursal</h2>
          <div className="report-cards-grid">
            {reports.map((r) => (
              <div key={r.branchId} className="report-card">
                <p className="report-card__name">{r.branchName}</p>
                <div className="report-card__metrics">
                  <MetricRow label="Cortes" value={String(r.cutCount)} small />
                  <MetricRow label="Ingresos totales"  value={formatARS(r.totalIncome)} color="blue" />
                  <MetricRow label="Total barbería"    value={formatARS(r.branchShare)} color="emerald" />
                  <BarberBreakdownRow barbers={r.barbers} total={r.barberShare} />
                  <MetricRow label="Gastos"            value={formatARS(r.totalExpenses)} color="red" />
                  <div className="report-card__divider" />
                  <MetricRow
                    label="Ganancia neta"
                    value={formatARS(r.netProfit)}
                    color={r.netProfit >= 0 ? 'violet' : 'red'}
                    bold
                  />
                  <MetricRow
                    label="Margen"
                    value={formatPct(r.profitMargin)}
                    color={r.profitMargin >= 0 ? 'emerald' : 'red'}
                    bold
                  />
                  {r.partnerWithdrawals > 0 && (
                    <>
                      <div className="report-card__divider" />
                      <MetricRow label="Retiros de socios" value={formatARS(r.partnerWithdrawals)} color="amber" small />
                    </>
                  )}
                </div>
              </div>
            ))}

            {/* Tarjeta consolidada */}
            <div className="report-card report-card--total">
              <p className="report-card__name">Consolidado</p>
              <div className="report-card__metrics">
                <MetricRow label="Cortes total"       value={String(total.cutCount)} small />
                <MetricRow label="Ingresos totales"   value={formatARS(total.totalIncome)} color="blue" />
                <MetricRow label="Total barbería"     value={formatARS(total.branchShare)} color="emerald" />
                <MetricRow label="Total barberos"     value={formatARS(total.barberShare)} color="amber" />
                <MetricRow label="Gastos"             value={formatARS(total.totalExpenses)} color="red" />
                <div className="report-card__divider" />
                <MetricRow label="Ganancia neta"      value={formatARS(total.netProfit)} color={total.netProfit >= 0 ? 'violet' : 'red'} bold />
                <MetricRow label="Margen promedio"    value={formatPct(avg.profitMargin)} color={avg.profitMargin >= 0 ? 'emerald' : 'red'} bold />
                {total.partnerWithdrawals > 0 && (
                  <MetricRow label="Retiros de socios" value={formatARS(total.partnerWithdrawals)} color="amber" small />
                )}
                <div className="report-card__divider" />
                <p className="report-card__avg-title">Promedio por sucursal</p>
                <MetricRow label="Ing. promedio"   value={formatARS(avg.totalIncome)} small />
                <MetricRow label="Gan. promedio"   value={formatARS(avg.netProfit)} small />
              </div>
            </div>
          </div>

          {/* ── Gráfico comparativo ────────────────────────────── */}
          {barData.length > 0 && (
            <div className="report-section">
              <h2 className="report-section__title">Comparativa por sucursal</h2>
              <div className={`report-chart-box ${reports.length === 1 ? 'report-chart-box--single' : reports.length <= 3 ? 'report-chart-box--few' : ''}`}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={barData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                    <XAxis dataKey="name" tick={{ fill: '#71717a', fontSize: 12 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false}
                      tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                    <Legend wrapperStyle={{ fontSize: 12, color: '#a1a1aa', paddingTop: 16 }} />
                    <Bar dataKey="Ingresos"       fill={BAR_COLORS.totalIncome}  radius={[3,3,0,0]} />
                    <Bar dataKey="Total barbería" fill={BAR_COLORS.branchShare}  radius={[3,3,0,0]} />
                    <Bar dataKey="Total barberos" fill={BAR_COLORS.barberShare}  radius={[3,3,0,0]} />
                    <Bar dataKey="Gastos"        fill={BAR_COLORS.totalExpenses} radius={[3,3,0,0]} />
                    <Bar dataKey="Ganancia neta" fill={BAR_COLORS.netProfit}    radius={[3,3,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* ── Desglose de gastos por sucursal ───────────────── */}
          <div className="report-section">
            <h2 className="report-section__title">Desglose de gastos</h2>
            <div className="report-pie-grid">
              {reports.map((r) => {
                const pieData = Object.entries(r.expensesByCategory).map(([cat, val]) => ({
                  name: EXPENSE_LABELS[cat] ?? cat,
                  value: val,
                }))
                return (
                  <div key={r.branchId} className="report-pie-card">
                    <p className="report-pie-card__name">{r.branchName}</p>
                    {pieData.length === 0 ? (
                      <p className="report-pie-card__empty">Sin gastos registrados</p>
                    ) : (
                      <>
                        <ResponsiveContainer width="100%" height={200}>
                          <PieChart>
                            <Pie
                              data={pieData}
                              cx="50%"
                              cy="50%"
                              innerRadius={55}
                              outerRadius={85}
                              paddingAngle={3}
                              dataKey="value"
                            >
                              {pieData.map((_, i) => (
                                <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                              ))}
                            </Pie>
                            <Tooltip formatter={(v) => formatARS(v as number)} />
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="report-pie-legend">
                          {pieData.map((entry, i) => (
                            <div key={entry.name} className="report-pie-legend__row">
                              <span className="report-pie-legend__dot" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                              <span className="report-pie-legend__label">{entry.name}</span>
                              <span className="report-pie-legend__value">{formatARS(entry.value)}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Sub-componente: fila de métrica ───────────────────────────────
function MetricRow({ label, value, color, bold, small }: {
  label: string
  value: string
  color?: 'blue' | 'emerald' | 'amber' | 'red' | 'violet'
  bold?: boolean
  small?: boolean
}) {
  const colorClass: Record<string, string> = {
    blue:    '#3b82f6',
    emerald: '#10b981',
    amber:   '#f59e0b',
    red:     '#ef4444',
    violet:  '#8b5cf6',
  }
  return (
    <div className="metric-row">
      <span className="metric-row__label" style={{ fontSize: small ? '0.72rem' : undefined }}>{label}</span>
      <span
        className="metric-row__value"
        style={{
          color: color ? colorClass[color] : '#e4e4e7',
          fontWeight: bold ? 700 : 500,
          fontSize: small ? '0.8rem' : undefined,
        }}
      >
        {value}
      </span>
    </div>
  )
}

// ── Total barberos con desplegable por barbero ────────────────────
function BarberBreakdownRow({ barbers, total }: {
  barbers: { barberId: string; fullName: string; total: number }[]
  total: number
}) {
  const [open, setOpen] = useState(false)
  const hasBreakdown = barbers.length > 0
  return (
    <>
      <div
        className="metric-row"
        style={{ cursor: hasBreakdown ? 'pointer' : 'default' }}
        onClick={() => hasBreakdown && setOpen((o) => !o)}
      >
        <span className="metric-row__label" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          {hasBreakdown && <span style={{ fontSize: '0.6rem', color: '#71717a' }}>{open ? '▼' : '▶'}</span>}
          Total barberos
        </span>
        <span className="metric-row__value" style={{ color: '#f59e0b', fontWeight: 500 }}>
          {formatARS(total)}
        </span>
      </div>
      {open && hasBreakdown && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', margin: '0.1rem 0 0.3rem', paddingLeft: '0.9rem', borderLeft: '2px solid #27272a' }}>
          {barbers.map((b) => (
            <div key={b.barberId} className="metric-row">
              <span className="metric-row__label" style={{ fontSize: '0.72rem', color: '#a1a1aa' }}>{b.fullName}</span>
              <span className="metric-row__value" style={{ fontSize: '0.78rem', color: '#d4d4d8' }}>{formatARS(b.total)}</span>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
