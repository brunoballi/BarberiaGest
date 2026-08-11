# PLAN 04: Limpieza de KPI cards en Liquidaciones

> **⚠️ PARCIALMENTE HECHO durante PLAN_01.** La card **"Retiros socios" ya fue eliminada** (junto con `kpis.partnerWithdrawals`, `operationalExpenses` y `expensesTotal`, que quedaron sin uso). Falta solo decidir qué hacer con **"Devuelto x barberos"**, que sigue en el KPI strip.
>
> Nota sobre la carga de `expenses` en el dashboard: **no se puede sacar**. Aunque ya no alimenta ninguna KPI, sigue siendo la dependencia que dispara el recálculo de la Ganancia neta del mes (`useEffect` → `getMonthFinancials`, dep array con `expenses`). Si se saca, la ganancia neta deja de refrescarse al cargar un gasto.

**Depende de:** PLAN_01, PLAN_02 y PLAN_03 ya en producción (no sacar la visibilidad hasta que el reemplazo exista, para no dejar al admin sin esos números por un tiempo).

## 📋 ESTADO ACTUAL

En el tab `liquidaciones` de `app/admin/admin-dashboard.tsx`, el KPI strip (sticky, header del tab) tiene, entre otras, estas dos tarjetas (líneas ~1041-1051):

```tsx
<KpiCard label="Devuelto x barberos" value={formatARS(kpis.cashReturnedByBarbers)} sub="entró a caja" ... />
<KpiCard label="Retiros socios" value={formatARS(kpis.partnerWithdrawals)} tooltip="Retiros de los socios (ganancia x socios)." />
```

- `kpis.partnerWithdrawals` viene de `expenses.filter(e => e.category === 'retiro_socio')` (línea ~849) — el mismo dato que ahora vive en su módulo propio (PLAN_02) y en Reportes (PLAN_03).
- `kpis.cashReturnedByBarbers` — "Devuelto por barberos": es un número derivado de pagos de deuda (`barber_debt_payments`, ver `supabase/migrations/020_barber_debt_payments.sql`), **no una acción en sí misma**. La acción real de registrar la devolución sigue viviendo en `DebtPaymentModal` (`app/components/debt-payment-modal.tsx`), disparado desde `handleMarkPaid()` (línea ~742) cuando el admin marca como pagada una liquidación con `net_payable < 0`. **Esa tarjeta es solo un número de resumen — sacarla del KPI strip no afecta el flujo de registrar la devolución**, que sigue intacto en la tabla de liquidaciones.

> **Nota sobre el pedido original de "apagar barberos":** se relevó a fondo la sección Liquidaciones y no existe ningún control de baja de barbero ahí (esa acción vive en `/admin/barberos`, `barbers-abm.tsx`, función `handleToggleActive`). Al pedir precisión sobre esto, la respuesta señaló estas mismas dos tarjetas ("Devuelto x barberos" y "Retiros socios"). Este plan asume que son las dos únicas a eliminar. Si en algún momento aparece una tercera tarjeta de baja de barbero en otra pantalla, avisar antes de tocar nada — no se encontró evidencia de que exista hoy.

## 🎯 OBJETIVO

Sacar esas dos KPI cards del tab Liquidaciones, ya que ahora tienen pantalla/reporte propio (PLAN_02 y PLAN_03).

## 🛠️ IMPLEMENTACIÓN

### Paso 1: Sacar las dos tarjetas del JSX

En `admin-dashboard.tsx`, eliminar las dos líneas de `<KpiCard .../>` (~1041-1051).

### Paso 2: Decidir si `expenses` sigue haciendo falta cargar en el tab `liquidaciones`

Revisar si algún otro cálculo del tab `liquidaciones` depende de `expenses` además de estas dos KPIs. Si no queda ningún uso, recién acá se puede sacar la carga de `expenses` de `loadTabData()` para ese tab (antes no, ver advertencia de PLAN_01).

### Paso 3: Verificar `barber_debt_payments` sigue funcionando

El flujo de "Devuelto por barberos" (`DebtPaymentModal` vía `handleMarkPaid`) **no se toca** — solo se saca el número resumen del header. Probar el flujo completo de marcar una liquidación negativa como pagada después del cambio, para confirmar que sigue abriendo el modal correctamente.

## 📝 ARCHIVOS A MODIFICAR

1. **Modificar** `app/admin/admin-dashboard.tsx` — sacar las 2 `<KpiCard>`, revisar si `expenses` se sigue cargando para el tab

## ✅ CHECKLIST

- [ ] PLAN_01, 02 y 03 ya deployados y validados en prod antes de arrancar este
- [ ] Las 2 tarjetas ya no aparecen en el KPI strip de Liquidaciones
- [ ] El flujo de "marcar liquidación negativa como pagada" → `DebtPaymentModal` sigue funcionando igual
- [ ] Si se sacó la carga de `expenses` del tab, confirmar que ningún otro cálculo del tab la necesitaba

## 🎯 BENEFICIOS

✅ Liquidaciones queda enfocado en liquidaciones, sin números que ahora viven en otro lado
✅ Menos carga de datos innecesaria en ese tab si `expenses` deja de hacer falta ahí
