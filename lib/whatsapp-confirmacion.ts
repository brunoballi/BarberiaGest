// ============================================================
// Envío de la confirmación de un turno por WhatsApp (SOLO servidor).
//
// La usan la reserva pública (/api/reservar/confirmar-whatsapp) y el reenvío
// del administrador cuando corrige un número mal cargado
// (/api/turnos/corregir-telefono). Los controles de quién puede pedir el envío
// y cuántas veces son de cada ruta.
// ============================================================

import { sendTemplateMessage } from '@/lib/whatsapp'
import { registerWhatsAppMessage } from '@/lib/whatsapp-log'
import { fechaLarga, hora, numeroConsulta, primerNombre } from '@/lib/whatsapp-format'
import type { AppointmentNotice } from '@/lib/supabase/booking-notices'

/** Manda la plantilla y anota el envío. Si Meta rechaza el pedido, lanza. */
export async function enviarConfirmacionTurno(
  appt: AppointmentNotice,
  destinatario: string,
  phoneNumberId: string,
): Promise<void> {
  const servicios = appt.services.map((s) => s.name).join(', ')

  // Valor dinámico del botón "Gestionar mi turno" -- se concatena al final
  // de la URL registrada en Meta (`.../gestionar?ref={{1}}`), así que tiene
  // que ser lo mismo que arma confirmar-email/route.ts para el link del
  // mail: la referencia y la sucursal (para que "reservar otro turno" desde
  // ahí vuelva a la misma sucursal en vez del selector).
  const botonParam = `${appt.reference}&sucursal=${appt.branchId}`

  // El ORDEN de bodyParams tiene que coincidir exactamente con los
  // {{1}}, {{2}}... de la plantilla "confirmacion_turno_v4" aprobada en
  // Meta -- ver docs/whatsapp_templates.md para el texto exacto.
  const { messageId } = await sendTemplateMessage({
    phoneNumberId,
    to: destinatario,
    templateName: 'confirmacion_turno_v4',
    bodyParams: [primerNombre(appt.clientName), appt.branchName, fechaLarga(appt.startsAt), hora(appt.startsAt), servicios, appt.reference, numeroConsulta(appt.branchWhatsapp)],
    buttonUrlParam: botonParam,
  })
  await registerWhatsAppMessage({ wamid: messageId, branchId: appt.branchId, appointmentId: appt.id, kind: 'confirmacion', recipient: destinatario })
}
