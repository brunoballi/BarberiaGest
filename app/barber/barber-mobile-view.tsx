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
  getBarberSettlements,
  getServicesByBranch,
  registerCut,
  updateTransaction,
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

  const today = new Date().toISOString().split('T')[0]
  const todayTxs = transactions.filter((t) => t.transaction_date === today)
  const todayTotal = todayTxs.reduce((s, t) => s + t.amount, 0)
  const todayBarber = todayTxs.reduce((s, t) => s + t.barber_share, 0)
  const weekTotal = transactions.reduce((s, t) => s + t.amount, 0)
  const weekBarber = transactions.reduce((s, t) => s + t.barber_share, 0)
  const weekCuts = transactions.length

  const selectedServiceData = services.find((s) => s.name === selectedService)
  const resolvedAmount = customAmount
    ? parseFloat(customAmount)
    : selectedServiceData?.base_price ?? 0

  const commissionRate = profile?.commission_rate ?? 0.5
  const previewBarberShare = Math.round(resolvedAmount * commissionRate)
  const previewAlreadyCollected = paymentMethod !== 'cash' ? previewBarberShare : 0

  async function handleSubmit() {
    if (!profile || !week || !selectedService || !paymentMethod || resolvedAmount <= 0) return
    try {
      setSubmitting(true)
      const payload: RegisterCutPayload = {
        service_id: selectedServiceData?.id ?? null,
        amount: resolvedAmount,
        payment_method: paymentMethod,
        transaction_date: today,
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
    setLastRegistered(null)
    setView('home')
  }

  function goToRegister() {
    setSelectedService('')
    setCustomAmount('')
    setPaymentMethod(null)
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
              <span className="text-zinc-400">Ya en tu cuenta</span>
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
            {resolvedAmount > 0 && (
              <div className="preview-row mt-3">
                <span className="text-zinc-400 text-sm">Tu parte ({Math.round(commissionRate * 100)}%)</span>
                <span className="text-amber-400 font-bold text-lg">{formatARS(previewBarberShare)}</span>
              </div>
            )}
          </section>

          <section>
            <label className="section-label">Método de pago</label>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { method: 'cash' as PaymentMethod, label: 'Efectivo', Icon: IconCash },
                  { method: 'transfer' as PaymentMethod, label: 'Transf.', Icon: IconTransfer },
                  { method: 'card' as PaymentMethod, label: 'Tarjeta', Icon: IconCard },
                ] as const
              ).map(({ method, label, Icon }) => (
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
                  Ya depositado en tu cuenta
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

        <button
          onClick={goToSettlements}
          className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-5 py-4 flex items-center justify-between text-left"
        >
          <div>
            <p className="text-white font-semibold text-sm">Mis liquidaciones</p>
            <p className="text-zinc-500 text-xs mt-0.5">Historial de pagos semanales</p>
          </div>
          <span className="text-zinc-600 text-lg">›</span>
        </button>

        <section>
          <h2 className="section-label mb-3">Cortes de hoy</h2>
          {todayTxs.length === 0 ? (
            <div className="card text-center py-8">
              <p className="text-zinc-500 text-sm">Todavía no registraste cortes hoy</p>
            </div>
          ) : (
            <div className="space-y-2">
              {todayTxs.map((tx) => (
                <div key={tx.id} className="tx-row">
                  <div className="flex items-center gap-3">
                    <div className={`payment-dot payment-dot--${tx.payment_method}`} />
                    <div>
                      <p className="text-white text-sm font-medium">
                        {PAYMENT_METHOD_LABELS[tx.payment_method]}
                      </p>
                      <p className="text-zinc-500 text-xs">
                        {new Date(tx.created_at).toLocaleTimeString('es-AR', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-white text-sm font-semibold">{formatARS(tx.amount)}</p>
                      <p className="text-amber-400 text-xs">{formatARS(tx.barber_share)}</p>
                    </div>
                    <button onClick={() => openEditTx(tx)}
                      className="icon-btn flex-shrink-0" title="Editar">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
    </>
  )
}
