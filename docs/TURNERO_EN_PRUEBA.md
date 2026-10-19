# Turnero: etapa de prueba (solo el usuario desarrollador)

Estado al 2026-10-19. Rama `port/turnero`. Base de datos ya migrada en producción (migraciones 065 a 094).

## Quién lo ve

Solo los usuarios cuyo id esté en `NEXT_PUBLIC_TURNERO_USER_IDS` (hoy: `Admin_Desarrollador`,
`dc54f801-920b-4f02-a517-a4670bb025c6`). Sin esa variable **no entra nadie** (cerrado por defecto).
Los demás admins y los barberos del cliente no ven ninguna entrada nueva en el menú.

| Qué | Quién puede |
|---|---|
| Menú "Turnero (en prueba)" en el panel de admin | solo usuarios de la lista |
| `/admin/turnos`, `/admin/horarios`, `/admin/clientes`, `/admin/marca` | admin logueado **y** en la lista (para los demás: 404) |
| `/reservar`, `/reservar/gestionar` | 404 salvo usuario de la lista logueado, o `NEXT_PUBLIC_TURNERO_PUBLIC_OPEN=true` |
| `/api/reservar/*` | 404 con el mismo criterio |
| `/api/whatsapp/numero`, `plantillas`, `suscribir` | admin de la lista |
| `/api/whatsapp/webhook`, `/api/cron/appointment-reminders` | se protegen con su propia firma / secreto; inertes sin las variables |

Código: `lib/turnero-access.ts` (lista y flag), `lib/turnero-guard.ts` (guardas de páginas y rutas).
La protección de los **datos** no depende de esto: está en la base (RLS y funciones con chequeo de sucursal).

## Variables de entorno

| Variable | Para qué | Estado |
|---|---|---|
| `NEXT_PUBLIC_TURNERO_USER_IDS` | quién ve el turnero | cargada en `.env.local`; **falta en Vercel** |
| `NEXT_PUBLIC_TURNERO_PUBLIC_OPEN` | `true` abre la reserva pública a todos | NO activar todavía |
| `SUPABASE_SERVICE_ROLE_KEY` | reservar (`/api/reservar/crear`) y rutas de WhatsApp | vacía en `.env.local`; en Vercel ya existe (la usan otras rutas) |
| `IP_HASH_SALT` | sal del hash de IP del tope de 20 reservas | opcional (si falta usa la clave de servicio) |
| `WHATSAPP_ACCESS_TOKEN` | token de la API de WhatsApp (Meta) | falta: depende de la cuenta de Meta |
| `WHATSAPP_APP_SECRET` | firma del webhook de Meta | falta |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | verificación del webhook | falta (lo inventás vos, el mismo en Meta) |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | para crear plantillas por API | falta |
| `WHATSAPP_PHONE_NUMBER_ID` | número por defecto (cada sucursal puede tener el suyo desde `/admin/marca`) | opcional; con 4 números conviene NO definirla |
| `CRON_SECRET` | protege la ruta de recordatorios; igual al secreto `cron_secret` del Vault | falta |
| `NEXT_PUBLIC_APP_URL` | links de los avisos | falta |
| `RESEND_API_KEY`, `EMAIL_FROM` | mail de confirmación (opcional; sin clave no se manda) | opcional |

## Cómo probarlo (vos, con tu usuario)

1. Localmente: `npm run dev`, entrar como `Admin_Desarrollador`. **Ojo: usa los datos reales** (`.env.local` apunta a Valhalla).
2. En el menú lateral aparece "Turnero (en prueba)".
3. Orden sugerido: `/admin/servicios` → *Editar* un servicio, cargar duración y marcar "Reservable online" (hoy ninguno está
   habilitado: nacen con `is_bookable = false`); `/admin/horarios` → franjas de cada barbero; después `/reservar`.
4. Las pruebas que hagas crean turnos reales en las tablas nuevas (están vacías hoy); se pueden borrar desde `/admin/turnos`.

## Pendiente

- Cargar `NEXT_PUBLIC_TURNERO_USER_IDS` en Vercel y desplegar la rama como vista previa (no a producción).
- Habilitar servicios y horarios desde el panel. **Servicios ya tiene** duración y "Reservable online" (al *Editar* un
  servicio; solo lo ve el usuario de prueba; los demás admins ven la pantalla igual que siempre).
- Agenda del barbero dentro de la app del barbero (`barber-agenda-view` de Flowi): no portada.
- WhatsApp: alta en Meta, variables, plantillas, webhook y cron (`supabase/pendientes/ACTIVAR_recordatorios_con_pg_cron.sql`).
- Advertencias de ESLint (`react-hooks/set-state-in-effect`) en código copiado de Flowi: no afectan el build.