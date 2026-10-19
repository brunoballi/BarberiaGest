// Avisos al cliente cuando el turno lo carga alguien del equipo (admin o
// barbero) en vez de reservarlo él mismo desde /reservar.
//
// Es lo mismo que hace booking-view.tsx justo después de reservar: las rutas
// solo necesitan referencia + teléfono, no distinguen quién creó el turno, y
// cada aviso sale una sola vez por turno (claimNotice). Si WhatsApp o el mail
// no están configurados, o el envío falla, no se le muestra nada a quien
// cargó el turno: el turno ya quedó guardado.

export function avisarTurnoCargado(params: { reference: string; phone: string; email?: string | null }): void {
  const body = JSON.stringify({ reference: params.reference, phone: params.phone })
  const init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }

  if (params.email) fetch('/api/reservar/confirmar-email', init).catch(() => {})
  fetch('/api/reservar/confirmar-whatsapp', init).catch(() => {})
}
