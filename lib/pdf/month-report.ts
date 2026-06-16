// ============================================================
// GENERADOR DE PDF — Detalle Mensual por Barbero
// Usa jsPDF + jspdf-autotable (texto nítido, seleccionable).
// ============================================================
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

export interface MonthReportRow {
  barberName: string
  cuts: number
  billed: number
  commission: number
  toCollect: number
}

export interface MonthReportTx {
  date: string         // fecha ya formateada (ej: "16 jun")
  barberName: string
  service: string
  method: string       // etiqueta legible del método de pago
  amount: number
  commission: number
}

export interface MonthReportOptions {
  monthLabel: string          // "Junio 2026"
  branchName: string          // nombre de la sucursal
  barberFilterLabel?: string  // "Todos los barberos" o nombre del barbero filtrado
  rows: MonthReportRow[]
  transactions?: MonthReportTx[]  // detalle de transacciones (opcional)
}

// Nombre de la barbería (marca). Se muestra antes de la sucursal en el PDF.
const BARBERSHOP_NAME = 'Valhalla'

function formatARS(n: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(n)
}

/**
 * Genera y descarga un PDF con el acumulado mensual por barbero.
 * Se ejecuta en el momento (client-side) con los datos ya calculados.
 */
export function generateMonthReport(options: MonthReportOptions): void {
  const { monthLabel, branchName, barberFilterLabel, rows, transactions } = options

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()

  // ── Encabezado ──────────────────────────────────────────
  // Barbería + sucursal como título principal (identidad del documento).
  doc.setFontSize(16)
  doc.setTextColor(24, 24, 27)
  doc.text(`${BARBERSHOP_NAME} · ${branchName}`, 14, 18)

  doc.setFontSize(11)
  doc.setTextColor(82, 82, 91)
  doc.text(`Detalle mensual · ${monthLabel}`, 14, 25)
  if (barberFilterLabel) {
    doc.setFontSize(10)
    doc.setTextColor(113, 113, 122)
    doc.text(`Filtro: ${barberFilterLabel}`, 14, 31)
  }
  doc.setFontSize(10)
  doc.setTextColor(113, 113, 122)
  doc.text(
    `Generado: ${new Date().toLocaleString('es-AR')}`,
    pageWidth - 14,
    18,
    { align: 'right' }
  )

  // ── Totales ─────────────────────────────────────────────
  const totals = rows.reduce(
    (acc, r) => ({
      cuts: acc.cuts + r.cuts,
      billed: acc.billed + r.billed,
      commission: acc.commission + r.commission,
      toCollect: acc.toCollect + r.toCollect,
    }),
    { cuts: 0, billed: 0, commission: 0, toCollect: 0 }
  )

  // ── Tabla por barbero ───────────────────────────────────
  autoTable(doc, {
    startY: barberFilterLabel ? 37 : 31,
    head: [['Barbero', 'Cortes', 'Facturado', 'Comisión', 'A cobrar']],
    body: rows.map((r) => [
      r.barberName,
      String(r.cuts),
      formatARS(r.billed),
      formatARS(r.commission),
      formatARS(r.toCollect),
    ]),
    foot: [[
      'TOTAL',
      String(totals.cuts),
      formatARS(totals.billed),
      formatARS(totals.commission),
      formatARS(totals.toCollect),
    ]],
    theme: 'striped',
    headStyles: { fillColor: [63, 63, 70], textColor: [255, 255, 255], fontStyle: 'bold' },
    footStyles: { fillColor: [39, 39, 42], textColor: [255, 255, 255], fontStyle: 'bold' },
    columnStyles: {
      1: { halign: 'center' },
      2: { halign: 'right' },
      3: { halign: 'right' },
      4: { halign: 'right' },
    },
    styles: { fontSize: 9, cellPadding: 2.5 },
  })

  // ── Detalle de transacciones (opcional) ─────────────────
  if (transactions && transactions.length > 0) {
    const afterFirst = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY
    doc.setFontSize(11)
    doc.setTextColor(24, 24, 27)
    doc.text(`Transacciones (${transactions.length})`, 14, afterFirst + 10)

    autoTable(doc, {
      startY: afterFirst + 13,
      head: [['Fecha', 'Barbero', 'Servicio', 'Método', 'Monto', 'Comisión']],
      body: transactions.map((t) => [
        t.date,
        t.barberName,
        t.service,
        t.method,
        formatARS(t.amount),
        formatARS(t.commission),
      ]),
      theme: 'striped',
      headStyles: { fillColor: [63, 63, 70], textColor: [255, 255, 255], fontStyle: 'bold' },
      columnStyles: {
        4: { halign: 'right' },
        5: { halign: 'right' },
      },
      styles: { fontSize: 8, cellPadding: 2 },
    })
  }

  const fileName = `detalle-mensual-${monthLabel.replace(/\s+/g, '-').toLowerCase()}.pdf`
  doc.save(fileName)
}
