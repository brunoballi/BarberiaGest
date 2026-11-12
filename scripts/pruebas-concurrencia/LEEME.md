# Pruebas de concurrencia del turnero

Scripts que disparan pedidos simultáneos contra la base (reservas, cancelaciones,
movimientos, "sin preferencia", tope por teléfono) y verifican que nunca haya
turnos solapados ni estados pisados.

- `stress.js`: batería principal (E1–E14).
- `probe.js`, `probe2.js`: pruebas puntuales (bloqueos, doble cancelación, deadlocks, turno ya empezado).

## Cómo correrlas

Solo contra una base LOCAL (Docker de `supabase start`), nunca producción:
crean y borran turnos, clientes y usuarios de prueba.

```bash
npm i --no-save pg
node scripts/pruebas-concurrencia/stress.js
```

Conectan a `127.0.0.1:54322` (postgres/postgres) y esperan datos de prueba:
sucursales "TEST Junin" y "TEST Segunda" con 5 barberos cada una, servicios
"Corte" (30 min) y "Corte+Barba" (60 min), horarios y un admin.

Notas: la prueba E10 (bloqueo parcial vs reserva simultánea) no es confiable
como medición; en secuencia el bloqueo sí funciona.
