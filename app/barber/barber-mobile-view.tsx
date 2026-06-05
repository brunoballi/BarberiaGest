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
  getSettlementStatusForWeek,
  computeBenefitDiscount,
  registerCut,
  updateTransaction,
  createAdvance,
  todayLocal,
  supabase,
} from '@/lib/supabase/supabase.client'
import { useServices, useActiveBenefits } from '@/lib/hooks/use-catalogs'
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
  const [weekClosed, setWeekClosed] = useState(false) // liquidación confirmed/paid → semana cerrada para este barbero
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Servicios desde React Query (cache 10 min, compartido). Fallback a defaults.
  const servicesQuery = useServices(profile?.branch_id)
  const activeServices = (servicesQuery.data ?? []).filter((s) => s.is_active)
  const services: ServiceOption[] = activeServices.length > 0 ? activeServices : DEFAULT_SERVICES
  const [settlements, setSettlements] = useState<SettlementWithBarber[]>([])
  const [settlementsLoaded, setSettlementsLoaded] = useState(false)
  const [settlementsLoading, setSettlementsLoading] = useState(false)
  const [settlFilterStatus, setSettlFilterStatus] = useState('')
  const [expandedSettlement, setExpandedSettlement] = useState<string | null>(null)
  const [selectedService, setSelectedService] = useState<string>('')
  const [customAmount, setCustomAmount] = useState<string>('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [lastRegistered, setLastRegistered] = useState<Transaction | null>(null)
  const [clientName, setClientName] = useState<string>('')
  const [clientSurname, setClientSurname] = useState<string>('')
  const [discountAmount, setDiscountAmount] = useState<string>('')
  const [discountReason, setDiscountReason] = useState<string>('')
  const benefitsQuery = useActiveBenefits(profile?.branch_id)
  const benefits = benefitsQuery.data ?? []
  const [benefitId, setBenefitId] = useState<string>('')
  const [observations, setObservations] = useState<string>('')
  const [splitPayment, setSplitPayment] = useState(false)
  const [cashPart, setCashPart] = useState<string>('')
  const [transferPart, setTransferPart] = useState<string>('')
  const [formSubmitError, setFormSubmitError] = useState<string | null>(null)

  // Día seleccionado en la grilla de la semana (default: hoy)
  const [selectedDay, setSelectedDay] = useState<string>('')  // YYYY-MM-DD
  // Días expandidos en la vista de rango (cortes filtrados)
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set())

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

      // Servicios y beneficios ahora vienen de React Query (useServices/useActiveBenefits).
      const w = await getOpenWeek(p.branch_id)
      if (!w) { setError('No hay semana abierta. Contactá al admin.'); return }
      setWeek(w)

      const [txs, settlStatus] = await Promise.all([
        getBarberTransactionsForWeek(p.id, w.id),
        getSettlementStatusForWeek(w.id, p.id),
      ])
      setTransactions(txs)
      setWeekClosed(settlStatus === 'confirmed' || settlStatus === 'paid')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // Realtime: si el admin agrega/edita/borra un corte del barbero, o confirma su
  // liquidación, la vista se actualiza al instante (sin recargar).
  useEffect(() => {
    if (!profile || !week) return
    const bid = profile.id
    const wid = week.id
    const channel = supabase
      .channel(`barber-${bid}-week-${wid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions', filter: `barber_id=eq.${bid}` }, async () => {
        const txs = await getBarberTransactionsForWeek(bid, wid)
        setTransactions(txs)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settlements', filter: `barber_id=eq.${bid}` }, async () => {
        const st = await getSettlementStatusForWeek(wid, bid)
        setWeekClosed(st === 'confirmed' || st === 'paid')
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [profile, week])

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

  // ── Días de la semana según el rango real start_date → end_date ───────────
  // Las semanas son lunes-domingo (7 días). Derivamos la cantidad de días del
  // rango y etiquetamos por el día real de la semana. Mejora 2: los barberos
  // solo cargan mar-sáb; dom/lun se grisan salvo que el admin los habilite.
  const DAY_LABELS_BY_DOW = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
  const weekDays: { date: string; label: string; dayNum: number; isToday: boolean; dow: number }[] = (() => {
    if (!week) return []
    const [sy, sm, sd] = week.start_date.split('-').map(Number)
    const [ey, em, ed] = week.end_date.split('-').map(Number)
    const startDt = new Date(sy, sm - 1, sd)
    const endDt   = new Date(ey, em - 1, ed)
    const count = Math.round((endDt.getTime() - startDt.getTime()) / 86400000) + 1
    return Array.from({ length: Math.max(1, count) }, (_, i) => {
      const date = new Date(sy, sm - 1, sd + i)
      const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      return {
        date: dateStr,
        label: DAY_LABELS_BY_DOW[date.getDay()],
        dayNum: date.getDate(),
        isToday: dateStr === today,
        dow: date.getDay(),
      }
    })
  })()

  // ── Mejora 2: los barberos solo cargan martes(2)–sábado(6).
  // Domingo(0) y lunes(1) quedan bloqueados (grisados), salvo que el admin
  // habilite ese día puntual (week.barber_extra_days). El admin no tiene este límite.
  const BARBER_BLOCKED_DOWS = new Set([0, 1])
  const extraEnabledDays = new Set(week?.barber_extra_days ?? [])
  function isBarberAllowedDay(dateStr: string): boolean {
    const [y, m, d] = dateStr.split('-').map(Number)
    const dow = new Date(y, m - 1, d).getDay()
    return !BARBER_BLOCKED_DOWS.has(dow) || extraEnabledDays.has(dateStr)
  }
  const todayAllowedForBarber = isBarberAllowedDay(today)

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
  // Aplicar descuento al amount efectivo (lo que paga el cliente)
  const discountNum = parseFloat(discountAmount) || 0
  const effectiveAmount = Math.max(0, resolvedAmount - discountNum)
  const selectedBenefit = benefits.find((b) => b.id === benefitId)

  // Mejora 1: al elegir un beneficio, pre-rellenar descuento y motivo (50/50 sin cambios)
  useEffect(() => {
    if (!benefitId) return
    const b = benefits.find((x) => x.id === benefitId)
    if (!b) return
    const dsc = computeBenefitDiscount(b, resolvedAmount)
    setDiscountAmount(dsc > 0 ? String(dsc) : '')
    setDiscountReason(b.name)
  }, [benefitId, resolvedAmount, benefits])

  // Recalcular partes mixtas cuando cambia effectiveAmount
  useEffect(() => {
    if (!splitPayment) return
    if (effectiveAmount === 0) { setCashPart('0'); setTransferPart('0'); return }
    const half = Math.round(effectiveAmount / 2)
    setCashPart(String(half))
    setTransferPart(String(effectiveAmount - half))
  }, [effectiveAmount, splitPayment])

  // Descuento 50/50: barbero absorbe la mitad del descuento, comisión sobre precio original.
  const previewBarberShare = Math.max(0, Math.round(resolvedAmount * commissionRate - discountNum * 0.5))
  // Transferencia → barbero ya tiene su parte; efectivo → queda en caja
  const previewAlreadyCollected = paymentMethod === 'transfer' ? previewBarberShare : 0

  // Mejora 1: si el barbero NO recibe transferencias, las transferencias van a la
  // cuenta de Valhalla. En ese caso pedimos nombre + apellido del cliente para que
  // el dueño pueda verificar contra el home banking.
  const transferGoesToValhalla =
    !(profile?.receives_transfers ?? true) &&
    (splitPayment ? (parseFloat(transferPart) || 0) > 0 : paymentMethod === 'transfer')

  async function handleSubmit() {
    setFormSubmitError(null)
    if (!profile || !week) return

    if (weekClosed) { setFormSubmitError('Tu semana está cerrada (liquidación confirmada). Contactá al admin.'); return }
    if (!todayAllowedForBarber) { setFormSubmitError('Hoy no se cargan cortes (domingo/lunes). Pedile al admin que habilite el día.'); return }
    if (!selectedService) { setFormSubmitError('Seleccioná un servicio antes de continuar'); return }
    if (discountNum > resolvedAmount) { setFormSubmitError('El descuento no puede superar el precio del servicio'); return }
    if (resolvedAmount <= 0)          { setFormSubmitError('Ingresá un monto válido'); return }
    if (transferGoesToValhalla && (!clientName.trim() || !clientSurname.trim())) {
      setFormSubmitError('Para transferencias a la barbería ingresá nombre y apellido del cliente'); return
    }

    let paymentMethodFinal: PaymentMethod
    let cashAmt = 0
    let transferAmt = 0

    if (effectiveAmount === 0) {
      // Descuento 100%: no hay dinero que cobrar
      paymentMethodFinal = 'cash'
      cashAmt = 0; transferAmt = 0
    } else if (splitPayment) {
      const cashNum  = parseFloat(cashPart)  || 0
      const transNum = parseFloat(transferPart) || 0
      if (cashNum <= 0 && transNum <= 0) { setFormSubmitError('Ingresá los montos de cada medio de pago'); return }
      if (Math.abs(cashNum + transNum - effectiveAmount) > 1) {
        setFormSubmitError(`La suma (${formatARS(cashNum + transNum)}) debe ser igual al total (${formatARS(effectiveAmount)})`)
        return
      }
      paymentMethodFinal = 'mixed'
      cashAmt   = cashNum
      transferAmt = transNum
    } else {
      if (!paymentMethod) { setFormSubmitError('Seleccioná un método de pago'); return }
      paymentMethodFinal = paymentMethod
      cashAmt     = paymentMethod === 'cash'     ? effectiveAmount : 0
      transferAmt = paymentMethod === 'transfer' ? effectiveAmount : 0
    }

    // Protección cambio de día a medianoche
    const nowDate = todayLocal()
    if (nowDate !== today) { setFormSubmitError('El día cambió. Recargá la app para continuar.'); return }

    // Combinar discount reason + observaciones en un solo campo
    const parts = [discountReason.trim(), observations.trim()].filter(Boolean)
    const discountReasonFinal = parts.length ? parts.join(' | ') : null

    try {
      setSubmitting(true)
      const payload: RegisterCutPayload = {
        service_id:       selectedServiceData?.id ?? null,
        amount:           effectiveAmount,
        payment_method:   paymentMethodFinal,
        transaction_date: today,
        cash_amount:      cashAmt,
        transfer_amount:  transferAmt,
        card_amount:      0,
        client_name:      clientName.trim() || null,
        client_surname:   transferGoesToValhalla ? (clientSurname.trim() || null) : null,
        discount_amount:  discountNum > 0 ? discountNum : 0,
        discount_reason:  discountReasonFinal,
        benefit_id:       benefitId || null,
      }
      const tx = await registerCut(payload, profile, week.id)
      setLastRegistered(tx)
      setTransactions((prev) => [tx, ...prev])
      setView('success')
    } catch (e) {
      setFormSubmitError(e instanceof Error ? e.message : 'Error al registrar')
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
    if (!profile.advance_enabled) { setAdvanceError('No tenés adelantos habilitados. Contactá al admin.'); return }
    const amount = parseFloat(advanceAmount)
    if (!amount || amount <= 0) { setAdvanceError('Ingresá un monto válido'); return }
    if (profile.advance_limit > 0 && amount > profile.advance_limit) {
      setAdvanceError(`El máximo que podés solicitar es ${formatARS(profile.advance_limit)}`)
      return
    }
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
      // Alquiler de box: el barbero se queda el 100% del corte.
      const isBox = profile.compensation_type === 'box_rental'
      const barberShare = isBox ? amount : Number((amount * rate).toFixed(2))
      const branchShare = isBox ? 0 : Number((amount - barberShare).toFixed(2))
      // box_rental ya tiene el 100%. Si recibe transferencias y paga por transferencia,
      // retiene el TOTAL (se reconcilia en la liquidación). Efectivo/transfer-a-Valhalla → 0.
      const alreadyCollected = isBox
        ? amount
        : ((editMethod === 'transfer' && profile.receives_transfers) ? amount : 0)
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
    setSplitPayment(false)
    setCashPart('')
    setTransferPart('')
    setObservations('')
    setBenefitId('')
    setFormSubmitError(null)
    setLastRegistered(null)
    setView('home')
  }

  function goToRegister() {
    if (weekClosed) return
    setSelectedService('')
    setCustomAmount('')
    setPaymentMethod(null)
    setSplitPayment(false)
    setCashPart('')
    setTransferPart('')
    setObservations('')
    setBenefitId('')
    setFormSubmitError(null)
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
              {profile?.advance_limit != null && profile.advance_limit > 0 && (
                <p className="text-xs text-zinc-500 mt-1.5">Máximo permitido: {formatARS(profile.advance_limit)}</p>
              )}
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
          <div className="grid grid-cols-2 gap-2">
            {([
              { method: 'cash' as PaymentMethod, label: 'Efectivo', Icon: IconCash },
              { method: 'transfer' as PaymentMethod, label: 'Transf.', Icon: IconTransfer },
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
    const cashNum    = parseFloat(cashPart)    || 0
    const transferNum = parseFloat(transferPart) || 0
    const splitValid = effectiveAmount === 0
      ? true
      : splitPayment
        ? cashNum + transferNum > 0 && Math.abs(cashNum + transferNum - effectiveAmount) <= 1
        : !!paymentMethod
    const isValid = !!selectedService && effectiveAmount >= 0 && !!selectedService && splitValid
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
                type="text"
                readOnly
                tabIndex={-1}
                aria-readonly="true"
                value={Math.round(effectiveAmount).toLocaleString('es-AR')}
                className="amount-input"
                style={{ opacity: 0.6, cursor: 'not-allowed' }}
              />
            </div>
            {effectiveAmount > 0 && (
              <div className="preview-row mt-3">
                <span className="text-zinc-400 text-sm">Tu parte ({Math.round(commissionRate * 100)}%)</span>
                <span className="text-amber-400 font-bold text-lg">{formatARS(previewBarberShare)}</span>
              </div>
            )}
          </section>

          {/* ── Nombre del cliente (opcional, salvo transferencia a Valhalla) ── */}
          <section>
            <label className="section-label">
              {transferGoesToValhalla ? 'Cliente (obligatorio)' : 'Cliente (opcional)'}
            </label>
            <input
              type="text"
              placeholder="Nombre del cliente"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              className="client-name-input"
              maxLength={60}
            />
            {transferGoesToValhalla && (
              <>
                <input
                  type="text"
                  placeholder="Apellido del cliente (obligatorio)"
                  value={clientSurname}
                  onChange={(e) => setClientSurname(e.target.value)}
                  className="client-name-input"
                  style={{ marginTop: 8 }}
                  maxLength={60}
                />
                <p className="text-xs text-amber-400" style={{ marginTop: 6 }}>
                  Esta transferencia va a la cuenta de Valhalla. Cargá nombre y apellido para poder verificarla en el home banking.
                </p>
              </>
            )}
          </section>

          {/* ── Beneficio (opcional) — Mejora 1 ── */}
          {benefits.length > 0 && (
            <section>
              <label className="section-label">Beneficio (opcional)</label>
              <select
                value={benefitId}
                onChange={(e) => {
                  const id = e.target.value
                  setBenefitId(id)
                  if (!id) { setDiscountAmount(''); setDiscountReason('') }
                }}
                className="client-name-input"
              >
                <option value="">— sin beneficio —</option>
                {benefits.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.discount_type === 'percentage' ? `${b.discount_value}%` : formatARS(b.discount_value)})
                  </option>
                ))}
              </select>
              {selectedBenefit && discountNum > 0 && (
                <p className="discount-hint" style={{ color: '#34d399' }}>
                  Ahorra {formatARS(discountNum)} con &quot;{selectedBenefit.name}&quot;
                </p>
              )}
            </section>
          )}

          {/* ── Descuento (solo lectura — se aplica vía Beneficio) ── */}
          <section>
            <label className="section-label">Descuento</label>
            <div className="amount-input-wrapper">
              <span className="amount-prefix">$</span>
              <input
                type="text"
                readOnly
                tabIndex={-1}
                aria-readonly="true"
                value={Math.round(discountNum).toLocaleString('es-AR')}
                className="amount-input"
                style={{ opacity: 0.6, cursor: 'not-allowed' }}
              />
            </div>
            {discountNum > 0 && resolvedAmount > 0 && (
              <p className="discount-hint">
                Subtotal {formatARS(resolvedAmount)} − descuento {formatARS(discountNum)} = <strong>{formatARS(effectiveAmount)}</strong>
              </p>
            )}
          </section>

          {/* ── Observaciones (opcional) ── */}
          <section>
            <label className="section-label">Observaciones <span className="text-zinc-600 font-normal normal-case">(opcional)</span></label>
            <input
              type="text"
              placeholder="Detalle adicional del servicio..."
              value={observations}
              onChange={(e) => setObservations(e.target.value)}
              className="client-name-input"
              maxLength={120}
            />
          </section>

          <section>
            <label className="section-label">Método de pago</label>

            {/* Chips cash / transfer (modo simple) */}
            {!splitPayment && (
              <div className="grid grid-cols-2 gap-2">
                {([
                  { method: 'cash' as PaymentMethod, label: 'Efectivo', Icon: IconCash },
                  { method: 'transfer' as PaymentMethod, label: 'Transf.', Icon: IconTransfer },
                ] as const).map(({ method, label, Icon }) => (
                  <button
                    key={method}
                    onClick={() => setPaymentMethod(method)}
                    className={`payment-chip ${paymentMethod === method ? 'payment-chip--active' : ''}`}
                  >
                    <Icon />
                    <span className="text-xs mt-1">{label}</span>
                    {paymentMethod === method && method !== 'cash' && resolvedAmount > 0 && (
                      <span className="text-xs text-emerald-400 mt-0.5">Ya en tu cuenta</span>
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* Toggle pago mixto */}
            <label className="flex items-center gap-2 mt-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={splitPayment}
                onChange={(e) => {
                  setSplitPayment(e.target.checked)
                  if (e.target.checked) {
                    setPaymentMethod(null)
                    if (effectiveAmount > 0) {
                      const half = Math.round(effectiveAmount / 2)
                      setCashPart(String(half))
                      setTransferPart(String(effectiveAmount - half))
                    }
                  } else {
                    setCashPart('')
                    setTransferPart('')
                  }
                }}
                className="w-4 h-4 accent-amber-500"
              />
              <span className="text-sm text-zinc-400">Pago mixto (efectivo + transferencia)</span>
            </label>

            {/* Campos split */}
            {splitPayment && (
              <div className="grid grid-cols-2 gap-2 mt-3">
                <div>
                  <p className="text-xs text-zinc-500 mb-1">Efectivo</p>
                  <div className="amount-input-wrapper">
                    <span className="amount-prefix">$</span>
                    <input
                      type="number" inputMode="numeric" placeholder="0"
                      value={cashPart}
                      onChange={(e) => {
                        setCashPart(e.target.value)
                        const rest = effectiveAmount - (parseFloat(e.target.value) || 0)
                        if (rest >= 0) setTransferPart(String(Math.round(rest)))
                      }}
                      className="amount-input"
                    />
                  </div>
                </div>
                <div>
                  <p className="text-xs text-zinc-500 mb-1">Transferencia</p>
                  <div className="amount-input-wrapper">
                    <span className="amount-prefix">$</span>
                    <input
                      type="number" inputMode="numeric" placeholder="0"
                      value={transferPart}
                      onChange={(e) => {
                        setTransferPart(e.target.value)
                        const rest = effectiveAmount - (parseFloat(e.target.value) || 0)
                        if (rest >= 0) setCashPart(String(Math.round(rest)))
                      }}
                      className="amount-input"
                    />
                  </div>
                </div>
                {(cashNum + transferNum) > 0 && (
                  <p className={`col-span-2 text-xs text-right ${Math.abs(cashNum + transferNum - effectiveAmount) <= 1 ? 'text-emerald-400' : 'text-red-400'}`}>
                    Suma: {formatARS(cashNum + transferNum)} · Total: {formatARS(effectiveAmount)}
                  </p>
                )}
              </div>
            )}
          </section>

          {isValid && (
            <div className="card space-y-2 animate-fadein">
              <p className="text-xs text-zinc-500 uppercase tracking-widest mb-3">Resumen</p>
              <div className="flex justify-between text-sm">
                <span className="text-zinc-400">Servicio</span>
                <span className="text-white">{selectedService}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-zinc-400">Total</span>
                <span className="text-white">{formatARS(effectiveAmount)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-zinc-400">Método</span>
                <span className="text-white">
                  {splitPayment ? `Mixto: ${formatARS(cashNum)} ef + ${formatARS(transferNum)} transf` : PAYMENT_METHOD_LABELS[paymentMethod!]}
                </span>
              </div>
              <div className="divider" />
              <div className="flex justify-between">
                <span className="text-zinc-400 text-sm">Tu parte</span>
                <span className="text-amber-400 font-bold text-lg">{formatARS(previewBarberShare)}</span>
              </div>
              {!splitPayment && paymentMethod === 'transfer' && (
                <p className="text-xs text-emerald-400 text-right">Ya depositado en tu cuenta</p>
              )}
              {splitPayment && transferNum > 0 && (
                <p className="text-xs text-emerald-400 text-right">{formatARS(transferNum)} ya en tu cuenta</p>
              )}
            </div>
          )}
        </div>

        <div className="px-5 pb-safe pb-8 pt-4 border-t border-zinc-800">
          {formSubmitError && (
            <p className="text-red-400 text-sm mb-3 text-center">{formSubmitError}</p>
          )}
          <button
            onClick={handleSubmit}
            disabled={submitting}
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
    const STATUS_FILTERS = [
      { value: '', label: 'Todas' },
      { value: 'draft', label: 'Borrador' },
      { value: 'confirmed', label: 'Confirmado' },
      { value: 'paid', label: 'Pagado' },
    ]
    const STATUS_CFG: Record<string, { label: string; color: string; dot: string }> = {
      draft:     { label: 'Borrador',   color: 'text-zinc-400',    dot: 'bg-zinc-600' },
      confirmed: { label: 'Confirmado', color: 'text-amber-400',   dot: 'bg-amber-500' },
      paid:      { label: 'Pagado',     color: 'text-emerald-400', dot: 'bg-emerald-500' },
    }
    const filtered = settlements.filter((s) => !settlFilterStatus || s.status === settlFilterStatus)
    return (
      <div className="valhalla-app animate-fadein min-h-screen flex flex-col">
        <header className="flex items-center gap-3 px-5 pt-safe pt-6 pb-4">
          <button onClick={() => setView('home')} className="icon-btn"><IconBack /></button>
          <h1 className="text-lg font-bold text-white">Mis liquidaciones</h1>
        </header>

        {/* Filter chips */}
        <div className="px-5 pb-3 flex items-center gap-2 overflow-x-auto">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setSettlFilterStatus(f.value)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors flex-shrink-0 ${
                settlFilterStatus === f.value
                  ? 'bg-amber-500 text-zinc-950'
                  : 'bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-white'
              }`}
            >
              {f.label}
            </button>
          ))}
          <span className="text-xs text-zinc-600 ml-auto whitespace-nowrap flex-shrink-0">
            {filtered.length} semana{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-10 space-y-1.5">
          {settlementsLoading ? (
            <div className="flex items-center justify-center py-16"><div className="loader" /></div>
          ) : filtered.length === 0 ? (
            <div className="card text-center py-10">
              <p className="text-zinc-500 text-sm">
                {settlements.length === 0 ? 'No hay liquidaciones todavía' : 'Sin resultados'}
              </p>
            </div>
          ) : filtered.map((s) => {
            const isExpanded = expandedSettlement === s.id
            const cfg = STATUS_CFG[s.status] ?? STATUS_CFG.draft
            return (
              <div key={s.id} className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                <button
                  onClick={() => setExpandedSettlement(isExpanded ? null : s.id)}
                  className="w-full px-4 py-3.5 flex items-center gap-3 text-left"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-white font-bold text-sm">Sem. {s.week.week_number}</span>
                      <span className="text-zinc-500 text-xs">
                        {new Date(s.week.start_date + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })}
                        {' – '}
                        {new Date(s.week.end_date + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: '2-digit' })}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs flex-wrap">
                      <span className="text-zinc-500">{s.total_cuts} cortes</span>
                      <span className="text-zinc-700">·</span>
                      <span className="text-zinc-400">Facturado {formatARS(s.gross_amount)}</span>
                      <span className="text-zinc-700">·</span>
                      <span className="text-amber-400 font-semibold">Neto {formatARS(s.net_payable)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
                      <span className={`text-xs font-semibold ${cfg.color}`}>{cfg.label}</span>
                    </div>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}
                      className={`w-3.5 h-3.5 text-zinc-600 transition-transform duration-150 flex-shrink-0 ${isExpanded ? 'rotate-90' : ''}`}>
                      <polyline points="9 18 15 12 9 6"/>
                    </svg>
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-zinc-800 px-4 py-3 space-y-2">
                    <SettlRow label={profile?.compensation_type === 'salary' ? 'Sueldo base' : 'Comisión'} value={formatARS(s.barber_gross)} />
                    {s.bonus_presentismo > 0 && <SettlRow label="+ Presentismo" value={formatARS(s.bonus_presentismo)} valueClass="text-emerald-400" />}
                    {s.bonus_objetivo > 0 && <SettlRow label="+ Objetivo" value={formatARS(s.bonus_objetivo)} valueClass="text-emerald-400" />}
                    <div className="h-px bg-zinc-800 my-0.5" />
                    <SettlRow label="Ganado" value={formatARS(s.total_earned)} />
                    {s.already_collected > 0 && <SettlRow label="– Ya cobrado (transf.)" value={formatARS(s.already_collected)} valueClass="text-zinc-400" />}
                    {s.advances_deducted > 0 && <SettlRow label="– Adelantos" value={formatARS(s.advances_deducted)} valueClass="text-red-400" />}
                    <div className="h-px bg-zinc-800 my-0.5" />
                    <SettlRow label="A recibir" value={formatARS(s.net_payable)} bold />
                    {s.presentismo_met !== null && (
                      <p className="text-xs text-zinc-600 mt-1">
                        Presentismo: {s.presentismo_met ? 'marcado' : 'no marcado'}
                        {s.objetivo_met !== null && <span> · Objetivo: {s.objetivo_met ? 'alcanzado' : 'no alcanzado'}</span>}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
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
      <header className="barber-header">
        <div className="barber-header__brand">
          <span className="barber-header__logo">VALHALLA</span>
        </div>
        <div className="barber-header__row">
          <div className="barber-header__user">
            <div className="barber-avatar-circle">
              {(profile?.full_name ?? 'U').split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
            </div>
            <div>
              <h1 className="barber-header__name">{profile?.full_name.split(' ')[0]}</h1>
              <p className="barber-header__sub">
                {week ? `Semana ${week.week_number} · ${formatDate(today)}` : ''}
              </p>
            </div>
          </div>
          <button onClick={handleLogout} className="icon-btn" aria-label="Salir">
            <IconLogout />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-5 pb-10 space-y-5">
        {profile?.birth_date && today.slice(5) === profile.birth_date.slice(5) && (
          <div className="birthday-banner">
            <div className="birthday-banner__icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
            </div>
            <div>
              <p className="birthday-banner__title">¡Feliz cumpleaños, {profile.full_name.split(' ')[0]}!</p>
              <p className="birthday-banner__sub">El equipo de Valhalla te desea un excelente año.</p>
            </div>
          </div>
        )}
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

        <button
          onClick={goToRegister}
          disabled={weekClosed || !todayAllowedForBarber || (!!selectedDay && selectedDay !== today)}
          className="register-btn w-full disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <div className="flex items-center justify-center gap-3">
            <IconScissors />
            <span className="text-xl font-bold">Registrar corte</span>
          </div>
          {weekClosed ? (
            <p className="text-xs text-amber-200/60 mt-1">Semana cerrada: tu liquidación ya fue confirmada</p>
          ) : !todayAllowedForBarber ? (
            <p className="text-xs text-amber-200/60 mt-1">Hoy no se cargan cortes (domingo/lunes). Si se trabaja, pedile al admin que habilite el día.</p>
          ) : !!selectedDay && selectedDay !== today && (
            <p className="text-xs text-amber-200/60 mt-1">Solo podés registrar cortes del día de hoy</p>
          )}
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

          {profile?.advance_enabled && (
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
          )}
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
                const isBlocked = !isBarberAllowedDay(d.date) // dom/lun no habilitado
                return (
                  <button
                    key={d.date}
                    onClick={() => setSelectedDay(d.date)}
                    title={isBlocked ? 'Día no habilitado para cargar cortes' : undefined}
                    className={`day-block ${isActive ? 'day-block--active' : ''} ${d.isToday ? 'day-block--today' : ''}`}
                    style={isBlocked && !isActive ? { opacity: 0.4 } : undefined}
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
                ) : filterMode === 'range' ? (
                  // ── Modo rango: agrupado por fecha, expandible ──
                  (() => {
                    const byDate: Record<string, Transaction[]> = {}
                    list.forEach((tx) => { (byDate[tx.transaction_date] ||= []).push(tx) })
                    const sortedDates = Object.keys(byDate).sort((a, b) => b.localeCompare(a))
                    return (
                      <div>
                        {sortedDates.map((date) => {
                          const dayList = byDate[date]
                          const dayTotal = dayList.reduce((s, t) => s + t.amount, 0)
                          const dayShare = dayList.reduce((s, t) => s + t.barber_share, 0)
                          const isOpen = expandedDates.has(date)
                          const label = new Date(date + 'T12:00:00').toLocaleDateString('es-AR', {
                            weekday: 'short', day: '2-digit', month: 'short',
                          })
                          return (
                            <div key={date} className={`tx-day-group ${isOpen ? 'tx-day-group--open' : ''}`}>
                              <button
                                onClick={() => {
                                  setExpandedDates((prev) => {
                                    const next = new Set(prev)
                                    if (next.has(date)) next.delete(date)
                                    else next.add(date)
                                    return next
                                  })
                                }}
                                className="tx-day-group__header"
                              >
                                <div className="tx-day-group__left">
                                  <span className="tx-day-group__arrow">▶</span>
                                  <span className="tx-day-group__date">{label}</span>
                                  <span className="tx-day-group__count">{dayList.length} {dayList.length === 1 ? 'corte' : 'cortes'}</span>
                                </div>
                                <div className="tx-day-group__right">
                                  <span className="tx-day-group__total">{formatARS(dayTotal)}</span>
                                  <span className="tx-day-group__share">tuya {formatARS(dayShare)}</span>
                                </div>
                              </button>
                              {isOpen && (
                                <div className="tx-day-group__body">
                                  <div className="tx-grid">
                                    {dayList.map((tx) => (
                                      <div key={tx.id} className="tx-card">
                                        <div className="tx-card__top">
                                          <div className={`payment-dot payment-dot--${tx.payment_method}`} />
                                          <span className="tx-card__date">
                                            {new Date(tx.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
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
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )
                  })()
                ) : (
                  // ── Modo semana: grilla normal del día seleccionado ──
                  <div className="tx-grid">
                    {list.map((tx) => (
                      <div key={tx.id} className="tx-card">
                        <div className="tx-card__top">
                          <div className={`payment-dot payment-dot--${tx.payment_method}`} />
                          <span className="tx-card__date">
                            {new Date(tx.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
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

function SettlRow({ label, value, valueClass, bold }: {
  label: string
  value: string
  valueClass?: string
  bold?: boolean
}) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-zinc-400">{label}</span>
      <span className={bold ? 'font-bold text-amber-400' : (valueClass ?? 'text-white')}>{value}</span>
    </div>
  )
}
