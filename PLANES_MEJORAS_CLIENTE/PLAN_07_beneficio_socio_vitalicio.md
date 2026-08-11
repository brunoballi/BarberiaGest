# PLAN 07: Beneficio "Socio Vitalicio" con lista de socios y documento

> **✅ IMPLEMENTADO** — migración `047_lifetime_members.sql` (aplicada solo en local).
>
> - Tabla `lifetime_members` **global** (sin `branch_id`), con RLS: lectura para cualquier autenticado (el barbero la necesita para validar), escritura solo admin.
> - `benefits.requires_member_document` — flag genérico, así no hay que hardcodear el nombre "Socio vitalicio" en el frontend; sirve para cualquier beneficio futuro que necesite validar contra la lista.
> - `transactions.lifetime_member_id` — se guarda la **referencia** al socio, no el DNI suelto: como la validación es bloqueante, al momento del insert ya sabemos que existe.
> - Administración de la lista dentro de `/admin/beneficios` (alta, activar/desactivar) + checkbox en el alta de beneficio.
> - En Registrar Corte, el campo DNI aparece **solo** si el beneficio elegido lo exige, y la validación es **bloqueante**.
>
> **Bug encontrado y corregido durante la verificación:** el campo usaba `<TextInput>` sin `allowNumbers`, y ese componente **borra los dígitos** por defecto (está pensado para nombres). Un DNI nunca se habría podido escribir. Se detectó al probarlo en el navegador, no en el typecheck.
>
> **Verificado de punta a punta en local:** con DNI inexistente el corte **no se guarda** y aparece *"El DNI no está en la lista de socios vitalicios. Por favor, comunicate con el administrador."*; con DNI válido se guarda con el descuento aplicado ($15.000 − 30% = $10.500) y el socio correctamente vinculado en `transactions.lifetime_member_id`.

**Independiente** — no depende de ningún otro plan de esta carpeta.

## 📋 ESTADO ACTUAL

Beneficios (`app/admin/beneficios/benefits-view.tsx`, tabla `benefits` — `supabase/migrations/002_benefits.sql`):
```
discount_type ('fixed'|'percentage'), discount_value, is_active
```
Ya existe además un campo `full_amount_to_barber` (beneficio VIP: el restante post-descuento queda 100% para el barbero, ver memoria `modelo-beneficio-vip.md`) — **es un beneficio distinto**, no confundir con "socio vitalicio".

En `manual-cut-modal.tsx`, el dropdown "Beneficio" carga `getActiveBenefitsByBranch()` y al elegir uno calcula el descuento con `computeBenefitDiscount(benefit, price)` (`supabase.client.ts` línea ~233-240).

**No existe hoy:**
- Ninguna lista/tabla de "socios vitalicios".
- Ningún campo de documento/DNI de **cliente** en `transactions` (el único `dni` que existe es de `profiles`, o sea de barberos/admins — no tiene relación). `transactions` sí tiene `client_name`/`client_surname` (texto libre, `migrations/011_client_surname.sql`).

## 🎯 OBJETIVO

El admin arma una lista de socios vitalicios (nombre + documento). Cuando el barbero, al registrar un corte, elige el beneficio "Socio vitalicio" en el dropdown, se habilita un campo nuevo para cargar el número de documento del cliente y aplicar el descuento correspondiente.

## 🛠️ IMPLEMENTACIÓN

### Paso 1: Tabla de socios vitalicios

**Decidido: lista global**, no por sucursal — un socio vitalicio vale para cualquier sucursal de la barbería.

Nueva migración `supabase/migrations/04X_lifetime_members.sql`:
```sql
create table lifetime_members (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  document_number text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
-- RLS: lectura para cualquier usuario autenticado (admin o barbero, la necesitan
-- ambos: el admin para gestionar la lista, el barbero para validar el documento
-- al registrar un corte en cualquier sucursal). Escritura (insert/update/delete)
-- solo para role='admin' — sin scoping por sucursal, ya que la tabla no tiene branch_id.
```

### Paso 2: Marcar qué beneficio requiere documento

```sql
alter table benefits add column requires_member_document boolean not null default false;
```
En `benefits-view.tsx`, agregar un checkbox "Requiere documento de socio vitalicio" al alta/edición de un beneficio — así el admin decide cuál beneficio dispara el campo nuevo, sin hardcodear un nombre mágico ("Socio vitalicio") en el frontend.

### Paso 3: Campo de documento en `transactions`

Como el documento ahora se **valida obligatoriamente** contra la lista antes de guardar (Paso 4), conviene guardar la referencia directa en vez de texto libre — ya sabemos que en el momento del insert el documento existe en `lifetime_members`:
```sql
alter table transactions add column lifetime_member_id uuid references lifetime_members(id);
```
Esto además deja preparado, sin trabajo extra, un futuro reporte de "cortes por socio vitalicio" (mismo patrón de join que ya se usa para `barber:profiles!barber_id(...)`).

### Paso 4: Frontend — `manual-cut-modal.tsx`, validación bloqueante

```tsx
const selectedBenefit = benefits.find(b => b.id === selectedBenefitId)
{selectedBenefit?.requires_member_document && (
  <div>
    <label>Número de documento del socio</label>
    <input value={clientDocument} onChange={e => setClientDocument(e.target.value)} />
    {memberLookupError && <p className="text-red-400 text-xs">{memberLookupError}</p>}
  </div>
)}
```
En el `handleSubmit()`, **antes** de llamar `registerCut()`, si el beneficio seleccionado tiene `requires_member_document`:
```ts
if (selectedBenefit?.requires_member_document) {
  const member = await findLifetimeMemberByDocument(clientDocument)
  if (!member) {
    setMemberLookupError('El DNI no está en la lista de socios vitalicios. Por favor, comunicate con el administrador.')
    return // NO se guarda el registro
  }
  lifetimeMemberId = member.id
}
```
- `findLifetimeMemberByDocument(doc)`: `select` en `lifetime_members` por `document_number` (+ `is_active = true`).
- Si no encuentra match → **se bloquea el guardado**, se muestra el cartel con el texto exacto pedido, y el barbero no puede confirmar el corte hasta corregir el documento o cancelar el beneficio.
- `registerCut()` (`supabase.client.ts`) — sumar `lifetime_member_id` al payload del insert, solo cuando corresponda.

### Paso 5: Pantalla de administración de la lista

Nueva vista, sugerida dentro de `/admin/beneficios` como una sección/tab adicional (ya es la pantalla donde se configuran los beneficios, mantiene todo lo relacionado a beneficios junto) en vez de un módulo de menú aparte. Como la lista es global (no por sucursal), esta pantalla no necesita filtro de sucursal — se administra una sola vez para toda la barbería.

## 📝 ARCHIVOS A MODIFICAR / CREAR

1. **Crear** `supabase/migrations/04X_lifetime_members.sql`
2. **Modificar** `app/admin/beneficios/benefits-view.tsx` — checkbox `requires_member_document` + sección de administración de socios vitalicios
3. **Modificar** `app/admin/manual-cut-modal.tsx` — campo condicional de documento + validación bloqueante en `handleSubmit()`
4. **Modificar** `lib/supabase/supabase.client.ts` — `registerCut()` (sumar `lifetime_member_id`), nueva `findLifetimeMemberByDocument()`, CRUD de `lifetime_members`
5. **Modificar** `lib/supabase/database.types.ts` — tipos nuevos

## ⚠️ RIESGOS

- No mezclar con el beneficio VIP existente (`full_amount_to_barber`) — son conceptos independientes, un beneficio puede tener ambos flags o ninguno, no hay exclusión mutua salvo que el cliente indique lo contrario.
- La validación bloqueante depende de la lista estar bien cargada de antemano — un socio vitalicio real que todavía no fue cargado por el admin **no va a poder usar el beneficio** hasta que se lo agregue a la lista. Asegurarse de que el admin cargue la lista completa antes de activar `requires_member_document` en producción, para no frenar a un cliente real en el mostrador.
- `document_number` es `unique` a nivel global — si dos socios distintos comparten el mismo número por error de carga, el segundo alta falla; es el comportamiento esperado (evita duplicados), pero el mensaje de error de esa pantalla debe ser claro para el admin.

## ✅ CHECKLIST

- [ ] Admin puede cargar/editar/desactivar socios vitalicios (lista global, sin filtro de sucursal)
- [ ] Dropdown de Beneficio muestra el campo de documento solo para el/los beneficio(s) marcados
- [ ] Si el documento no está en la lista, el registro **no se guarda** y se muestra: "El DNI no está en la lista de socios vitalicios. Por favor, comunicate con el administrador."
- [ ] El descuento se sigue calculando igual que cualquier otro beneficio (fixed/percentage)

## 🎯 BENEFICIOS

✅ Trazabilidad de qué cliente usó el beneficio, sin tocar la lógica de descuento existente
✅ El flag `requires_member_document` es genérico — sirve para cualquier beneficio futuro que necesite un dato extra, no solo este
