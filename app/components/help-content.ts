/**
 * Contenido del FAQ flotante. Estructurado por rol y por sección.
 * Si tenés que sumar/actualizar entradas, todo se hace acá.
 */

export interface HelpItem {
  q: string         // pregunta
  a: string         // respuesta (puede contener \n para saltos)
}

export interface HelpSection {
  title: string
  items: HelpItem[]
}

// ─── BARBERO ──────────────────────────────────────────────────────────────
export const BARBER_HELP: HelpSection[] = [
  {
    title: 'Día a día',
    items: [
      {
        q: '¿Cómo registro un corte?',
        a: 'Tocá el botón grande "Registrar corte" en la pantalla principal. Elegí el servicio (o tocá "Otro" para monto libre), método de pago (efectivo o transferencia) y opcionalmente el nombre del cliente. Confirmá. Listo, queda contado en tu semana.',
      },
      {
        q: '¿Qué diferencia hay entre efectivo y transferencia?',
        a: 'Efectivo: la plata queda en la caja de la barbería y vos cobrás tu parte en la liquidación de la semana.\nTransferencia: el cliente te transfiere directo a vos, así que tu parte ya está cobrada — se descuenta en la liquidación bajo "Ya cobrado".',
      },
      {
        q: '¿Puedo editar un corte que cargué mal?',
        a: 'Sí. Tocá el ícono de lápiz en la tarjeta del corte (dentro del listado del día). Podés cambiar servicio, monto y método de pago. Solo se pueden editar los cortes de la semana actual.',
      },
      {
        q: '¿Y si me equivoqué de día?',
        a: 'Pedile al administrador que lo corrija desde el panel admin (tiene la opción de registrar/borrar cortes en días pasados de la semana abierta).',
      },
      {
        q: '¿Puedo cargar un descuento?',
        a: 'Sí. Cuando registrás el corte, abrís el campo "descuento" e ingresás el monto. La barbería absorbe el descuento — tu comisión sigue calculándose sobre el precio original.',
      },
    ],
  },
  {
    title: 'Adelantos',
    items: [
      {
        q: '¿Cómo pido un adelanto?',
        a: 'En la home tenés el botón "Pedir adelanto". Ingresá el monto y opcionalmente un motivo. El admin lo revisa y lo aprueba/rechaza desde su panel.',
      },
      {
        q: '¿Cómo se descuenta de la liquidación?',
        a: 'Los adelantos aprobados se restan automáticamente del neto a cobrar al cierre de la semana. Si pediste $20.000 de adelanto y te corresponden $80.000, recibís $60.000.',
      },
    ],
  },
  {
    title: 'Liquidaciones',
    items: [
      {
        q: '¿Dónde veo mis liquidaciones?',
        a: 'Desde la home, "Mis liquidaciones". Vas a ver una fila por cada semana con un resumen rápido. Tocá una fila para abrir el detalle completo (comisión, presentismo, objetivo, ya cobrado, adelantos, neto).',
      },
      {
        q: '¿Qué significa cada estado?',
        a: 'Borrador: la semana sigue abierta o recién se cerró, los números pueden cambiar.\nConfirmado: el admin revisó y aprobó tu liquidación.\nPagado: ya cobraste.',
      },
      {
        q: '¿Cómo se calcula el neto?',
        a: 'Comisión + bonos (presentismo y objetivo si los tenés marcados) − lo que ya cobraste por transferencia − adelantos. Eso es lo que recibís en efectivo al cierre.',
      },
    ],
  },
  {
    title: 'Presentismo y objetivo',
    items: [
      {
        q: '¿Qué es el presentismo?',
        a: 'Es un bono extra que se calcula como un % del total facturado en la semana. Lo activa el admin manualmente cuando cumpliste con la asistencia. El % específico depende del acuerdo con la barbería.',
      },
      {
        q: '¿Y el objetivo?',
        a: 'Otro bono que se aplica si llegaste a una cantidad mínima de cortes en la semana. Si alcanzaste el objetivo, el admin lo marca y se te suma el % correspondiente sobre el total.',
      },
    ],
  },
]

// ─── ADMIN ────────────────────────────────────────────────────────────────
export const ADMIN_HELP: HelpSection[] = [
  {
    title: 'Operación diaria',
    items: [
      {
        q: '¿Cómo registro un corte retroactivo para un barbero?',
        a: 'En el dashboard principal, tocá "+ Registrar corte" arriba a la derecha (solo aparece con semana abierta). Elegís barbero, día (de la semana abierta), servicio, monto, método y confirmás. Queda asociado al barbero como si lo hubiera cargado él.',
      },
      {
        q: '¿Puedo editar la división de un corte?',
        a: 'Sí. En la pestaña Transacciones, abrí el corte y tenés la opción de override manual de los montos de efectivo / transferencia / tarjeta. Útil para casos donde el cliente pagó parte en efectivo y parte por transferencia.',
      },
      {
        q: '¿Cómo apruebo/rechazo un adelanto?',
        a: 'Ir a Configuración → Adelantos. Vas a ver los pedidos pendientes. Aprobar lo deja listo para descontar de la liquidación; rechazar lo cancela. Podés agregar un motivo en cada acción.',
      },
    ],
  },
  {
    title: 'Cierre de semana',
    items: [
      {
        q: '¿Cuándo cierro una semana?',
        a: 'Cuando ya cargaste todos los cortes de la semana (martes a sábado). Antes de cerrar, asegurate de marcar el presentismo/objetivo de cada barbero (si corresponde) en la pestaña Liquidaciones.',
      },
      {
        q: '¿Qué pasa al cerrar una semana?',
        a: 'Se generan las liquidaciones de cada barbero con todos los cálculos congelados (snapshots de comisión, presentismo, objetivo, adelantos). A partir de ahí los barberos ven sus números finales.',
      },
      {
        q: '¿Y si después tengo que cambiar algo?',
        a: 'Con la semana cerrada (no pagada) podés "Recalcular" desde el botón en el topbar — vuelve a generar las liquidaciones con los datos actuales. Si ya marcaste como pagada, no se puede modificar.',
      },
    ],
  },
  {
    title: 'Barberos',
    items: [
      {
        q: '¿Cómo doy de alta un barbero?',
        a: 'Configuración → Barberos → "+ Nuevo barbero". Cargás datos personales, sucursal, tipo de compensación (porcentaje / sueldo / alquiler de box) y los rates correspondientes. Al guardar te muestra las credenciales que tenés que compartirle.',
      },
      {
        q: '¿Cómo le regenero la contraseña?',
        a: 'Configuración → Barberos → botón "🔑 Credenciales" en la fila del barbero. Te genera una contraseña nueva y la muestra en un popup con botón "Copiar". La contraseña anterior queda inválida al instante.',
      },
      {
        q: '¿Qué es la comisión por porcentaje?',
        a: 'El barbero se queda con un % del precio de cada corte. Ese % se configura en su perfil (commission_rate). Aplica sobre el precio original del servicio (antes de descuentos).',
      },
      {
        q: '¿Cuál es la diferencia entre los tipos de compensación?',
        a: 'Porcentaje: comisión por corte.\nSueldo: tiene tasa base (% del facturado) + presentismo + objetivo + cantidad mínima de cortes.\nAlquiler de box: el barbero paga un monto fijo a la barbería; el resto es suyo.',
      },
    ],
  },
  {
    title: 'Administradores',
    items: [
      {
        q: '¿Cómo creo otro admin?',
        a: 'Configuración → Administradores → "+ Nuevo administrador". Email (puede ser ficticio con formato válido, ej: barbara@valhalla.com), nombre, y marcá las sucursales que va a gestionar. Te devuelve usuario + contraseña para compartirle.',
      },
      {
        q: '¿Cómo le reseteo la contraseña a otro admin?',
        a: 'En la grilla de Administradores, botón "🔑 Credenciales" en la fila del admin. Te genera una contraseña nueva y la muestra. No podés resetear tu propia contraseña desde ahí (usá el flujo de "olvidé mi contraseña" desde el login).',
      },
      {
        q: '¿Un admin puede ver todas las sucursales?',
        a: 'No. Cada admin solo ve y opera sobre las sucursales que tenga marcadas en su perfil. Si tiene una sola asignada, entra directo; con varias, le aparece el selector al loguearse.',
      },
    ],
  },
  {
    title: 'Reportes y gastos',
    items: [
      {
        q: '¿Cómo cargo un gasto de la semana?',
        a: 'En el dashboard, pestaña Gastos. "+ Nuevo gasto" → categoría, descripción, monto, fecha. Los gastos se asocian a la semana actual y aparecen restando en los KPIs y en reportes.',
      },
      {
        q: '¿Dónde están los reportes?',
        a: 'Topbar → "Reportes". Tenés filtros por fecha, barbero, método de pago, sucursal. Útil para ver tendencias mensuales o exportar info para contabilidad.',
      },
    ],
  },
]
