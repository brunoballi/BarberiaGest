# PLAN 08: Optimización de consultas (login, transacciones, reportes, mobile)

> **✅ IMPLEMENTADO (prioridades 1, 3 y 4).**
>
> **1. Perfil cacheado — resuelve los candidatos #1 y #2 de un saque.**
> En vez de crear un hook y tocar los ~14 archivos que llamaban `getCurrentProfile()` (con el riesgo de romper imports en cada uno), el cache quedó **dentro de la propia función**, en `supabase.client.ts`: memo en memoria con TTL de 10 min. Ningún call-site cambió. Bonus: **deduplica llamadas concurrentes** (varios componentes montando a la vez comparten la promesa en vuelo), cosa que un hook por componente no hacía.
> Es seguro respecto de cambiar de usuario: el logout hace `window.location.href = '/login'`, una recarga completa que reinicia el módulo. Se expone `invalidateCurrentProfile()` por si hace falta forzar.
>
> **3. Reportes en paralelo.** Los tres bloques (`getReportByPeriod`, deudas, detalle mensual) no dependen entre sí y estaban en cascada; ahora van en un solo `Promise.all`. La pantalla espera el más lento en vez de la suma.
>
> **4. `fullEditTransaction` con un solo SELECT.** Hacía dos consultas a la misma fila (una antes y otra después del update). Ahora trae todo en el select inicial. **De paso corrige un bug latente:** el segundo select leía `transaction_date` *después* del update, así que si la edición cambiaba la fecha, el resync de box_rental se hacía sobre el día equivocado. Ahora usa la fecha nueva (`updates.transaction_date`) cuando la edición la modifica.
>
> ### No implementado (a propósito)
> - **Prioridad 2 (cachear `getWeeksByBranch`)**: descartada. Las semanas tienen que reflejarse **al instante** al cerrar/crear una. Un `staleTime` mostraría datos viejos justo en la operación más sensible del sistema, y hacerlo bien exige invalidación en cada punto que toca semanas — más riesgo que beneficio.
> - **Prioridad 5 (eco del realtime en mobile)**: es la más delicada (toca un flujo realtime en vivo) y necesita prueba con dos dispositivos simultáneos. Queda pendiente.

**Independiente** — se puede hacer en cualquier momento, en paralelo con el resto. Bajo riesgo (no cambia lógica de negocio, solo cuándo/cuántas veces se piden los mismos datos).

## 📋 Candidatos relevados (con evidencia concreta)

### 1. Doble fetch de perfil en login → selección de sucursal
- `app/login/login-form.tsx:44` llama `getCurrentProfile()` tras el login para decidir a dónde redirigir.
- `app/admin/select-branch/select-branch-view.tsx:21` **vuelve a llamar `getCurrentProfile()`** para el mismo dato, 1-2 segundos después.

### 2. Patrón duplicado server + client en ~9 rutas admin
Cada página server (`page.tsx`) llama `getServerProfile()` solo para el guard de redirect, y el componente cliente que monta a continuación vuelve a pedir el mismo perfil con `getCurrentProfile()`:
```tsx
// app/admin/semanas/page.tsx — server
const profile = await getServerProfile()
if (!profile) redirect('/login')
if (profile.role !== 'admin') redirect('/barber')
return <WeeksView />   // profile se descarta

// weeks-view.tsx:106 — client, vuelve a pedirlo
const [p, bs] = await Promise.all([getCurrentProfile(), getMyBranchesCached()])
```
Mismo patrón en `barber/page.tsx`, `admin/mantenimiento`, `admin/servicios`, `admin/barberos`, `admin/beneficios`, `admin/admins`, `admin/configuracion`, `select-branch`. Cada navegación entre secciones dispara 2 fetches de perfil que traen la misma fila.

### 3. `reportes-view.tsx` — waterfall secuencial sin cache
```tsx
// reportes-view.tsx:107-142, load()
const myBranches = await getMyBranchesCached()                          // cacheado (bien)
const data = await getReportByPeriod(myBranches, startDate, endDate)    // RPC agregado (bien)
const debtLists = await Promise.all(myBranches.map(b => getBarberDebtSummary(b.id)))  // espera a getReportByPeriod aunque no depende de él
const fins = await Promise.all(myBranches.map(async b => {
  const ms = await getMonthsWithWeeks(b.id)
  return mrow ? getMonthFinancials(b.id, mrow.id) : null
}))
```
Tres bloques sin dependencia real entre sí, secuenciales. Sin React Query: cambiar de mes o volver a la pestaña siempre re-dispara todo desde cero.

### 4. `fullEditTransaction()` — dos selects sobre la misma fila
```ts
// supabase.client.ts:1298 — antes del update
const { data: prev } = await supabase.from('transactions').select('week_id').eq('id', txId).single()
// ...UPDATE...
// supabase.client.ts:1313 — después, trae datos que ya estaban disponibles antes
const { data: row } = await supabase.from('transactions')
  .select('barber_id, transaction_date, barber:profiles!barber_id(compensation_type, box_rental_amount)')
  .eq('id', txId).single()
```

### 5. `getWeeksByBranch` sin cache, llamado en 3 lugares distintos
`barber-mobile-view.tsx:254` (`goToSettlements`), `weeks-view.tsx:98` (`loadWeeks`), `mantenimiento-view.tsx:121` (`loadInitial`) — mismos datos por sucursal, refetch completo cada vez que se entra a cada pantalla. Contraste: `use-catalogs.ts` ya tiene el patrón correcto (`getMyBranchesCached()`, React Query, `staleTime` 10min) para `services`/`benefits`/`barbers`/`branches`.

### 6. Realtime duplica el fetch de las propias transacciones del barbero
`barber-mobile-view.tsx:224-240` — cualquier evento en `transactions`/`settlements` del barbero dispara un refetch completo de `getBarberTransactionsForWeek`, **incluyendo el eco del propio insert que el barbero acaba de hacer** (el `state` local ya se actualizó de forma optimista en `handleSubmit`).

## 🎯 OBJETIVO

Reducir round-trips redundantes sin tocar la lógica de negocio ni los cálculos — es un plan de "menos llamadas a lo mismo", no de "cambiar qué se calcula".

## 🛠️ IMPLEMENTACIÓN (por prioridad, de más simple/seguro a más profundo)

### Prioridad 1 — Cachear `getCurrentProfile()` con React Query
Mismo patrón que `getMyBranchesCached()` en `use-catalogs.ts`:
```ts
export function useCurrentProfile() {
  return useQuery({ queryKey: ['current-profile'], queryFn: getCurrentProfile, staleTime: 10 * 60_000 })
}
```
Reemplazar los ~10 puntos que llaman `getCurrentProfile()` imperativamente (login, select-branch, y cada `*-view.tsx` admin) por este hook. Resuelve los candidatos **#1 y #2** de un saque — es el cambio de mayor impacto con menor riesgo (no toca `getServerProfile()`, que sigue siendo necesario para el guard server-side de cada página).

### Prioridad 2 — Cachear `getWeeksByBranch`
Mismo patrón, hook `useWeeksByBranch(branchId)` en `use-catalogs.ts`, `staleTime` corto (2 min, igual que `useMonthsWithWeeks`, porque cambia más seguido que catálogos). Reemplazar los 3 call-sites del candidato **#5**.

### Prioridad 3 — Paralelizar y cachear `reportes-view.tsx`
```tsx
const load = useCallback(async () => {
  const myBranches = await getMyBranchesCached()
  const [data, debtLists, fins] = await Promise.all([
    getReportByPeriod(myBranches, startDate, endDate),
    Promise.all(myBranches.map(b => getBarberDebtSummary(b.id))),
    Promise.all(myBranches.map(async b => {
      const ms = await getMonthsWithWeeks(b.id)
      const mrow = ms.find(...)
      return mrow ? getMonthFinancials(b.id, mrow.id) : null
    })),
  ])
}, [...])
```
Envolver en `useQuery({ queryKey: ['report', branchIds, startDate, endDate], queryFn: load })` para que cambiar de mes con las flechas y volver a la pestaña no re-dispare todo si los parámetros no cambiaron. Resuelve **#3**.

### Prioridad 4 — Fusionar los selects de `fullEditTransaction()`
Un único `select` inicial que traiga todo lo que hoy se pide en dos pasos (`week_id`, `barber_id`, `transaction_date`, `barber:profiles(...)`) antes del `UPDATE`, reusando esos datos después en vez de re-consultarlos. Resuelve **#4**.

### Prioridad 5 — Evitar el refetch por eco del propio insert (mobile)
En el listener de `postgres_changes` de `barber-mobile-view.tsx`, distinguir el evento que originó el propio barbero (ya reflejado en el state local por `handleSubmit`) de un evento externo (ej. el admin edita el corte desde el panel). Opciones: comparar el `id` del row del evento contra los que ya están en el state antes de refetchear, o aplicar el patch del evento directamente al state en vez de re-pedir todo. Resuelve **#6** — es el más delicado de los cinco porque toca un flujo realtime, hacerlo último y con pruebas manuales de "otro dispositivo edita mientras el barbero tiene la pantalla abierta".

## 📝 ARCHIVOS A MODIFICAR

1. `lib/hooks/use-catalogs.ts` — nuevos hooks `useCurrentProfile()`, `useWeeksByBranch()`
2. `app/login/login-form.tsx`, `app/admin/select-branch/select-branch-view.tsx` y las ~9 vistas admin — reemplazar `getCurrentProfile()` imperativo por el hook
3. `app/admin/semanas/weeks-view.tsx`, `app/admin/mantenimiento/mantenimiento-view.tsx`, `app/barber/barber-mobile-view.tsx` — reemplazar `getWeeksByBranch()` imperativo por el hook
4. `app/admin/reportes/reportes-view.tsx` — `Promise.all` + `useQuery`
5. `lib/supabase/supabase.client.ts` — `fullEditTransaction()` (un solo select), listener realtime de mobile

## ⚠️ RIESGOS

- `getServerProfile()` (server-side) **no se toca** — sigue siendo necesario para el guard de redirect en cada `page.tsx`, que corre antes de que exista cualquier cache de cliente. Este plan solo elimina el fetch **duplicado del lado cliente**.
- Al introducir `staleTime` en el perfil, si un admin cambia de rol mientras tiene una pestaña abierta, va a tardar hasta 10 minutos en verse reflejado ahí — aceptable (mismo trade-off que ya existe hoy para `getMyBranchesCached()`), pero mencionarlo si el cliente pregunta por qué un cambio de permisos no es instantáneo en todas las pestañas abiertas.
- Hacer los cambios **uno por uno y probar cada pantalla afectada** — es fácil introducir un bug de "datos viejos" al meter cache donde antes no había, sobre todo en Prioridad 5 (realtime).

## ✅ CHECKLIST

- [ ] Prioridad 1: perfil cacheado, navegación entre secciones admin no duplica el fetch
- [ ] Prioridad 2: `getWeeksByBranch` cacheado en los 3 puntos
- [ ] Prioridad 3: Reportes carga en paralelo y no refetchea al volver a la pestaña sin cambiar filtros
- [ ] Prioridad 4: `fullEditTransaction` con un solo select
- [ ] Prioridad 5: probado con dos sesiones simultáneas (barbero + admin) para confirmar que no se pierden actualizaciones externas

## 🎯 BENEFICIOS

✅ Transiciones entre pantallas más rápidas, sobre todo en mobile con conexión más lenta
✅ Menos carga en Supabase (menos queries redundantes por sesión)
✅ Ningún cambio de lógica de negocio — es el plan de menor riesgo de los ocho
