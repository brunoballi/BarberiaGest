// ============================================================
// GENERADOR DE PDF — Planilla de Orden & Mantenimiento semanal
// Usa jsPDF + jspdf-autotable (texto nítido, seleccionable).
// Replica el formato del Excel: bloques por barbero con sus tareas,
// check de cumplimiento y RESULTADO FINAL, + notas al pie.
// ============================================================
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

export interface MaintenanceTaskRow {
  item_number: number
  description: string
  done: boolean
}

export interface MaintenanceBlock {
  barberName: string
  zoneLabel: string
  tasks: MaintenanceTaskRow[]
}

export interface MaintenanceSheetOptions {
  branchName: string
  weekLabel: string       // "09 al 13 jun" o rango de la semana
  minApprovalPct: number
  blocks: MaintenanceBlock[]
}

const BARBERSHOP_NAME = 'Valhalla'

// Notas fijas al pie de la planilla (replican el Excel original).
const FOOTER_NOTES = [
  'Los insumos (limpieza o barbería) se reponen los días lunes.',
  'Tolerancia de la planilla semanal de cortes: hasta las 14 hs del lunes.',
  'Todos los martes, al limpiar el calentador de toallas, se deben cambiar por toallas limpias.',
]

/**
 * Genera y descarga el PDF de la planilla semanal. Client-side.
 * El PDF es un documento para imprimir y completar a mano (casilleros vacíos).
 */
export function generateMaintenanceSheet(options: MaintenanceSheetOptions): void {
  const { branchName, weekLabel, minApprovalPct, blocks } = options

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()

  // ── Encabezado ──────────────────────────────────────────
  doc.setFontSize(16)
  doc.setTextColor(24, 24, 27)
  doc.text(`${BARBERSHOP_NAME} · ${branchName}`, 14, 18)

  doc.setFontSize(11)
  doc.setTextColor(82, 82, 91)
  doc.text('Planilla de orden & mantenimiento', 14, 25)
  doc.setFontSize(10)
  doc.setTextColor(113, 113, 122)
  doc.text(`Semana ${weekLabel}  ·  Aprobación mínima: ${minApprovalPct}%`, 14, 31)
  doc.text(`Generado: ${new Date().toLocaleString('es-AR')}`, pageWidth - 14, 18, { align: 'right' })

  // ── Un bloque (tabla) por barbero ───────────────────────
  // El PDF es para imprimir y completar A MANO: la columna "Cumple" es un
  // casillero vacío para tildar con lapicera, y el RESULTADO se marca a mano.
  let cursorY = 37
  blocks.forEach((b) => {
    // Salto de página si no entra el encabezado del bloque
    if (cursorY > pageHeight - 50) {
      doc.addPage()
      cursorY = 18
    }

    doc.setFontSize(11)
    doc.setTextColor(24, 24, 27)
    const zone = b.zoneLabel ? `${b.zoneLabel.toUpperCase()} — ` : ''
    doc.text(`${zone}${b.barberName}`, 14, cursorY)
    cursorY += 3

    autoTable(doc, {
      startY: cursorY,
      head: [['N°', 'Tarea', 'Cumple']],
      // Celda "Cumple" vacía: dibujamos el casillero en didDrawCell
      body: b.tasks.map((t) => [String(t.item_number), t.description, '']),
      theme: 'striped',
      headStyles: { fillColor: [63, 63, 70], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
      columnStyles: {
        0: { halign: 'center', cellWidth: 12 },
        2: { halign: 'center', cellWidth: 20 },
      },
      styles: { fontSize: 9, cellPadding: 2.5 },
      // Dibuja un casillero vacío centrado en la columna "Cumple"
      didDrawCell: (data) => {
        if (data.section === 'body' && data.column.index === 2) {
          const size = 4
          const cx = data.cell.x + data.cell.width / 2 - size / 2
          const cy = data.cell.y + data.cell.height / 2 - size / 2
          doc.setDrawColor(82, 82, 91)
          doc.setLineWidth(0.3)
          doc.rect(cx, cy, size, size)
        }
      },
    })

    // @ts-expect-error lastAutoTable lo agrega el plugin en runtime
    const afterTableY: number = doc.lastAutoTable.finalY
    // RESULTADO FINAL para completar a mano: dos casilleros
    const ry = afterTableY + 7
    doc.setFontSize(10)
    doc.setTextColor(24, 24, 27)
    doc.text('RESULTADO:', 14, ry)
    doc.setDrawColor(82, 82, 91)
    doc.setLineWidth(0.3)
    doc.rect(40, ry - 3.2, 4, 4)
    doc.setTextColor(82, 82, 91)
    doc.text('APROBADO', 46, ry)
    doc.rect(74, ry - 3.2, 4, 4)
    doc.text('NO APROBADO', 80, ry)
    cursorY = afterTableY + 15
  })

  // ── Notas al pie ────────────────────────────────────────
  if (cursorY > pageHeight - 40) {
    doc.addPage()
    cursorY = 18
  }
  doc.setDrawColor(212, 212, 216)
  doc.line(14, cursorY, pageWidth - 14, cursorY)
  cursorY += 6
  doc.setFontSize(9)
  doc.setTextColor(82, 82, 91)
  doc.text('Notas:', 14, cursorY)
  cursorY += 5
  doc.setTextColor(113, 113, 122)
  FOOTER_NOTES.forEach((note) => {
    const lines = doc.splitTextToSize(`•  ${note}`, pageWidth - 28)
    doc.text(lines, 16, cursorY)
    cursorY += lines.length * 4.5
  })

  const safeWeek = weekLabel.replace(/\s+/g, '-').toLowerCase()
  doc.save(`mantenimiento-${safeWeek}.pdf`)
}
