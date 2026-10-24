# WhatsApp: activarlo cuando Meta esté listo

El código ya está preparado. No hay que programar nada: solo la cuenta de Meta, cinco variables de entorno y cargar el número de cada sucursal. Mientras tanto el turnero funciona sin WhatsApp (no manda recordatorios ni avisos).

## 1. En Meta (lo hace el dueño con vos, necesita su celular)

1. Corregir el país del negocio (hoy dice Perú) en *Configuración del negocio → Información del negocio* y completar la razón social.
2. **Verificación de empresa**: *Centro de seguridad → Verificación del negocio*. Pide razón social, CUIT, un comprobante con la misma dirección (constancia de AFIP o factura de servicios) y un teléfono o correo de la empresa. Sin esto el botón "Agregar número de teléfono" queda desactivado.
3. Agregar cada número en el Administrador de WhatsApp. Un número que ya está en la app de WhatsApp Business no se puede agregar: hay que borrar esa cuenta de la app o usar otro chip.
4. Copiar el **Phone Number ID** de cada número (el identificador largo, no el teléfono).
5. El número tiene que quedar en estado conectado (hoy el de Jujuy figura "Sin conexión").

## 2. Variables en Vercel (entorno Production)

| Variable | De dónde sale |
|---|---|
| `WHATSAPP_ACCESS_TOKEN` | usuario del sistema en Meta, token que no venza, permisos `whatsapp_business_messaging` y `whatsapp_business_management` |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | Administrador de WhatsApp, junto al nombre de la cuenta |
| `WHATSAPP_APP_SECRET` | Meta Developers, la app, Configuración → Básica |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | un texto inventado; el mismo se pega en el webhook de Meta |
| `CRON_SECRET` | igual al secreto `cron_secret` del Vault de Supabase |

No definir `WHATSAPP_PHONE_NUMBER_ID`: cada sucursal usa el suyo y una sucursal sin número no debe mandar desde el de otra.
Dejar sin definir `TURNERO_AVISOS_BARBERO` hasta probar; con `real` el botón "Avisar al cliente" del barbero manda de verdad.

## 3. En el sistema

1. `/admin/marca` → elegir la sucursal → pegar el Phone Number ID → **Verificar** (muestra el teléfono que Meta devuelve) → **Guardar**.
2. Plantillas: crearlas desde `/api/whatsapp/plantillas` (están en `lib/whatsapp-templates.ts`) y esperar la aprobación de Meta.
3. Webhook: en Meta apuntarlo a `/api/whatsapp/webhook` con el verify token; suscribir la cuenta con `/api/whatsapp/suscribir`.
4. Recordatorios: correr `supabase/pendientes/ACTIVAR_recordatorios_con_pg_cron.sql`.

## 4. Probar

Reservar un turno con tu propio celular desde `/reservar` y mirar la tabla `whatsapp_messages`. Activar una sucursal por vez.
