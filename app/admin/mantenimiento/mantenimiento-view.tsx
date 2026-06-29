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
  createMaintenanceSheetFromTemplate,
  regenerateMaintenanceSheet,
  setMaintenanceItemDone,
  setMaintenanceSheetMinPct,
  getMaintenanceWeeksWithSheet,
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

export default function MantenimientoView() {
  const router = useRouter()
  const [profile, setProfile]               = useState<Profile | null>(null)
  const [branches, setBranches]             = useState<Branch[]>([])
  const [selectedBranch, setSelectedBranch] = usePersistedBranch()
  const [barbers, setBarbers]               = useState<Profile[]>([])
  const [weeks, setWeeks]                    = useState<Week[]>([])
  const [weeksWithSheet, setWeeksWithSheet]  = useState<Set<string>>(new Set())
  const [selectedWeekId, setSelectedWeekId]  = useState<string>('')
  const [branchMinPct, setBranchMinPct]      = useState<number>(100)
  const [sheet, setSheet]                    = useState<MaintenanceSheetWithItems | null>(null)
  const [loading, setLoading]                = useState(true)
  const [sheetLoading, setSheetLoading]      = useState(false)
  const [error, setError]                    = useState<string | null>(null)
  const [actionError, setActionError]        = useState<string | null>(null)
  const [creating, setCreating]              = useState(false)
  const [regenerating, setRegenerating]      = useState(false)

  // Modo plantilla
  const [mode, setMode]              = useState<'sheet' | 'template'>('sheet')
  const [draftBlocks, setDraftBlocks] = useState<MaintenanceTemplateDraftBlock[]>([])
  const [savingTemplate, setSavingTemplate] = useState(false)

  const barberName = useCallback(
    (id: string) => barbers.find((b) => b.id === id)?.full_name ?? 'Barbero',
    [barbers]
  )

  const loadSheet = useCallback(async (branchId: string, weekId: string) => {
    if (!weekId) { setSheet(null); return }
    setSheetLoading(true)
    setActionError(null)
    try {
      const s = await getMaintenanceSheetByWeek(branchId, weekId)
      setSheet(s)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Error al cargar la planilla')
    } finally {
      setSheetLoading(false)
    }
  }, [])

  const loadInitial = useCallback(async () => {
    try {
      setLoading(true)
      const [p, bs] = await Promise.all([getCurrentProfile(), getMyBranchesCached()])
      if (!p) { setError('No autenticado'); return }
      if (bs.length === 0) { setError('No tenés sucursales asignadas.'); return }
      setProfile(p)
      setBranches(bs)

      const stored = getStoredBranch()
      const branch = stored && bs.some((b) => b.id === stored) ? stored : null
      if (!branch) { router.replace('/admin/select-branch'); return }
      setSelectedBranch(branch)

      const [barbersData, weeksData, settingsData, withSheet] = await Promise.all([
        getBarbersByBranch(branch),
        getWeeksByBranch(branch),
        getMaintenanceSettings(branch),
        getMaintenanceWeeksWithSheet(branch),
      ])
      setBarbers(barbersData)
      setWeeks(weeksData)
      setBranchMinPct(settingsData.min_approval_pct)
      setWeeksWithSheet(new Set(withSheet))

      const today = todayLocal()
      const current = weeksData.find((w) => w.start_date <= today && today <= w.end_date)
      const wid = current?.id ?? weeksData[0]?.id ?? ''
      setSelectedWeekId(wid)
      await loadSheet(branch, wid)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado')
    } finally {
      setLoading(false)
    }
  }, [router, setSelectedBranch, loadSheet])

  useEffect(() => { loadInitial() }, [loadInitial])

  function handleWeekChange(wid: string) {
    setSelectedWeekId(wid)
    loadSheet(selectedBranch, wid)
  }

  async function handleCreateSheet() {
    if (!profile || !selectedWeekId) return
    setCreating(true)
    setActionError(null)
    try {
      const created = await createMaintenanceSheetFromTemplate(selectedBranch, selectedWeekId, branchMinPct, profile.id)
      setSheet(created)
      setWeeksWithSheet((prev) => new Set(prev).add(selectedWeekId))
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Error al crear la planilla')
    } finally {
      setCreating(false)
    }
  }

  async function handleRegenerate() {
    if (!sheet) return
    const ok = window.confirm(
      'Regenerar la planilla desde la plantilla actual. Se reemplazan las tareas y se pierden los SÍ/NO ya marcados. ¿Continuar?'
    )
    if (!ok) return
    setRegenerating(true)
    setActionError(null)
    try {
      const updated = await regenerateMaintenanceSheet(sheet.id, selectedBranch)
      setSheet(updated)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Error al regenerar la planilla')
    } finally {
      setRegenerating(false)
    }
  }

  async function toggleItem(item: MaintenanceSheetItem) {
    if (!sheet) return
    const next = !item.done
    // Optimista
    setSheet({ ...sheet, items: sheet.items.map((i) => i.id === item.id ? { ...i, done: next } : i) })
    try {
      await setMaintenanceItemDone(item.id, next)
    } catch (e) {
      // revertir
      setSheet((s) => s ? { ...s, items: s.items.map((i) => i.id === item.id ? { ...i, done: item.done } : i) } : s)
      setActionError(e instanceof Error ? e.message : 'No se pudo guardar el cambio')
    }
  }

  async function handleSheetMinPct(pct: number) {
    if (!sheet || isNaN(pct)) return
    const clamped = Math.max(0, Math.min(100, pct))
    setSheet({ ...sheet, min_approval_pct: clamped })
    try {
      await setMaintenanceSheetMinPct(sheet.id, clamped)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'No se pudo actualizar el %')
    }
  }

  function exportPDF() {
    if (!sheet) return
    const branchName = branches.find((b) => b.id === selectedBranch)?.name ?? ''
    const week = weeks.find((w) => w.id === selectedWeekId)
    const blocks = groupByBarber(sheet.items).map((g) => ({
      barberName: barberName(g.barberId),
      zoneLabel: g.zoneLabel,
      tasks: g.items.map((it) => ({ item_number: it.item_number, description: it.description, done: it.done })),
    }))
    generateMaintenanceSheet({
      branchName,
      weekLabel: week ? weekRangeLabel(week) : '',
      minApprovalPct: sheet.min_approval_pct,
      blocks,
    })
  }

  // ── Plantilla ──────────────────────────────────────────────────────────
  async function enterTemplateMode() {
    setActionError(null)
    try {
      const tpl = await getMaintenanceTemplate(selectedBranch)
      const byBarber = new Map(tpl.map((b) => [b.barber_id, b]))
      const drafts: MaintenanceTemplateDraftBlock[] = barbers.map((b) => {
        const existing = byBarber.get(b.id)
        return {
          barber_id: b.id,
          // Default sugerido cuando aún no hay zona cargada
          zone_label: existing?.zone_label || 'Orden & Mantenimiento',
          tasks: existing ? existing.tasks.map((t) => ({ item_number: t.item_number, description: t.description })) : [],
        }
      })
      setDraftBlocks(drafts)
      setMode('template')
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Error al cargar la plantilla')
    }
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

  async function handleSaveTemplate() {
    setSavingTemplate(true)
    setActionError(null)
    try {
      const blocks = draftBlocks
        .map((b) => ({
          barber_id: b.barber_id,
          zone_label: b.zone_label.trim(),
          tasks: b.tasks
            .filter((t) => t.description.trim())
            .map((t, i) => ({ item_number: i + 1, description: t.description.trim() })),
        }))
        .filter((b) => b.zone_label || b.tasks.length > 0)
      await saveMaintenanceTemplate(selectedBranch, blocks)
      await upsertMaintenanceSettings(selectedBranch, branchMinPct)
      setMode('sheet')
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Error al guardar la plantilla')
    } finally {
      setSavingTemplate(false)
    }
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-zinc-400">Cargando mantenimiento...</div>
  if (error)   return <div className="p-6 text-red-400">{error}</div>

  // ── MODO PLANTILLA ───────────────────────────────────────────────────────
  if (mode === 'template') {
    return (
      <div className="w-full px-4 py-8 space-y-6">
        <div className="flowi-page-header flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Plantilla de mantenimiento</h1>
            <p className="text-zinc-400 text-sm mt-1">
              Definí la zona y las tareas de cada barbero. Se usa para crear la planilla de cada semana.
            </p>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setMode('sheet')}
              className="text-zinc-400 hover:text-white px-5 py-2.5 rounded-lg text-sm border border-zinc-700 hover:border-zinc-500 transition-colors">
              Volver
            </button>
            <button onClick={handleSaveTemplate} disabled={savingTemplate}
              className="bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-zinc-950 font-bold px-5 py-2.5 rounded-lg text-sm transition-colors">
              {savingTemplate ? 'Guardando...' : 'Guardar plantilla'}
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

        {barbers.length === 0 ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-10 text-center">
            <p className="text-zinc-500 text-sm">No hay barberos activos en esta sucursal.</p>
          </div>
        ) : draftBlocks.map((block) => (
          <div key={block.barber_id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <span className="text-white font-bold text-base">{barberName(block.barber_id)}</span>
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
      </div>
    )
  }

  // ── MODO PLANILLA ──────────────────────────────────────────────────────────
  const groups = sheet ? groupByBarber(sheet.items) : []

  // Navegación de semanas (weeks viene ordenado por start_date DESC: idx 0 = más nueva)
  const today = todayLocal()
  const currentWeekId = weeks.find((w) => w.start_date <= today && today <= w.end_date)?.id ?? null
  const selWeek = weeks.find((w) => w.id === selectedWeekId) ?? null
  const selIdx = weeks.findIndex((w) => w.id === selectedWeekId)
  const canNewer = selIdx > 0                       // semana siguiente (más reciente)
  const canOlder = selIdx >= 0 && selIdx < weeks.length - 1  // semana anterior (más vieja)
  const selHasSheet = selWeek ? weeksWithSheet.has(selWeek.id) : false

  // Salto rápido por fecha: elige la semana que contiene esa fecha (o la más cercana)
  function jumpToDate(dateStr: string) {
    if (!dateStr || weeks.length === 0) return
    const exact = weeks.find((w) => w.start_date <= dateStr && dateStr <= w.end_date)
    if (exact) { handleWeekChange(exact.id); return }
    // Sin semana que contenga la fecha (ej. domingo/lunes): la más cercana por inicio
    const nearest = [...weeks].sort(
      (a, b) => Math.abs(+new Date(a.start_date) - +new Date(dateStr)) - Math.abs(+new Date(b.start_date) - +new Date(dateStr))
    )[0]
    if (nearest) handleWeekChange(nearest.id)
  }

  return (
    <div className="w-full px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flowi-page-header flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Orden & mantenimiento</h1>
          <p className="text-zinc-400 text-sm mt-1">
            Planilla semanal por barbero. Marcá el cumplimiento y exportá el PDF.
          </p>
        </div>
        <button onClick={enterTemplateMode}
          className="inline-flex items-center gap-2 text-zinc-300 hover:text-white border border-zinc-700 hover:border-zinc-500 font-semibold px-4 py-2.5 rounded-lg text-sm transition-colors">
          ⚙️ Editar plantilla
        </button>
      </div>

      {/* Navegador de semana: flechas + semana actual + salto por fecha */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => canOlder && handleWeekChange(weeks[selIdx + 1].id)}
            disabled={!canOlder}
            title="Semana anterior"
            className="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-lg border border-zinc-700 text-zinc-300 hover:border-amber-500 hover:text-amber-400 disabled:opacity-30 disabled:cursor-not-allowed text-xl transition-colors"
          >‹</button>

          <div className="flex-1 text-center">
            <div className="text-white font-bold text-lg leading-tight">
              {selWeek ? `Semana ${selWeek.week_number}` : 'Sin semanas'}
            </div>
            {selWeek && (
              <div className="text-zinc-400 text-sm mt-0.5">
                {weekRangeLabel(selWeek)}
                {selWeek.id === currentWeekId && <span className="text-amber-400"> · actual</span>}
                {selHasSheet && <span className="text-emerald-400"> · ✓ con planilla</span>}
              </div>
            )}
          </div>

          <button
            onClick={() => canNewer && handleWeekChange(weeks[selIdx - 1].id)}
            disabled={!canNewer}
            title="Semana siguiente"
            className="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-lg border border-zinc-700 text-zinc-300 hover:border-amber-500 hover:text-amber-400 disabled:opacity-30 disabled:cursor-not-allowed text-xl transition-colors"
          >›</button>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-1 border-t border-zinc-800">
          {currentWeekId && selectedWeekId !== currentWeekId && (
            <button
              onClick={() => handleWeekChange(currentWeekId)}
              className="text-xs font-semibold text-amber-400 hover:text-amber-300 transition-colors"
            >
              ⤺ Ir a la semana actual
            </button>
          )}
          <label className="text-xs text-zinc-500 ml-auto">Ir a fecha</label>
          <input
            type="date"
            value={selWeek ? selWeek.start_date : ''}
            onChange={(e) => jumpToDate(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-amber-500"
          />
          {sheet && (
            <>
              <button onClick={handleRegenerate} disabled={regenerating}
                className="inline-flex items-center gap-2 text-zinc-300 hover:text-white border border-zinc-700 hover:border-zinc-500 disabled:opacity-40 font-semibold px-3 py-1.5 rounded-lg text-xs transition-colors"
                title="Reemplaza las tareas con la plantilla actual (resetea los SÍ/NO)">
                {regenerating ? 'Regenerando...' : '↻ Regenerar'}
              </button>
              <button onClick={exportPDF}
                className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold px-3 py-1.5 rounded-lg text-xs transition-colors">
                📄 Exportar PDF
              </button>
            </>
          )}
        </div>
      </div>

      {actionError && <p className="text-red-400 text-sm">{actionError}</p>}

      {sheetLoading ? (
        <div className="flex items-center justify-center h-40 text-zinc-400">Cargando planilla...</div>
      ) : !sheet ? (
        // Sin planilla para esta semana
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-12 text-center space-y-4">
          <p className="text-zinc-400 text-sm">Todavía no hay planilla para esta semana.</p>
          <button onClick={handleCreateSheet} disabled={creating}
            className="bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-zinc-950 font-bold px-5 py-2.5 rounded-lg text-sm transition-colors">
            {creating ? 'Creando...' : 'Crear planilla de esta semana'}
          </button>
          <p className="text-zinc-600 text-xs">Se copian las zonas y tareas desde la plantilla.</p>
        </div>
      ) : (
        <>
          {/* Control de % mínimo de la planilla */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-center gap-3">
            <label className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Aprobación mínima</label>
            <input type="number" min={0} max={100} value={sheet.min_approval_pct}
              onChange={(e) => handleSheetMinPct(parseInt(e.target.value) || 0)}
              className="w-20 bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500" />
            <span className="text-zinc-400 text-sm">% de tareas cumplidas</span>
          </div>

          {groups.length === 0 ? (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-10 text-center">
              <p className="text-zinc-500 text-sm">La planilla no tiene tareas. Editá la plantilla y recreala.</p>
            </div>
          ) : groups.map((g) => {
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
    </div>
  )
}
