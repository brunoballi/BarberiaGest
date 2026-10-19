// ============================================================
// Generación del archivo .ics (iCalendar, RFC 5545) del turno.
//
// Va adjunto al mail de confirmación: el cliente lo toca y el turno le
// queda agendado en Google Calendar, iPhone, Outlook o Android, con el
// recordatorio propio del teléfono. Es la forma que funciona en todos
// lados por igual, a diferencia de un link a Google Calendar.
// ============================================================

/**
 * Formato de fecha de iCalendar en UTC: `YYYYMMDDTHHMMSSZ`.
 *
 * Se usa UTC (con la Z) y no hora local con TZID a propósito: así no hay
 * que embeber una definición VTIMEZONE completa en el archivo, que es
 * larga y fácil de escribir mal. El calendario del cliente lo convierte
 * solo a su huso.
 */
function toIcsUtc(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/**
 * Escapa los caracteres que en iCalendar son separadores.
 *
 * Sin esto, un servicio que se llame "Corte, barba" cortaría el campo en
 * dos y el evento llegaría truncado o roto.
 */
function esc(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/**
 * Pliega las líneas a 75 octetos, como exige el RFC.
 *
 * Las líneas largas (una descripción con varios servicios) rompen el
 * parser de algunos calendarios si no se pliegan. La continuación va con
 * un espacio al principio.
 *
 * Se mide en BYTES y no en caracteres porque el límite del RFC es de
 * octetos: con acentos o emojis, una línea de 75 caracteres puede pasarse.
 */
function fold(line: string): string {
  const bytes = Buffer.from(line, 'utf8')
  if (bytes.length <= 75) return line

  const partes: string[] = []
  let inicio = 0
  while (inicio < bytes.length) {
    // 75 el primer tramo; 74 los siguientes, porque llevan el espacio inicial.
    const max = partes.length === 0 ? 75 : 74
    let fin = Math.min(inicio + max, bytes.length)

    // No cortar en el medio de un caracter multibyte: los bytes de
    // continuación en UTF-8 son 10xxxxxx.
    while (fin > inicio && fin < bytes.length && (bytes[fin] & 0xc0) === 0x80) fin--

    partes.push(bytes.subarray(inicio, fin).toString('utf8'))
    inicio = fin
  }
  return partes.join('\r\n ')
}

export interface AppointmentIcs {
  reference: string
  startsAt: string
  endsAt: string
  branchName: string
  barberName: string
  services: { name: string; price: number }[]
  /** Dirección de la sucursal, si está cargada. */
  address?: string | null
  /** Minutos antes del turno para la alarma. Por defecto, 2 horas. */
  reminderMinutes?: number
}

/** Devuelve el contenido del .ics listo para adjuntar. */
export function buildAppointmentIcs(appt: AppointmentIcs): string {
  const reminder = appt.reminderMinutes ?? 120
  const servicios = appt.services.map((s) => s.name).join(', ')

  const descripcion = [
    `Servicios: ${servicios}`,
    `Barbero: ${appt.barberName}`,
    `Código de reserva: ${appt.reference}`,
    '',
    'Se paga en el local. Para consultar o cancelar el turno necesitás el código y tu teléfono.',
  ].join('\n')

  // El UID tiene que ser estable y único: si el cliente vuelve a agregar el
  // mismo turno, el calendario lo reconoce y lo actualiza en vez de duplicarlo.
  const uid = `turno-${appt.reference}@valhalla`

  const lineas = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Valhalla//Turnero//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${toIcsUtc(new Date().toISOString())}`,
    `DTSTART:${toIcsUtc(appt.startsAt)}`,
    `DTEND:${toIcsUtc(appt.endsAt)}`,
    `SUMMARY:${esc(`Turno en ${appt.branchName}`)}`,
    `DESCRIPTION:${esc(descripcion)}`,
    ...(appt.address ? [`LOCATION:${esc(appt.address)}`] : []),
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    // La alarma es lo que hace que el teléfono avise solo antes del turno.
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `TRIGGER:-PT${reminder}M`,
    `DESCRIPTION:${esc(`Turno en ${appt.branchName} en ${reminder >= 60 ? `${Math.round(reminder / 60)} h` : `${reminder} min`}`)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ]

  // CRLF obligatorio por el RFC: con \n solo, Outlook rechaza el archivo.
  return lineas.map(fold).join('\r\n') + '\r\n'
}
