// ============================================================
// Definición de las plantillas de WhatsApp del turnero (versión v4).
//
// Una sola fuente de verdad: /api/whatsapp/plantillas las manda a Meta con un
// clic en cada instancia nueva, en vez de cargarlas a mano en WhatsApp Manager
// (donde la categoría viene en "Marketing" por defecto y se equivoca fácil).
//
// El ORDEN de las variables {{1}}, {{2}}... tiene que coincidir con el que
// arman las rutas que las envían (confirmar-whatsapp, cancelar-whatsapp y
// cron/appointment-reminders). Meta no valida la cantidad hasta que se manda
// el mensaje. Texto y motivos de cada decisión: docs/whatsapp_templates.md.
//
// Categoría UTILITY (= "Servicio" en el panel). Los emojis rotulan datos (uno
// por línea) y NO llevan texto de venta: el tono promocional es lo que hace que
// Meta reclasifique a Marketing, que sale más cara. Si algún día reclasifica
// estas por los emojis, sacarlos y crear una versión nueva (una plantilla
// borrada bloquea su nombre 30 días, por eso se versiona con _vN).
//
// Lo único que el cliente puede hacer desde el botón es CANCELAR (todavía no se
// puede reprogramar): los textos no prometen otra cosa.
// ============================================================

export interface TemplateDef {
  name: string
  language: 'es_AR'
  category: 'UTILITY'
  components: unknown[]
}

/** Valores de ejemplo que Meta pide para revisar. No son datos reales de nadie. */
const GESTIONAR_EJEMPLO = '9CD153CA&sucursal=00000000-0000-0000-0000-000000000000'

export function plantillasTurnero(origin: string): TemplateDef[] {
  const boton = (texto: string, url: string, dinamica: boolean) => ({
    type: 'BUTTONS',
    buttons: [
      dinamica
        ? { type: 'URL', text: texto, url, example: [GESTIONAR_EJEMPLO] }
        : { type: 'URL', text: texto, url },
    ],
  })

  return [
    {
      name: 'confirmacion_turno_v4',
      language: 'es_AR',
      category: 'UTILITY',
      components: [
        {
          type: 'BODY',
          text:
            'Hola {{1}}, tu turno está confirmado ✅\n\n' +
            '📍 *Dónde:* {{2}}\n' +
            '🗓️ *Cuándo:* {{3}} a las {{4}} hs\n' +
            '✂️ *Servicio:* {{5}}\n' +
            '🔖 *Código de reserva:* {{6}}\n\n' +
            'Si no podés venir, cancelalo desde el botón de abajo.',
          example: { body_text: [['Juan', 'Barbería Central', 'viernes, 2 de octubre', '18:40', 'Corte clásico', '9CD153CA']] },
        },
        boton('Gestionar mi turno', `${origin}/reservar/gestionar?ref={{1}}`, true),
      ],
    },
    {
      name: 'recordatorio_turno_v4',
      language: 'es_AR',
      category: 'UTILITY',
      components: [
        {
          type: 'BODY',
          text:
            'Hola {{1}}, te recordamos que hoy tenés turno ⏰\n\n' +
            '📍 *Dónde:* {{2}}\n' +
            '🕒 *Hora:* {{3}} hs\n' +
            '✂️ *Servicio:* {{4}}\n\n' +
            'Si no podés venir, cancelalo desde el botón de abajo así otra persona puede usar el horario.',
          example: { body_text: [['Juan', 'Barbería Central', '18:40', 'Corte clásico']] },
        },
        boton('Gestionar mi turno', `${origin}/reservar/gestionar?ref={{1}}`, true),
      ],
    },
    {
      name: 'cancelacion_turno_v4',
      language: 'es_AR',
      category: 'UTILITY',
      components: [
        {
          type: 'BODY',
          text:
            'Hola {{1}}, tu turno en {{2}} del {{3}} a las {{4}} hs quedó cancelado ❌\n\n' +
            'Cuando quieras, podés reservar uno nuevo desde el botón de abajo.',
          example: { body_text: [['Juan', 'Barbería Central', 'viernes, 2 de octubre', '18:40']] },
        },
        boton('Reservar de nuevo', `${origin}/reservar`, false),
      ],
    },
  ]
}
