// Política de privacidad pública (sin login: el proxy solo protege /admin y /barber).
//
// Meta la exige para publicar la app de WhatsApp, y es la que lee cualquier persona que
// reserva un turno. Describe lo que el sistema hace de verdad: qué datos pide la reserva,
// para qué se usan, quién los procesa y cómo pedir que se corrijan o se borren.
// Si cambia el sistema (otro proveedor, otro dato), hay que actualizar esta página.

import type { Metadata } from 'next'

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.salonvalhalla.com'),
  title: 'Política de privacidad — Salon Valhalla',
  description:
    'Qué datos personales usamos cuando reservás un turno en Salon Valhalla, para qué los usamos y cómo ejercer tus derechos.',
  alternates: { canonical: '/privacidad' },
}

const SUCURSALES = [
  { nombre: 'Salon Jujuy', whatsapp: '341 682-5981' },
  { nombre: 'Salon Ituzaingó', whatsapp: '341 282-8475' },
  { nombre: 'Salon Junín', whatsapp: '341 335-4164' },
  { nombre: 'Salon San Juan', whatsapp: '341 681-1542' },
]

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-bold text-[var(--text)]">{titulo}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-[var(--text-muted)]">{children}</div>
    </section>
  )
}

export default function PrivacidadPage() {
  return (
    <main className="mx-auto w-full max-w-2xl space-y-8 px-5 py-10 text-[var(--text)]">
      <header className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--green)]">Salon Valhalla</p>
        <h1 className="text-3xl font-bold">Política de privacidad</h1>
        <p className="text-sm text-[var(--text-muted)]">Última actualización: noviembre de 2026</p>
      </header>

      <Seccion titulo="Quiénes somos">
        <p>
          Salon Valhalla es una barbería con sucursales en Rosario, Santa Fe, Argentina. Esta página explica cómo
          tratamos los datos personales de quienes reservan un turno en nuestro sitio (salonvalhalla.com) o reciben
          avisos sobre su turno.
        </p>
      </Seccion>

      <Seccion titulo="Qué datos usamos">
        <p>Cuando reservás un turno te pedimos:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Tu nombre y apellido.</li>
          <li>Tu número de teléfono (celular).</li>
          <li>Tu correo electrónico, si querés recibir el aviso por mail (es opcional).</li>
          <li>El servicio, la sucursal, el barbero, el día y la hora que elegiste.</li>
        </ul>
        <p>No pedimos datos de tarjetas ni de pago: el turno se paga en la sucursal.</p>
      </Seccion>

      <Seccion titulo="Para qué los usamos">
        <ul className="list-disc space-y-1 pl-5">
          <li>Registrar tu turno y reservar el horario con el barbero.</li>
          <li>Avisarte sobre ese turno: confirmación, recordatorio el día del turno, cancelación y, si hay un
            imprevisto, un aviso de demora o de espera.</li>
          <li>Permitirte cancelar o gestionar tu turno con el código de reserva.</li>
        </ul>
        <p>
          Los mensajes son solo avisos sobre tu turno. No los usamos para publicidad ni los vendemos o cedemos a
          terceros para que te ofrezcan productos.
        </p>
      </Seccion>

      <Seccion titulo="Avisos por WhatsApp">
        <p>
          Los avisos por WhatsApp se envían desde un número de la barbería, a través de la plataforma WhatsApp
          Business Platform de Meta. Ese número es <strong>solo para avisos</strong>: no atiende consultas. Para
          consultas, escribinos al WhatsApp de la sucursal (abajo). Podés pedir que no te enviemos más avisos
          escribiéndonos por ese medio.
        </p>
      </Seccion>

      <Seccion titulo="Quién procesa los datos">
        <p>Para que el servicio funcione usamos proveedores que guardan o transmiten la información por nuestra cuenta:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Meta (WhatsApp Business Platform): envío de los avisos por WhatsApp.</li>
          <li>Supabase: base de datos donde se guardan los turnos.</li>
          <li>Vercel: alojamiento del sitio.</li>
          <li>Resend: envío de los avisos por correo electrónico.</li>
        </ul>
        <p>Estos proveedores pueden almacenar datos en servidores fuera de Argentina.</p>
      </Seccion>

      <Seccion titulo="Cuánto tiempo los guardamos">
        <p>
          Guardamos los datos de tu turno mientras sean necesarios para prestarte el servicio y llevar el registro de
          la barbería. Podés pedirnos que los corrijamos o los eliminemos.
        </p>
      </Seccion>

      <Seccion titulo="Tus derechos">
        <p>
          Según la Ley 25.326 de Protección de Datos Personales, podés acceder a tus datos, pedir que los rectifiquen,
          actualicen o eliminen. Para ejercer estos derechos, escribinos al WhatsApp de la sucursal donde reservaste.
          La Agencia de Acceso a la Información Pública es el órgano de control de esta ley y atiende las denuncias y
          reclamos por incumplimientos.
        </p>
      </Seccion>

      <Seccion titulo="Contacto">
        <p>Escribinos al WhatsApp de la sucursal:</p>
        <ul className="space-y-1">
          {SUCURSALES.map((s) => (
            <li key={s.nombre}>
              <span className="font-medium text-[var(--text)]">{s.nombre}</span>: {s.whatsapp}
            </li>
          ))}
        </ul>
      </Seccion>
    </main>
  )
}
