'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { usePersistedBranch, getStoredBranch } from '@/lib/hooks/usePersistedBranch'
import { getMyBranchesCached } from '@/lib/hooks/use-catalogs'
import type {
  Branch,
  Profile,
  Week,
  MaintenanceSheetWithItems,
  MaintenanceSheetItem,
  MaintenanceTemplateDraftBlock,
  MaintenanceTemplateBlockWithTasks,
} from '@/lib/supabase/database.types'
import {
  getCurrentProfile,
  getBarbersByBranch,
  getWeeksByBranch,
  getMaintenanceSettings,
  upsertMaintenanceSettings,
  getMaintenanceTemplate,
  saveMaintenanceTemplate,
  getMaintenanceSheetByWeek,
  syncMaintenanceSheetFromTemplate,
  addMissingTemplateItemsToSheet,
  setMaintenanceItemDone,
  setMaintenanceSheetMinPct,
  todayLocal,
} from '@/lib/supabase/supabase.client'
import { generateMaintenanceSheet } from '@/lib/pdf/maintenance-sheet'

// ─── Utilidades ──────────────────────────────────────────────────────────
function fmtDM(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
}
function weekRangeLabel(w: Week): string {
  return `${fmtDM(w.start_date)} – ${fmtDM(w.end_date)}`
}

/** APROBADO si el % de tareas cumplidas alcanza el mínimo. */
function blockResult(items: { done: boolean }[], minPct: number): { label: string; pct: number; ok: boolean } {
  if (items.length === 0) return { label: '—', pct: 0, ok: false }
  const done = items.filter((i) => i.done).length
  const pct = Math.round((done / items.length) * 100)
  return { label: pct >= minPct ? 'APROBADO' : 'NO APROBADO', pct, ok: pct >= minPct }
}

/**
 * Arma el editor: una fila por barbero activo, con lo que ya tenga cargado
 * (o vacía si nunca se le cargó nada).
 */
function buildTemplateDraft(
  barbers: Pick<Profile, 'id'>[],
  tpl: MaintenanceTemplateBlockWithTasks[],
): MaintenanceTemplateDraftBlock[] {
  const byBarber = new Map(tpl.map((b) => [b.barber_id, b]))
  return barbers.map((b) => {
    const existing = byBarber.get(b.id)
    return {
      barber_id: b.id,
      zone_label: existing?.zone_label || 'Orden & Mantenimiento',
      tasks: existing
        ? existing.tasks.map((t) => ({ item_number: t.item_number, description: t.description }))
        : [],
    }
  })
}

/**
 * Trae la planilla de una semana y, si todavía no existe, la materializa desde la
 * plantilla de la sucursal. Es lo que hace que el checklist exista en cualquier
 * semana que el admin abra, sin depender de que se acuerde de apretar Guardar
 * (antes la planilla nacía solo como efecto secundario de guardar).
 *
 * Si YA existe se le agregan los ítems de la plantilla que le falten, sin borrar
 * ninguno: una planilla vieja puede ser el snapshot de cuando la plantilla era
 * más chica y dejaba barberos sin tareas (y por lo tanto sin bloqueo). Reemplazarla
 * entera borraría tareas de una semana ya liquidada, que es historia.
 *
 * Devuelve null si la plantilla no tiene ninguna tarea (nada que exigir).
 */
async function fetchOrCreateSheet(
  branchId: string,
  weekId: string,
  minPct: number,
  profileId: string,
): Promise<MaintenanceSheetWithItems | null> {
  const existing = await getMaintenanceSheetByWeek(branchId, weekId)
  if (existing) return addMissingTemplateItemsToSheet(branchId, weekId)
  return syncMaintenanceSheetFromTemplate(branchId, weekId, minPct, profileId)
}

/** Agrupa los ítems de la planilla por barbero, preservando el orden de la plantilla. */
function groupByBarber(items: MaintenanceSheetItem[]): { barberId: string; zoneLabel: string; items: MaintenanceSheetItem[] }[] {
  const groups: { barberId: string; zoneLabel: string; items: MaintenanceSheetItem[] }[] = []
  const idx = new Map<string, number>()
  items.forEach((it) => {
    if (!idx.has(it.barber_id)) {
      idx.set(it.barber_id, groups.length)
      groups.push({ barberId: it.barber_id, zoneLabel: it.zone_label, items: [] })
    }
    groups[idx.get(it.barber_id)!].items.push(it)
  })
  return groups
}

// ─────────────────────────────────────────────────────────────────────────
// COMPONENTE PRINCIPAL
//
// Una sola pantalla: se define la planilla (zona + tareas por barbero) y, una
// vez guardada, aparece abajo el cumplimiento SÍ/NO de la semana en curso.
// La definición NO se maneja semana a semana: vale hasta que se cambie. Lo que
// sí queda por semana es el cumplimiento, porque el bono se liquida semanal.
// ─────────────────────────────────────────────────────────────────────────
export default function MantenimientoView() {
  const router = useRouter()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [branches, setBranches] = useState<Branch[]>([])
  const [selectedBranch, setSelectedBranch] = usePersistedBranch()
  const [barbers, setBarbers] = useState<Profile[]>([])

  /** Semana en curso: se resuelve sola y es la que se sincroniza al guardar. */
  const [currentWeek, setCurrentWeek] = useState<Week | null>(null)
  /**
   * Semana cuyo cumplimiento se está marcando. Arranca en la actual, pero el
   * admin puede elegir otra del mes: las liquidaciones de una semana se cierran
   * recién cuando esa semana ya terminó, así que al liquidar necesita poder
   * completar el checklist de una semana pasada (si no, el bono de mantenimiento
   * queda bloqueado sin forma de destrabarlo).
   */
  const [weeks, setWeeks] = useState<Week[]>([])
  const [sheetWeek, setSheetWeek] = useState<Week | null>(null)
  const [sheet, setSheet] = useState<MaintenanceSheetWithItems | null>(null)
  const [loadingSheet, setLoadingSheet] = useState(false)

  const [draftBlocks, setDraftBlocks] = useState<MaintenanceTemplateDraftBlock[]>([])
  const [branchMinPct, setBranchMinPct] = useState(100)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [clearing, setClearing] = useState(false)

  const barberName = useCallback(
    (id: string) => barbers.find((b) => b.id === id)?.full_name ?? 'Barbero',
    [barbers]
  )

  const loadInitial = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const [p, bs] = await Promise.all([getCurrentProfile(), getMyBranchesCached()])
      if (!p) { setError('No autenticado'); return }
      if (bs.length === 0) { setError('No tenés sucursales asignadas.'); return }
      setProfile(p)
      setBranches(bs)

      const stored = getStoredBranch()
      const branch = stored && bs.some((b) => b.id === stored) ? stored : null
      if (!branch) { router.replace('/admin/select-branch'); return }
      setSelectedBranch(branch)

      const [barbersData, weeksData, settingsData, tpl] = await Promise.all([
        getBarbersByBranch(branch),
        getWeeksByBranch(branch),
        getMaintenanceSettings(branch),
        getMaintenanceTemplate(branch),
      ])
      setBarbers(barbersData)
      setBranchMinPct(settingsData.min_approval_pct)
      setDraftBlocks(buildTemplateDraft(barbersData, tpl))

      const today = todayLocal()
      const week = weeksData.find((w) => w.start_date <= today && today <= w.end_date) ?? weeksData[0] ?? null
      setWeeks(weeksData)
      setCurrentWeek(week)
      setSheetWeek(week)
      if (week) {
        setSheet(await fetchOrCreateSheet(branch, week.id, settingsData.min_approval_pct, p.id))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado')
    } finally {
      setLoading(false)
    }
  }, [router, setSelectedBranch])

  useEffect(() => { loadInitial() }, [loadInitial])

  /** Cambia la semana del checklist (actual ↔ anterior) y trae su planilla. */
  async function selectSheetWeek(week: Week) {
    if (sheetWeek?.id === week.id) return
    setSheetWeek(week)
    setActionError(null)
    setLoadingSheet(true)
    try {
      setSheet(
        profile
          ? await fetchOrCreateSheet(selectedBranch, week.id, branchMinPct, profile.id)
          : await getMaintenanceSheetByWeek(selectedBranch, week.id)
      )
    } catch (e) {
      setSheet(null)
      setActionError(e instanceof Error ? e.message : 'Error al cargar el cumplimiento de la semana')
    } finally {
      setLoadingSheet(false)
    }
  }

  // ── Edición de la planilla ─────────────────────────────────────────────
  /**
   * Cambia el barbero de una fila. Como hay una fila por barbero
   * (UNIQUE(branch_id, barber_id) en la base), elegir uno que ya tiene fila no
   * puede duplicarlo: se intercambian.
   */
  function setDraftBarber(currentBarberId: string, newBarberId: string) {
    if (!newBarberId || currentBarberId === newBarberId) return
    setDraftBlocks((prev) => {
      const ocupado = prev.some((b) => b.barber_id === newBarberId)
      if (!ocupado) {
        return prev.map((b) => b.barber_id === currentBarberId ? { ...b, barber_id: newBarberId } : b)
      }
      return prev.map((b) => {
        if (b.barber_id === currentBarberId) return { ...b, barber_id: newBarberId }
        if (b.barber_id === newBarberId) return { ...b, barber_id: currentBarberId }
        return b
      })
    })
  }

  function setDraftZone(barberId: string, zone: string) {
    setDraftBlocks((prev) => prev.map((b) => b.barber_id === barberId ? { ...b, zone_label: zone } : b))
  }
  function addDraftTask(barberId: string) {
    setDraftBlocks((prev) => prev.map((b) => b.barber_id === barberId
      ? { ...b, tasks: [...b.tasks, { item_number: b.tasks.length + 1, description: '' }] }
      : b))
  }
  function setDraftTask(barberId: string, idx: number, desc: string) {
    setDraftBlocks((prev) => prev.map((b) => b.barber_id === barberId
      ? { ...b, tasks: b.tasks.map((t, i) => i === idx ? { ...t, description: desc } : t) }
      : b))
  }
  function removeDraftTask(barberId: string, idx: number) {
    setDraftBlocks((prev) => prev.map((b) => b.barber_id === barberId
      ? { ...b, tasks: b.tasks.filter((_, i) => i !== idx).map((t, i) => ({ ...t, item_number: i + 1 })) }
      : b))
  }

  /** Guarda la planilla y deja el cumplimiento de la semana en curso al día. */
  async function persist(blocks: MaintenanceTemplateDraftBlock[]) {
    const clean = blocks
      .map((b) => ({
        barber_id: b.barber_id,
        zone_label: b.zone_label.trim() || 'Orden & Mantenimiento',
        tasks: b.tasks
          .filter((t) => t.description.trim())
          .map((t, i) => ({ item_number: i + 1, description: t.description.trim() })),
      }))
      // Solo se persisten las filas CON tareas: si no, quedaban bloques fantasma
      // de cada barbero que reaparecían aunque nunca se les cargó nada.
      .filter((b) => b.tasks.length > 0)

    await saveMaintenanceTemplate(selectedBranch, clean)
    await upsertMaintenanceSettings(selectedBranch, branchMinPct)

    if (profile) {
      // Se sincronizan la semana EN CURSO y la que se está viendo (si es otra):
      // guardar con una semana futura seleccionada tiene que crearle la planilla
      // a ESA semana, si no el botón no hace nada visible.
      //
      // syncMaintenanceSheetFromTemplate es idempotente y preserva los SÍ/NO ya
      // marcados (los reconoce por barbero + descripción), así que resincronizar
      // no borra avance.
      const objetivo = [currentWeek, sheetWeek].filter(
        (w, i, arr): w is Week => w != null && arr.findIndex((x) => x?.id === w.id) === i
      )
      for (const w of objetivo) {
        const synced = await syncMaintenanceSheetFromTemplate(
          selectedBranch, w.id, branchMinPct, profile.id
        )
        if (sheetWeek?.id === w.id) setSheet(synced)
      }
    }

    const tpl = await getMaintenanceTemplate(selectedBranch)
    setDraftBlocks(buildTemplateDraft(barbers, tpl))
  }

  async function handleSave() {
    setSaving(true)
    setActionError(null)
    try {
      await persist(draftBlocks)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Error al guardar la planilla')
    } finally {
      setSaving(false)
    }
  }

  /** Vacía las tareas de todos los barberos, dejando las secciones con su zona. */
  async function handleClear() {
    const ok = window.confirm(
      'Se van a borrar todas las tareas de todos los barberos (y el cumplimiento de esta semana). Las secciones quedan vacías para cargarlas de nuevo. ¿Continuar?'
    )
    if (!ok) return
    setClearing(true)
    setActionError(null)
    try {
      const vaciado = draftBlocks.map((b) => ({ ...b, tasks: [] }))
      setDraftBlocks(vaciado)
      await persist(vaciado)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Error al eliminar la planilla')
    } finally {
      setClearing(false)
    }
  }

  // ── Cumplimiento ───────────────────────────────────────────────────────
  async function toggleItem(item: MaintenanceSheetItem) {
    if (!sheet) return
    const next = !item.done
    setSheet({ ...sheet, items: sheet.items.map((i) => i.id === item.id ? { ...i, done: next } : i) })
    try {
      await setMaintenanceItemDone(item.id, next)
    } catch (e) {
      setSheet((s) => s ? { ...s, items: s.items.map((i) => i.id === item.id ? { ...i, done: item.done } : i) } : s)
      setActionError(e instanceof Error ? e.message : 'No se pudo guardar el cambio')
    }
  }

  async function handleSheetMinPct(pct: number) {
    if (!sheet) return
    const clamped = Math.max(0, Math.min(100, pct))
    setSheet({ ...sheet, min_approval_pct: clamped })
    try {
      await setMaintenanceSheetMinPct(sheet.id, clamped)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'No se pudo guardar el mínimo')
    }
  }

  function exportPDF() {
    if (!sheet) return
    const branchName = branches.find((b) => b.id === selectedBranch)?.name ?? ''
    const blocks = groupByBarber(sheet.items).map((g) => ({
      barberName: barberName(g.barberId),
      zoneLabel: g.zoneLabel,
      tasks: g.items.map((it) => ({ item_number: it.item_number, description: it.description, done: it.done })),
    }))
    generateMaintenanceSheet({
      branchName,
      weekLabel: sheetWeek ? weekRangeLabel(sheetWeek) : '',
      minApprovalPct: sheet.min_approval_pct,
      blocks,
    })
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-zinc-400">Cargando mantenimiento...</div>
  if (error)   return <div className="p-6 text-red-400">{error}</div>

  const groups = sheet ? groupByBarber(sheet.items) : []
  const hayTareas = draftBlocks.some((b) => b.tasks.some((t) => t.description.trim()))

  /**
   * Semanas elegibles: las del mes corriente. Se agrega la última del mes
   * anterior SOLO cuando la semana en curso es la primera del mes, porque en ese
   * caso la que se está liquidando cae fuera del mes y quedaría inalcanzable
   * (que es justo el bloqueo que este selector viene a evitar).
   */
  const weekOptions = (() => {
    if (!currentWeek) return []
    const delMes = weeks
      .filter((w) => w.month_id === currentWeek.month_id)
      .sort((a, b) => a.start_date.localeCompare(b.start_date))
    // weeks viene DESC por start_date: la primera anterior a la actual es la inmediata.
    const previa = weeks.find((w) => w.start_date < currentWeek.start_date) ?? null
    return previa && previa.month_id !== currentWeek.month_id ? [previa, ...delMes] : delMes
  })()

  return (
    <div className="w-full px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flowi-page-header flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Plantilla de mantenimiento</h1>
          <p className="text-zinc-400 text-sm mt-1">
            Definí la zona y las tareas de cada barbero. Queda fija hasta que la cambies.
          </p>
        </div>
        <div className="flex gap-3">
          {hayTareas && (
            <button onClick={handleClear} disabled={clearing}
              className="text-zinc-400 hover:text-red-400 border border-zinc-700 hover:border-red-500 disabled:opacity-40 font-semibold px-4 py-2.5 rounded-lg text-sm transition-colors">
              {clearing ? 'Eliminando...' : '🗑 Eliminar planilla'}
            </button>
          )}
          <button onClick={handleSave} disabled={saving}
            className="bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-zinc-950 font-bold px-5 py-2.5 rounded-lg text-sm transition-colors">
            {saving ? 'Guardando...' : 'Guardar plantilla'}
          </button>
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-center gap-3">
        <label className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Aprobación mínima por defecto</label>
        <input type="number" min={0} max={100} value={branchMinPct}
          onChange={(e) => setBranchMinPct(Math.max(0, Math.min(100, parseInt(e.target.value) || 0)))}
          className="w-20 bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500" />
        <span className="text-zinc-400 text-sm">%</span>
      </div>

      {actionError && <p className="text-red-400 text-sm">{actionError}</p>}

      {/* Editor: una sección por barbero */}
      {barbers.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-10 text-center">
          <p className="text-zinc-500 text-sm">No hay barberos activos en esta sucursal.</p>
        </div>
      ) : draftBlocks.map((block, blockIdx) => (
        // key por posición, NO por barber_id: el desplegable intercambia el barbero
        // entre filas y si la key cambiara React las reordenaría, mezclando las
        // tareas que se ven con las que se guardan.
        <div key={blockIdx} className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <select
              value={block.barber_id}
              onChange={(e) => setDraftBarber(block.barber_id, e.target.value)}
              title="Cambiar el barbero responsable de esta zona"
              className="sm:w-52 bg-zinc-800 border border-zinc-700 text-white font-bold rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
            >
              {barbers.map((b) => (
                <option key={b.id} value={b.id}>{b.full_name}</option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Zona / responsabilidad (ej: Frente / entrada)"
              value={block.zone_label}
              onChange={(e) => setDraftZone(block.barber_id, e.target.value)}
              className="flex-1 bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
            />
          </div>
          <div className="space-y-2">
            {block.tasks.map((t, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-zinc-500 text-sm w-6 text-right">{i + 1}.</span>
                <input
                  type="text"
                  placeholder="Descripción de la tarea"
                  value={t.description}
                  onChange={(e) => setDraftTask(block.barber_id, i, e.target.value)}
                  className="flex-1 bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
                />
                <button onClick={() => removeDraftTask(block.barber_id, i)}
                  className="text-zinc-500 hover:text-red-400 text-sm px-2" title="Quitar tarea">✕</button>
              </div>
            ))}
            <button onClick={() => addDraftTask(block.barber_id)}
              className="text-xs text-amber-400 hover:text-amber-300 font-semibold mt-1">
              + Agregar tarea
            </button>
          </div>
        </div>
      ))}

      {/* Cumplimiento por semana. La definición de tareas es fija; lo que se marca
          es semanal, porque el bono de mantenimiento se liquida por semana. */}
      {(sheet || hayTareas) && (
        <>
          <div className="border-t border-zinc-800 mt-4 pt-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-white">Cumplimiento de la semana</h2>
              <p className="text-zinc-400 text-sm mt-1">
                Marcá qué tareas se cumplieron. El bono de mantenimiento se habilita
                en Liquidaciones solo si el barbero no tiene tareas pendientes.
              </p>
            </div>
            {sheet && groups.length > 0 && (
              <button onClick={exportPDF}
                className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold px-4 py-2.5 rounded-lg text-sm transition-colors">
                📄 Exportar PDF
              </button>
            )}
          </div>

          {/* Las liquidaciones de una semana se cierran cuando esa semana ya
              terminó, así que el admin tiene que poder volver atrás dentro del mes. */}
          {weekOptions.length > 0 && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-wrap items-center gap-3">
              <label className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Semana</label>
              <select
                value={sheetWeek?.id ?? ''}
                onChange={(e) => {
                  const w = weekOptions.find((x) => x.id === e.target.value)
                  if (w) selectSheetWeek(w)
                }}
                className="bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
              >
                {weekOptions.map((w) => (
                  <option key={w.id} value={w.id}>
                    Semana {w.week_number} · {weekRangeLabel(w)}
                    {w.id === currentWeek?.id ? ' (en curso)' : ''}
                    {w.month_id !== currentWeek?.month_id ? ' (mes anterior)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {loadingSheet ? (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-10 text-center">
              <p className="text-zinc-500 text-sm">Cargando cumplimiento...</p>
            </div>
          ) : !sheet || groups.length === 0 ? (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-10 text-center">
              <p className="text-zinc-500 text-sm">
                Esta semana no tiene planilla de mantenimiento.
              </p>
              {hayTareas ? (
                <p className="text-zinc-600 text-xs mt-2">
                  Apretá <span className="text-amber-500 font-semibold">Guardar plantilla</span> para
                  crearla en esta semana con las tareas de arriba. Hasta entonces el bono
                  de mantenimiento queda habilitado en Liquidaciones.
                </p>
              ) : (
                <p className="text-zinc-600 text-xs mt-2">
                  Sin tareas cargadas no hay nada que exigir: el bono de mantenimiento
                  queda habilitado en Liquidaciones.
                </p>
              )}
            </div>
          ) : (
          <>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-center gap-3">
            <label className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Aprobación mínima</label>
            <input type="number" min={0} max={100} value={sheet.min_approval_pct}
              onChange={(e) => handleSheetMinPct(parseInt(e.target.value) || 0)}
              className="w-20 bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500" />
            <span className="text-zinc-400 text-sm">% de tareas cumplidas</span>
            <span className="text-zinc-600 text-xs">· indicador visual, no afecta el bono</span>
          </div>

          {groups.map((g) => {
            const res = blockResult(g.items, sheet.min_approval_pct)
            return (
              <div key={g.barberId} className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-zinc-800 flex items-center justify-between gap-3">
                  <div>
                    <span className="text-white font-bold text-base">{barberName(g.barberId)}</span>
                    {g.zoneLabel && <span className="text-zinc-500 text-sm ml-2">· {g.zoneLabel}</span>}
                  </div>
                  <span className={`text-xs font-bold px-3 py-1 rounded-full ${
                    res.label === '—' ? 'bg-zinc-800 text-zinc-500'
                      : res.ok ? 'bg-emerald-500/15 text-emerald-400'
                      : 'bg-red-500/15 text-red-400'
                  }`}>
                    {res.label}{res.label !== '—' ? ` · ${res.pct}%` : ''}
                  </span>
                </div>
                <div className="divide-y divide-zinc-800">
                  {g.items.map((it) => (
                    <div key={it.id} className="px-5 py-3 flex items-center gap-3">
                      <span className="text-zinc-600 text-sm w-6 text-right flex-shrink-0">{it.item_number}.</span>
                      <span className="flex-1 text-zinc-200 text-sm">{it.description}</span>
                      <button
                        onClick={() => toggleItem(it)}
                        className={`flex-shrink-0 w-16 text-center text-xs font-bold px-3 py-1.5 rounded-lg border transition-colors ${
                          it.done
                            ? 'bg-emerald-500/15 border-emerald-600 text-emerald-400'
                            : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-500'
                        }`}
                      >
                        {it.done ? 'SÍ' : 'NO'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
          </>
          )}
        </>
      )}
    </div>
  )
}
