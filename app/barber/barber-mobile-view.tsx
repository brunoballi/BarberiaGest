'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  type Profile,
  type Transaction,
  type Week,
  type ServiceCatalog,
  type SettlementWithBarber,
  type PaymentMethod,
  type RegisterCutPayload,
  PAYMENT_METHOD_LABELS,
  SETTLEMENT_STATUS_LABELS,
} from '@/lib/supabase/database.types'
import {
  getCurrentProfile,
  getOpenWeek,
  getBarberTransactionsForWeek,
  getBarberTransactionsByDateRange,
  getBarberSettlements,
  getServicesByBranch,
  registerCut,
  updateTransaction,
  createAdvance,
  todayLocal,
  supabase,
} from '@/lib/supabase/supabase.client'
import './barber.css'

// ─── Utilidades ───────────────────────────────────────────────────────────
function formatARS(amount: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(amount)
}

function formatDate(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

// ─── Íconos inline SVG ────────────────────────────────────────────────────
const IconScissors = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-6 h-6">
    <circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
    <line x1="20" y1="4" x2="8.12" y2="15.88"/>
    <line x1="14.47" y1="14.48" x2="20" y2="20"/>
    <line x1="8.12" y1="8.12" x2="12" y2="12"/>
  </svg>
)
const IconCash = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-7 h-7">
    <rect x="2" y="6" width="20" height="12" rx="2"/>
    <circle cx="12" cy="12" r="3"/>
    <path d="M6 12h.01M18 12h.01"/>
  </svg>
)
const IconTransfer = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-7 h-7">
    <path d="M8 7h12M8 12h12M8 17h12M4 7h.01M4 12h.01M4 17h.01"/>
  </svg>
)
const IconCard = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-7 h-7">
    <rect x="2" y="5" width="20" height="14" rx="2"/>
    <line x1="2" y1="10" x2="22" y2="10"/>
    <line x1="6" y1="15" x2="10" y2="15"/>
  </svg>
)
const IconAdvance = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-7 h-7">
    <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
  </svg>
)
const IconCheck = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-8 h-8">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
)
const IconBack = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
    <polyline points="15 18 9 12 15 6"/>
  </svg>
)
const IconLogout = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
    <polyline points="16 17 21 12 16 7"/>
    <line x1="21" y1="12" x2="9" y2="12"/>
  </svg>
)

type ServiceOption = { id?: string; name: string; base_price: number; is_active: boolean }

const DEFAULT_SERVICES: ServiceOption[] = [
  { name: 'Corte', base_price: 15000, is_active: true },
  { name: 'Barba', base_price: 8000, is_active: true },
  { name: 'Combo', base_price: 20000, is_active: true },
  { name: 'Degradé', base_price: 18000, is_active: true },
  { name: 'Cejas', base_price: 5000, is_active: true },
  { name: 'Otro', base_price: 0, is_active: true },
]

type View = 'home' | 'register' | 'success' | 'settlements'

// ─────────────────────────────────────────────────────────────────────────
// COMPONENTE PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────
export default function BarberMobileView() {
  const [view, setView] = useState<View>('home')
  const [profile, setProfile] = useState<Profile | null>(null)
  const [week, setWeek] = useState<Week | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [services, setServices] = useState<ServiceOption[]>(DEFAULT_SERVICES)
  const [settlements, setSettlements] = useState<SettlementWithBarber[]>([])
  const [settlementsLoaded, setSettlementsLoaded] = useState(false)
  const [settlementsLoading, setSettlementsLoading] = useState(false)
  const [selectedService, setSelectedService] = useState<string>('')
  const [customAmount, setCustomAmount] = useState<string>('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [lastRegistered, setLastRegistered] = useState<Transaction | null>(null)
  const [keepCash, setKeepCash] = useState(false)

  // NEW: split payment + cliente + descuento
  const [splitMode, setSplitMode] = useState(false)
  const [splitCash, setSplitCash] = useState<string>('')      // monto en efectivo cuando hay split
  const [splitTransfer, setSplitTransfer] = useState<string>('') // monto transferencia cuando hay split
  const [clientName, setClientName] = useState<string>('')
  const [discountAmount, setDiscountAmount] = useState<string>('')
  const [discountReason, setDiscountReason] = useState<string>('')

  // Día seleccionado en la grilla de la semana (default: hoy)
  const [selectedDay, setSelectedDay] = useState<string>('')  // YYYY-MM-DD

  // Filtro avanzado por rango (opcional)
  const [showRangeFilter, setShowRangeFilter] = useState(false)
  const [filterFrom, setFilterFrom] = useState<string>('')  // YYYY-MM-DD
  const [filterTo, setFilterTo]     = useState<string>('')  // YYYY-MM-DD
  const [filteredTxs, setFilteredTxs] = useState<Transaction[] | null>(null)
  const [filterLoading, setFilterLoading] = useState(false)
  const [filterMode, setFilterMode] = useState<'week' | 'range'>('week')

  // Advance request
  const [showAdvanceModal, setShowAdvanceModal] = useState(false)
  const [advanceAmount, setAdvanceAmount] = useState('')
  const [advanceReason, setAdvanceReason] = useState('')
  const [advanceSubmitting, setAdvanceSubmitting] = useState(false)
  const [advanceError, setAdvanceError] = useState<string | null>(null)
  const [advanceDone, setAdvanceDone] = useState(false)

  // Edit transaction
  const [editingTx, setEditingTx] = useState<Transaction | null>(null)
  const [editSvc, setEditSvc] = useState<string>('')
  const [editAmount, setEditAmount] = useState<string>('')
  const [editMethod, setEditMethod] = useState<PaymentMethod | null>(null)
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const p = await getCurrentProfile()
      if (!p) { setError('No autenticado'); return }
      setProfile(p)

      // Servicios y semana en paralelo — ahorra 1 round-trip
      const [svcs, w] = await Promise.all([
        getServicesByBranch(p.branch_id),
        getOpenWeek(p.branch_id),
      ])

      const active = svcs.filter((s) => s.is_active)
      if (active.length > 0) setServices(active)

      if (!w) { setError('No hay semana abierta. Contactá al admin.'); return }
      setWeek(w)

      const txs = await getBarberTransactionsForWeek(p.id, w.id)
      setTransactions(txs)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  async function goToSettlements() {
    setView('settlements')
    if (settlementsLoaded || !profile) return
    setSettlementsLoading(true)
    try {
      const data = await getBarberSettlements(profile.id)
      setSettlements(data)
      setSettlementsLoaded(true)
    } catch {
      // silently ignore — list will be empty
    } finally {
      setSettlementsLoading(false)
    }
  }

  const today = todayLocal()
  const todayTxs = transactions.filter((t) => t.transaction_date === today)
  const todayTotal = todayTxs.reduce((s, t) => s + t.amount, 0)
  const todayBarber = todayTxs.reduce((s, t) => s + t.barber_share, 0)

  // ── Días de la semana (Lun a Dom) según week.start_date ───────────
  const DAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
  const weekDays: { date: string; label: string; dayNum: number; isToday: boolean }[] = (() => {
    if (!week) return []
    const [y, m, d] = week.start_date.split('-').map(Number)
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(y, m - 1, d + i)
      const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      return {
        date: dateStr,
        label: DAY_LABELS[i],
        dayNum: date.getDate(),
        isToday: dateStr === today,
      }
    })
  })()

  // Asegurar selectedDay inicial = hoy (o el primer día de la semana si hoy no cae)
  useEffect(() => {
    if (!selectedDay && weekDays.length > 0) {
      const todayInWeek = weekDays.find((d) => d.isToday)
      setSelectedDay(todayInWeek ? todayInWeek.date : weekDays[0].date)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week?.id])

  // Transacciones agrupadas por día (de la semana actual)
  const txsByDay: Record<string, Transaction[]> = transactions.reduce<Record<string, Transaction[]>>((acc, t) => {
    (acc[t.transaction_date] ||= []).push(t)
    return acc
  }, {})

  // Cortes del día seleccionado
  const dayTxs = txsByDay[selectedDay] ?? []
  const dayTotal = dayTxs.reduce((s, t) => s + t.amount, 0)
  const dayBarber = dayTxs.reduce((s, t) => s + t.barber_share, 0)
  const weekTotal = transactions.reduce((s, t) => s + t.amount, 0)
  const weekBarber = transactions.reduce((s, t) => s + t.barber_share, 0)
  const weekCuts = transactions.length

  const selectedServiceData = services.find((s) => s.name === selectedService)
  const resolvedAmount = customAmount
    ? parseFloat(customAmount)
    : selectedServiceData?.base_price ?? 0

  const commissionRate = profile?.commission_rate ?? 0.5
  // Aplicar descuento al amount efectivo
  const discountNum = parseFloat(discountAmount) || 0
  const effectiveAmount = Math.max(0, resolvedAmount - discountNum)
  const previewBarberShare = Math.round(effectiveAmount * commissionRate)
  // Split parsing
  const splitCashNum     = parseFloat(splitCash)     || 0
  const splitTransferNum = parseFloat(splitTransfer) || 0
  const splitSum         = splitCashNum + splitTransferNum
  const splitValid       = !splitMode || Math.abs(splitSum - effectiveAmount) < 0.01
  // Cash portion del corte: si es split usamos lo escrito, si no es split y método es cash → todo va a cash
  const previewCashPortion = splitMode ? splitCashNum : (paymentMethod === 'cash' ? effectiveAmount : 0)
  // already_collected en preview: si keepCash y hay cash, barber se queda con SU parte de la porción cash
  const previewAlreadyCollected =
    keepCash && previewCashPortion > 0
      ? Math.round(previewCashPortion * commissionRate)
      : 0

  async function handleSubmit() {
    if (!profile || !week || !selectedService || !paymentMethod || effectiveAmount <= 0) return
    if (splitMode && !splitValid) {
      setError(`La suma del split (${splitSum}) no coincide con el total (${effectiveAmount})`)
      return
    }
    // Validar que sigue siendo el mismo día (protege si el form quedó abierto hasta medianoche)
    const nowDate = todayLocal()
    if (nowDate !== today) {
      setError('El día cambió. Recargá la app para continuar.')
      return
    }
    try {
      setSubmitting(true)
      // Calcular cash/transfer/card según modo
      const cashAmt     = splitMode ? splitCashNum     : (paymentMethod === 'cash'     ? effectiveAmount : 0)
      const transferAmt = splitMode ? splitTransferNum : (paymentMethod === 'transfer' ? effectiveAmount : 0)
      const cardAmt     = !splitMode && paymentMethod === 'card' ? effectiveAmount : 0

      // barber_already_collected: el barbero se queda con SU parte de la porción cash si activó el toggle
      const cashShareForBarber = Math.round(cashAmt * commissionRate)

      const payload: RegisterCutPayload = {
        service_id: selectedServiceData?.id ?? null,
        amount: effectiveAmount,
        payment_method: paymentMethod,
        transaction_date: today,
        cash_amount: cashAmt,
        transfer_amount: transferAmt,
        card_amount: cardAmt,
        client_name: clientName.trim() || null,
        discount_amount: discountNum > 0 ? discountNum : 0,
        discount_reason: discountReason.trim() || null,
        ...(keepCash && cashAmt > 0
          ? { barber_already_collected_override: cashShareForBarber }
          : {}),
      }
      const tx = await registerCut(payload, profile, week.id)
      setLastRegistered(tx)
      setTransactions((prev) => [tx, ...prev]) // actualización instantánea, sin reload
      setView('success')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al registrar')
    } finally {
      setSubmitting(false)
    }
  }

  // Aplicar filtro de fechas (carga del servidor)
  async function applyDateFilter() {
    if (!profile || !filterFrom || !filterTo) return
    if (filterFrom > filterTo) {
      setError('La fecha "desde" no puede ser mayor que "hasta"')
      return
    }
    try {
      setFilterLoading(true)
      const data = await getBarberTransactionsByDateRange(profile.id, filterFrom, filterTo)
      setFilteredTxs(data)
      setFilterMode('range')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al filtrar')
    } finally {
      setFilterLoading(false)
    }
  }

  function resetFilter() {
    setFilteredTxs(null)
    setFilterFrom('')
    setFilterTo('')
    setFilterMode('week')
    setShowRangeFilter(false)
  }

  async function handleRequestAdvance() {
    if (!profile) return
    const amount = parseFloat(advanceAmount)
    if (!amount || amount <= 0) { setAdvanceError('Ingresá un monto válido'); return }
    setAdvanceSubmitting(true)
    setAdvanceError(null)
    try {
      await createAdvance({
        barber_id: profile.id,
        branch_id: profile.branch_id,
        week_id: null,
        amount,
        advance_date: todayLocal(),
        reason: advanceReason.trim() || null,
        registered_by: profile.id,
      })
      setAdvanceDone(true)
      setAdvanceAmount('')
      setAdvanceReason('')
    } catch (e) {
      setAdvanceError(e instanceof Error ? e.message : 'Error al enviar')
    } finally {
      setAdvanceSubmitting(false)
    }
  }

  function closeAdvanceModal() {
    setShowAdvanceModal(false)
    setAdvanceDone(false)
    setAdvanceAmount('')
    setAdvanceReason('')
    setAdvanceError(null)
  }

  function openEditTx(tx: Transaction) {
    const svc = services.find((s) => s.id === tx.service_id)
    setEditingTx(tx)
    setEditSvc(svc?.name ?? '')
    setEditAmount(String(tx.amount))
    setEditMethod(tx.payment_method)
    setEditError(null)
  }

  async function handleSaveTx() {
    if (!editingTx || !editMethod || !profile) return
    const amount = parseFloat(editAmount)
    if (!amount || amount <= 0) { setEditError('Ingresá un monto válido'); return }
    setEditSaving(true)
    setEditError(null)
    try {
      const rate = profile.commission_rate ?? 0.5
      const barberShare = Number((amount * rate).toFixed(2))
      const branchShare = Number((amount - barberShare).toFixed(2))
      const alreadyCollected = editMethod === 'cash' ? 0 : barberShare
      const svcData = services.find((s) => s.name === editSvc)
      const updates = {
        service_id: svcData?.id ?? null,
        amount,
        payment_method: editMethod,
        barber_share: barberShare,
        branch_share: branchShare,
        barber_already_collected: alreadyCollected,
      }
      await updateTransaction(editingTx.id, updates)
      setTransactions((prev) =>
        prev.map((t) => t.id === editingTx.id ? { ...t, ...updates } : t)
      )
      setEditingTx(null)
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setEditSaving(false)
    }
  }

  function resetForm() {
    setSelectedService('')
    setCustomAmount('')
    setPaymentMethod(null)
    setKeepCash(false)
    setLastRegistered(null)
    setView('home')
  }

  function goToRegister() {
    setSelectedService('')
    setCustomAmount('')
    setPaymentMethod(null)
    setKeepCash(false)
    setView('register')
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  if (loading) {
    return (
      <div className="valhalla-app flex items-center justify-center min-h-screen">
        <div className="text-center space-y-3">
          <div className="loader mx-auto" />
          <p className="text-zinc-400 text-sm tracking-widest uppercase">Cargando</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="valhalla-app flex items-center justify-center min-h-screen px-6">
        <div className="text-center space-y-4">
          <p className="text-red-400 text-base">{error}</p>
          <button onClick={loadData} className="btn-primary w-full">Reintentar</button>
        </div>
      </div>
    )
  }

  // ── ADVANCE REQUEST MODAL ────────────────────────────────────────────────
  const advanceModal = showAdvanceModal && (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 px-0">
      <div className="bg-zinc-900 border-t border-zinc-700 rounded-t-2xl w-full max-w-lg p-5 space-y-5 animate-fadein">
        <div className="flex items-center justify-between">
          <h2 className="text-white font-bold text-base">Pedir adelanto</h2>
          <button onClick={closeAdvanceModal} className="icon-btn"><span className="text-lg leading-none">✕</span></button>
        </div>

        {advanceDone ? (
          <div className="text-center py-6 space-y-3">
            <div className="text-4xl">✓</div>
            <p className="text-emerald-400 font-semibold">¡Solicitud enviada!</p>
            <p className="text-zinc-400 text-sm">El admin va a ver tu pedido en el módulo de adelantos.</p>
            <button onClick={closeAdvanceModal} className="btn-primary w-full mt-2">Cerrar</button>
          </div>
        ) : (
          <>
            <div>
              <p className="section-label mb-2">Monto solicitado</p>
              <div className="amount-input-wrapper">
                <span className="amount-prefix">$</span>
                <input
                  type="number"
                  inputMode="numeric"
                  placeholder="0"
                  value={advanceAmount}
                  onChange={(e) => setAdvanceAmount(e.target.value)}
                  className="amount-input"
                  autoFocus
                />
              </div>
            </div>

            <div>
              <p className="section-label mb-2">Motivo <span className="text-zinc-600 font-normal normal-case">(opcional)</span></p>
              <input
                type="text"
                placeholder="ej: gastos personales"
                value={advanceReason}
                onChange={(e) => setAdvanceReason(e.target.value)}
                className="amount-input"
                style={{ paddingLeft: '0.875rem' }}
              />
            </div>

            {advanceError && <p className="text-red-400 text-sm">{advanceError}</p>}

            <button
              onClick={handleRequestAdvance}
              disabled={advanceSubmitting || !advanceAmount}
              className="btn-primary disabled:opacity-40"
            >
              {advanceSubmitting ? 'Enviando...' : 'Enviar solicitud'}
            </button>
          </>
        )}
      </div>
    </div>
  )

  // ── EDIT TRANSACTION MODAL ───────────────────────────────────────────────
  const editModal = editingTx && (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 px-0">
      <div className="bg-zinc-900 border-t border-zinc-700 rounded-t-2xl w-full max-w-lg p-5 space-y-5 animate-fadein">
        <div className="flex items-center justify-between">
          <h2 className="text-white font-bold text-base">Editar corte</h2>
          <button onClick={() => setEditingTx(null)} className="icon-btn"><span className="text-lg leading-none">✕</span></button>
        </div>

        <div>
          <p className="section-label mb-2">Servicio</p>
          <div className="grid grid-cols-3 gap-2">
            {services.map((s) => (
              <button key={s.name} onClick={() => {
                setEditSvc(s.name)
                if (s.base_price > 0) setEditAmount(String(s.base_price))
              }}
                className={`service-chip ${editSvc === s.name ? 'service-chip--active' : ''}`}>
                {s.name}
                {s.base_price > 0 && (
                  <span className="block text-xs opacity-60 mt-0.5">{formatARS(s.base_price)}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="section-label mb-2">Monto</p>
          <div className="amount-input-wrapper">
            <span className="amount-prefix">$</span>
            <input type="number" inputMode="numeric" value={editAmount}
              onChange={(e) => setEditAmount(e.target.value)} className="amount-input" />
          </div>
        </div>

        <div>
          <p className="section-label mb-2">Método de pago</p>
          <div className="grid grid-cols-3 gap-2">
            {([
              { method: 'cash' as PaymentMethod, label: 'Efectivo', Icon: IconCash },
              { method: 'transfer' as PaymentMethod, label: 'Transf.', Icon: IconTransfer },
              { method: 'card' as PaymentMethod, label: 'Tarjeta', Icon: IconCard },
            ] as const).map(({ method, label, Icon }) => (
              <button key={method} onClick={() => setEditMethod(method)}
                className={`payment-chip ${editMethod === method ? 'payment-chip--active' : ''}`}>
                <Icon /><span className="text-xs mt-1">{label}</span>
              </button>
            ))}
          </div>
        </div>

        {editError && <p className="text-red-400 text-sm">{editError}</p>}

        <button onClick={handleSaveTx} disabled={editSaving}
          className="btn-primary disabled:opacity-40">
          {editSaving ? 'Guardando...' : 'Guardar cambios'}
        </button>
      </div>
    </div>
  )

  // ── SUCCESS ──────────────────────────────────────────────────────────────
  if (view === 'success' && lastRegistered) {
    return (
      <div className="valhalla-app animate-fadein flex flex-col items-center justify-center min-h-screen px-6 text-center">
        <div className="success-circle mb-8">
          <IconCheck />
        </div>
        <h2 className="text-2xl font-bold text-white mb-1">¡Registrado!</h2>
        <p className="text-zinc-400 text-sm mb-8">
          {selectedService} — {formatARS(lastRegistered.amount)}
        </p>

        <div className="card w-full mb-8 space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-zinc-400">Total corte</span>
            <span className="text-white font-semibold">{formatARS(lastRegistered.amount)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-zinc-400">Tu parte</span>
            <span className="text-amber-400 font-bold">{formatARS(lastRegistered.barber_share)}</span>
          </div>
          <div className="divider" />
          <div className="flex justify-between text-sm">
            <span className="text-zinc-400">Método</span>
            <span className="text-white">{PAYMENT_METHOD_LABELS[lastRegistered.payment_method]}</span>
          </div>
          {lastRegistered.barber_already_collected > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-zinc-400">
                {lastRegistered.payment_method === 'cash' ? 'Te lo quedás en efectivo' : 'Ya en tu cuenta'}
              </span>
              <span className="text-emerald-400">{formatARS(lastRegistered.barber_already_collected)}</span>
            </div>
          )}
        </div>

        <button onClick={goToRegister} className="btn-primary w-full mb-3">
          Registrar otro
        </button>
        <button onClick={resetForm} className="btn-ghost w-full">
          Volver al inicio
        </button>
      </div>
    )
  }

  // ── REGISTER ─────────────────────────────────────────────────────────────
  if (view === 'register') {
    const isValid = selectedService && paymentMethod && resolvedAmount > 0
    return (
      <>
      {advanceModal}
      <div className="valhalla-app animate-fadein min-h-screen flex flex-col">
        <header className="flex items-center gap-3 px-5 pt-safe pt-6 pb-4">
          <button onClick={() => setView('home')} className="icon-btn">
            <IconBack />
          </button>
          <h1 className="text-lg font-bold text-white">Registrar corte</h1>
        </header>

        <div className="flex-1 overflow-y-auto px-5 pb-10 space-y-6">
          <section>
            <label className="section-label">¿Qué hiciste?</label>
            <div className="grid grid-cols-3 gap-2">
              {services.map((svc) => (
                <button
                  key={svc.name}
                  onClick={() => {
                    setSelectedService(svc.name)
                    if (svc.base_price > 0) setCustomAmount('')
                  }}
                  className={`service-chip ${selectedService === svc.name ? 'service-chip--active' : ''}`}
                >
                  {svc.name}
                  {svc.base_price > 0 && (
                    <span className="block text-xs opacity-60 mt-0.5">
                      {formatARS(svc.base_price)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </section>

          <section>
            <label className="section-label">Monto cobrado</label>
            <div className="amount-input-wrapper">
              <span className="amount-prefix">$</span>
              <input
                type="number"
                inputMode="numeric"
                placeholder={selectedServiceData?.base_price ? String(selectedServiceData.base_price) : '0'}
                value={customAmount}
                onChange={(e) => setCustomAmount(e.target.value)}
                className="amount-input"
              />
            </div>
            {effectiveAmount > 0 && (
              <div className="preview-row mt-3">
                <span className="text-zinc-400 text-sm">Tu parte ({Math.round(commissionRate * 100)}%)</span>
                <span className="text-amber-400 font-bold text-lg">{formatARS(previewBarberShare)}</span>
              </div>
            )}
          </section>

          {/* ── Nombre del cliente (opcional) ── */}
          <section>
            <label className="section-label">Cliente (opcional)</label>
            <input
              type="text"
              placeholder="Nombre del cliente"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              className="client-name-input"
              maxLength={60}
            />
          </section>

          {/* ── Descuento (opcional) ── */}
          <section>
            <label className="section-label">Descuento (opcional)</label>
            <div className="discount-grid">
              <div className="amount-input-wrapper">
                <span className="amount-prefix">$</span>
                <input
                  type="number"
                  inputMode="numeric"
                  placeholder="0"
                  value={discountAmount}
                  onChange={(e) => setDiscountAmount(e.target.value)}
                  className="amount-input"
                />
              </div>
              <input
                type="text"
                placeholder="Razón (opcional)"
                value={discountReason}
                onChange={(e) => setDiscountReason(e.target.value)}
                className="client-name-input"
                maxLength={80}
                disabled={discountNum <= 0}
              />
            </div>
            {discountNum > 0 && resolvedAmount > 0 && (
              <p className="discount-hint">
                Subtotal {formatARS(resolvedAmount)} − descuento {formatARS(discountNum)} = <strong>{formatARS(effectiveAmount)}</strong>
              </p>
            )}
          </section>

          <section>
            <label className="section-label">Método de pago</label>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { method: 'cash' as PaymentMethod, label: 'Efectivo', Icon: IconCash },
                  { method: 'transfer' as PaymentMethod, label: 'Transf.', Icon: IconTransfer },
                ] as const
              ).map(({ method, label, Icon }) => (
                <button
                  key={method}
                  onClick={() => {
                    setPaymentMethod(method)
                    if (method !== 'cash') setKeepCash(false)
                  }}
                  className={`payment-chip ${paymentMethod === method ? 'payment-chip--active' : ''}`}
                >
                  <Icon />
                  <span className="text-xs mt-1">{label}</span>
                  {paymentMethod === method && method !== 'cash' && !splitMode && resolvedAmount > 0 && (
                    <span className="text-xs text-emerald-400 mt-0.5">Ya en tu cuenta</span>
                  )}
                </button>
              ))}
            </div>

            {/* Toggle split payment */}
            {effectiveAmount > 0 && (
              <div className="split-toggle">
                <label className="split-toggle__row">
                  <input
                    type="checkbox"
                    checked={splitMode}
                    onChange={(e) => {
                      setSplitMode(e.target.checked)
                      if (!e.target.checked) {
                        setSplitCash('')
                        setSplitTransfer('')
                      }
                    }}
                  />
                  <span>Pago combinado (efectivo + transferencia)</span>
                </label>
                {splitMode && (
                  <div className="split-inputs">
                    <div>
                      <label className="split-label">Efectivo</label>
                      <div className="amount-input-wrapper">
                        <span className="amount-prefix">$</span>
                        <input
                          type="number"
                          inputMode="numeric"
                          placeholder="0"
                          value={splitCash}
                          onChange={(e) => setSplitCash(e.target.value)}
                          className="amount-input"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="split-label">Transferencia</label>
                      <div className="amount-input-wrapper">
                        <span className="amount-prefix">$</span>
                        <input
                          type="number"
                          inputMode="numeric"
                          placeholder="0"
                          value={splitTransfer}
                          onChange={(e) => setSplitTransfer(e.target.value)}
                          className="amount-input"
                        />
                      </div>
                    </div>
                    <p className={`split-sum ${splitValid ? 'split-sum--ok' : 'split-sum--err'}`}>
                      {splitValid
                        ? `✓ ${formatARS(splitSum)} = total ${formatARS(effectiveAmount)}`
                        : `⚠ ${formatARS(splitSum)} ≠ ${formatARS(effectiveAmount)}`}
                    </p>
                  </div>
                )}
              </div>
            )}
          </section>

          {paymentMethod === 'cash' && resolvedAmount > 0 && (
            <section className="animate-fadein">
              <button
                type="button"
                onClick={() => setKeepCash((v) => !v)}
                className={`keep-cash-toggle ${keepCash ? 'keep-cash-toggle--on' : ''}`}
              >
                <span className="keep-cash-toggle__track">
                  <span className="keep-cash-toggle__thumb" />
                </span>
                <span className="keep-cash-toggle__label">
                  {keepCash ? '✓ Me quedo con mi parte en efectivo' : '¿Te quedás con tu parte en efectivo?'}
                </span>
              </button>
            </section>
          )}

          {isValid && (
            <div className="card space-y-2 animate-fadein">
              <p className="text-xs text-zinc-500 uppercase tracking-widest mb-3">Resumen</p>
              <div className="flex justify-between text-sm">
                <span className="text-zinc-400">Servicio</span>
                <span className="text-white">{selectedService}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-zinc-400">Total</span>
                <span className="text-white">{formatARS(resolvedAmount)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-zinc-400">Método</span>
                <span className="text-white">{PAYMENT_METHOD_LABELS[paymentMethod!]}</span>
              </div>
              <div className="divider" />
              <div className="flex justify-between">
                <span className="text-zinc-400 text-sm">Tu parte</span>
                <span className="text-amber-400 font-bold text-lg">{formatARS(previewBarberShare)}</span>
              </div>
              {previewAlreadyCollected > 0 && (
                <p className="text-xs text-emerald-400 text-right">
                  {paymentMethod === 'cash' ? 'Te quedás con tu parte en efectivo' : 'Ya depositado en tu cuenta'}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="px-5 pb-safe pb-8 pt-4 border-t border-zinc-800">
          <button
            onClick={handleSubmit}
            disabled={!isValid || submitting}
            className="btn-primary w-full text-lg py-5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? 'Registrando...' : 'Confirmar corte'}
          </button>
        </div>
      </div>
      </>
    )
  }

  // ── SETTLEMENTS ──────────────────────────────────────────────────────────
  if (view === 'settlements') {
    return (
      <div className="valhalla-app animate-fadein min-h-screen flex flex-col">
        <header className="flex items-center gap-3 px-5 pt-safe pt-6 pb-4">
          <button onClick={() => setView('home')} className="icon-btn">
            <IconBack />
          </button>
          <h1 className="text-lg font-bold text-white">Mis liquidaciones</h1>
        </header>

        <div className="flex-1 overflow-y-auto px-5 pb-10 space-y-3">
          {settlementsLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="loader" />
            </div>
          ) : settlements.length === 0 ? (
            <div className="card text-center py-10">
              <p className="text-zinc-500 text-sm">No hay liquidaciones todavía</p>
            </div>
          ) : (
            settlements.map((s) => {
              const statusColors: Record<string, string> = {
                draft: 'text-zinc-400',
                confirmed: 'text-amber-400',
                paid: 'text-emerald-400',
              }
              return (
                <div key={s.id} className="card space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-white font-bold text-sm">
                        Semana {s.week.week_number}
                      </p>
                      <p className="text-zinc-500 text-xs mt-0.5">
                        {new Date(s.week.start_date + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })}
                        {' – '}
                        {new Date(s.week.end_date + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: '2-digit' })}
                      </p>
                    </div>
                    <span className={`text-xs font-semibold uppercase tracking-wide ${statusColors[s.status] ?? 'text-zinc-400'}`}>
                      {SETTLEMENT_STATUS_LABELS[s.status]}
                    </span>
                  </div>

                  <div className="divider" />

                  <div className="space-y-1.5">
                    <div className="flex justify-between text-sm">
                      <span className="text-zinc-400">Cortes · Facturado</span>
                      <span className="text-white">{s.total_cuts} · {formatARS(s.gross_amount)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-zinc-400">Tu comisión</span>
                      <span className="text-white">{formatARS(s.barber_gross)}</span>
                    </div>
                    {s.bonus_presentismo > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-zinc-400">Presentismo</span>
                        <span className="text-emerald-400">+{formatARS(s.bonus_presentismo)}</span>
                      </div>
                    )}
                    {s.bonus_objetivo > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-zinc-400">Objetivo</span>
                        <span className="text-emerald-400">+{formatARS(s.bonus_objetivo)}</span>
                      </div>
                    )}
                    {s.already_collected > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-zinc-400">Ya cobrado (transf/tarjeta)</span>
                        <span className="text-zinc-400">−{formatARS(s.already_collected)}</span>
                      </div>
                    )}
                    {s.advances_deducted > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-zinc-400">Adelantos</span>
                        <span className="text-zinc-400">−{formatARS(s.advances_deducted)}</span>
                      </div>
                    )}
                  </div>

                  <div className="divider" />

                  <div className="flex justify-between items-center">
                    <span className="text-zinc-400 text-sm">
                      {s.net_payable >= 0 ? 'A cobrar en efectivo' : 'Deuda pendiente'}
                    </span>
                    <span className={`font-bold text-lg ${s.net_payable >= 0 ? 'text-amber-400' : 'text-red-400'}`}>
                      {formatARS(Math.abs(s.net_payable))}
                    </span>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    )
  }

  // ── HOME ─────────────────────────────────────────────────────────────────
  return (
    <>
    {editModal}
    {advanceModal}
    <div className="valhalla-app animate-fadein min-h-screen flex flex-col">
      <header className="px-5 pt-safe pt-8 pb-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-zinc-500 text-xs uppercase tracking-widest mb-1">Valhalla</p>
            <h1 className="text-2xl font-bold text-white leading-tight">
              {profile?.full_name.split(' ')[0]}
            </h1>
            <p className="text-zinc-400 text-sm mt-0.5 capitalize">
              {week ? `Semana ${week.week_number} · ${formatDate(today)}` : ''}
            </p>
          </div>
          <button onClick={handleLogout} className="icon-btn mt-1">
            <IconLogout />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-5 pb-10 space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <div className="stat-card">
            <p className="stat-label">Hoy</p>
            <p className="stat-value">{formatARS(todayTotal)}</p>
            <p className="stat-sub">
              Tu parte: <span className="text-amber-400">{formatARS(todayBarber)}</span>
            </p>
            <p className="stat-count">{todayTxs.length} cortes</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Semana</p>
            <p className="stat-value">{formatARS(weekTotal)}</p>
            <p className="stat-sub">
              Tu parte: <span className="text-amber-400">{formatARS(weekBarber)}</span>
            </p>
            <p className="stat-count">{weekCuts} cortes</p>
          </div>
        </div>

        <button onClick={goToRegister} className="register-btn w-full">
          <div className="flex items-center justify-center gap-3">
            <IconScissors />
            <span className="text-xl font-bold">Registrar corte</span>
          </div>
        </button>

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={goToSettlements}
            className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-4 flex items-center justify-between text-left"
          >
            <div>
              <p className="text-white font-semibold text-sm">Liquidaciones</p>
              <p className="text-zinc-500 text-xs mt-0.5">Historial de pagos</p>
            </div>
            <span className="text-zinc-600 text-lg">›</span>
          </button>

          <button
            onClick={() => { setShowAdvanceModal(true); setAdvanceDone(false) }}
            className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-4 flex items-center justify-between text-left hover:border-violet-700 transition-colors"
          >
            <div>
              <p className="text-violet-400 font-semibold text-sm">Pedir adelanto</p>
              <p className="text-zinc-500 text-xs mt-0.5">Solicitud al admin</p>
            </div>
            <IconAdvance />
          </button>
        </div>

        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="section-label mb-0">
              {filterMode === 'range' ? 'Cortes filtrados' : 'Cortes de la semana'}
            </h2>
            <button
              onClick={() => {
                if (filterMode === 'range') resetFilter()
                setShowRangeFilter((v) => !v)
              }}
              className="text-xs text-zinc-400 hover:text-amber-400"
            >
              {showRangeFilter || filterMode === 'range' ? '✕ Cerrar' : '🔍 Filtrar por fecha'}
            </button>
          </div>

          {/* Bloques de días de la semana (modo semana) */}
          {filterMode === 'week' && weekDays.length > 0 && (
            <div className="day-blocks">
              {weekDays.map((d) => {
                const count = (txsByDay[d.date] ?? []).length
                const isActive = selectedDay === d.date
                return (
                  <button
                    key={d.date}
                    onClick={() => setSelectedDay(d.date)}
                    className={`day-block ${isActive ? 'day-block--active' : ''} ${d.isToday ? 'day-block--today' : ''}`}
                  >
                    <span className="day-block__label">{d.label}</span>
                    <span className="day-block__num">{d.dayNum}</span>
                    {count > 0 && <span className="day-block__count">{count}</span>}
                  </button>
                )
              })}
            </div>
          )}

          {/* Filtro avanzado por rango (colapsable) */}
          {(showRangeFilter || filterMode === 'range') && (
            <div className="date-filter">
              <div className="date-filter__inputs">
                <div>
                  <label className="date-filter__label">Desde</label>
                  <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} className="date-filter__input" />
                </div>
                <div>
                  <label className="date-filter__label">Hasta</label>
                  <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} className="date-filter__input" />
                </div>
              </div>
              <button
                onClick={applyDateFilter}
                disabled={!filterFrom || !filterTo || filterLoading}
                className="date-filter__apply"
              >
                {filterLoading ? '...' : 'Buscar'}
              </button>
            </div>
          )}

          {(() => {
            const list = filterMode === 'range' ? (filteredTxs ?? []) : dayTxs
            const totalAmount = list.reduce((s, t) => s + t.amount, 0)
            const totalBarber = list.reduce((s, t) => s + t.barber_share, 0)

            return (
              <>
                {/* Resumen del día / rango */}
                {list.length > 0 && (
                  <div className="filter-summary">
                    <div>
                      <span className="filter-summary__label">Total</span>
                      <span className="filter-summary__value">{formatARS(totalAmount)}</span>
                    </div>
                    <div>
                      <span className="filter-summary__label">Tu parte</span>
                      <span className="filter-summary__value text-amber-400">{formatARS(totalBarber)}</span>
                    </div>
                    <div>
                      <span className="filter-summary__label">Cortes</span>
                      <span className="filter-summary__value">{list.length}</span>
                    </div>
                  </div>
                )}

                {list.length === 0 ? (
                  <div className="card text-center py-8">
                    <p className="text-zinc-500 text-sm">
                      {filterMode === 'range'
                        ? 'Sin cortes en ese rango'
                        : selectedDay === today
                        ? 'Todavía no registraste cortes hoy'
                        : 'Sin cortes ese día'}
                    </p>
                  </div>
                ) : (
                  <div className="tx-grid">
                    {list.map((tx) => (
                      <div key={tx.id} className="tx-card">
                        <div className="tx-card__top">
                          <div className={`payment-dot payment-dot--${tx.payment_method}`} />
                          <span className="tx-card__date">
                            {filterMode === 'range'
                              ? new Date(tx.transaction_date + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })
                              : new Date(tx.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
                            }
                          </span>
                          <button onClick={() => openEditTx(tx)} className="tx-card__edit" title="Editar">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                            </svg>
                          </button>
                        </div>
                        <div className="tx-card__amount">{formatARS(tx.amount)}</div>
                        <div className="tx-card__share">{formatARS(tx.barber_share)} <span className="text-zinc-600 text-xs">tuya</span></div>
                        {tx.client_name && <div className="tx-card__client">👤 {tx.client_name}</div>}
                        {tx.discount_amount > 0 && (
                          <div className="tx-card__discount">-{formatARS(tx.discount_amount)} desc.</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )
          })()}
        </section>
      </div>
    </div>
    </>
  )
}
