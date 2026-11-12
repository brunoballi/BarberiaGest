const { Pool } = require('pg')
const pool = new Pool({ host: '127.0.0.1', port: 54322, user: 'postgres', password: 'postgres', database: process.env.PGDATABASE || 'postgres', max: 60 })
const TZ = 'America/Argentina/Buenos_Aires'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const rnd = (n) => Math.floor(Math.random() * n)
const q = async (sql, p) => (await pool.query(sql, p)).rows
async function fire(actions, jitter = 0) {
  const cl = await Promise.all(actions.map(() => pool.connect()))
  let go; const gate = new Promise((r) => (go = r))
  const ps = actions.map(async (fn, i) => { await gate; if (jitter) await sleep(rnd(jitter)); try { return { ok: true, v: await fn(cl[i]) } } catch (e) { return { ok: false, msg: e.message } } })
  await sleep(30); go(); const out = await Promise.all(ps); cl.forEach((c) => c.release()); return out
}
const lit = (v) => "'" + String(v instanceof Date ? v.toISOString() : v).replace(/'/g, "''") + "'"
const asUser = (uid, sql) => async (c) => { try { return await c.query(`begin; select set_config('request.jwt.claim.sub','${uid}',true), set_config('request.jwt.claims','{"sub":"${uid}","role":"authenticated"}',true); ${sql}; commit;`) } catch (e) { await c.query('rollback').catch(() => {}); throw e } }
;(async () => {
  const [br] = await q(`select id from branches where name='TEST Junin'`)
  const barbers = (await q(`select id from profiles where branch_id=$1 and role='barber' order by full_name`, [br.id])).map((r) => r.id)
  const [svc] = await q(`select id from service_catalog where branch_id=$1 and name='Corte'`, [br.id])
  const [{ d1 }] = await q(`select to_char((now() at time zone '${TZ}')::date+1,'YYYY-MM-DD') d1`)
  const [{ t }] = await q(`select (($1::date + '10:00'::time) at time zone '${TZ}') t`, [d1])
  const reset = () => q(`delete from appointment_services; delete from appointments; delete from appointment_clients; delete from schedule_exceptions; delete from booking_rate_limits`)
  const book = (b, ph, ts = t) => (c) => c.query(`select * from create_appointment_public($1,$2,'X',$3,$4,$5::uuid[])`, [br.id, b, ph, ts, [svc.id]])

  await reset()
  const [{ d, dow }] = await q(`select to_char(now() at time zone '${TZ}','YYYY-MM-DD') d, extract(dow from now() at time zone '${TZ}')::int dow`)
  await q(`delete from barber_schedules where barber_id=$1 and weekday=$2`, [barbers[0], dow])
  await q(`insert into barber_schedules(barber_id,branch_id,weekday,start_time,end_time,mode,slot_minutes) values ($1,$2,$3,'00:00','23:59','turno',15)`, [barbers[0], br.id, dow])
  const [{ pas, fut, ahora }] = await q(`select date_bin('15 minutes', now(), timestamptz '2000-01-01 00:00:00-03') - interval '15 minutes' pas, date_bin('15 minutes', now(), timestamptz '2000-01-01 00:00:00-03') + interval '30 minutes' fut, now() ahora`)
  console.log('ahora', ahora.toISOString(), 'pasado', pas.toISOString(), 'futuro', fut.toISOString())
  const [adm] = await q(`select id from profiles where role='admin' limit 1`)
  const mk = (ts, ph) => asUser(adm.id, `select create_appointment_admin('${br.id}','${barbers[0]}','Pepito','${ph}','${ts.toISOString()}','{${svc.id}}')`)
  let r = await fire([mk(pas, '1100555555')]); console.log('A) admin carga turno que empezo hace ~15min:', r[0].ok ? 'OK' : r[0].msg)
  const id = (await q(`select id from appointments where starts_at=$1`, [pas]))[0]?.id
  r = await fire([asUser(barbers[0], `select cancel_appointment_barber('${id}','no vino')`)]); console.log('B) barbero lo cancela:', r[0].ok ? 'OK' : r[0].msg)
  const off = (await q(`select count(*)::int n from get_available_slots($1,$2,$3,$4::uuid[]) where slot_at=$5`, [br.id, barbers[0], d, [svc.id], pas]))[0].n
  r = await fire([book(barbers[0], '1100444444', pas)]); console.log('C) horario ya empezado: la pantalla lo ofrece =', off === 1, '| reserva directa:', r[0].ok ? 'ACEPTADA' : r[0].msg)
  r = await fire([mk(pas, '1100333333')]); console.log('D) el ADMIN puede volver a cargar a mano ese horario ya empezado:', r[0].ok ? 'si' : r[0].msg)
  await reset()
  r = await fire([book(barbers[0], '1100222222', fut)]); console.log('E) cliente reserva dentro de ~30min:', r[0].ok ? 'OK' : r[0].msg)
  const id2 = (await q(`select id from appointments where starts_at=$1`, [fut]))[0]?.id
  const out = await fire([asUser(barbers[0], `select cancel_appointment_barber('${id2}','no viene')`), book(barbers[0], '1100111111', fut), book(barbers[0], '1100111112', fut)], 8)
  console.log('F) cancela y 2 clientes piden a la vez: cancelar =', out[0].ok, '| cliente1 =', out[1].ok ? 'OK' : out[1].msg, '| cliente2 =', out[2].ok ? 'OK' : out[2].msg)
  const off2 = (await q(`select count(*)::int n from get_available_slots($1,$2,$3,$4::uuid[]) where slot_at=$5`, [br.id, barbers[0], d, [svc.id], fut]))[0].n
  console.log('G) tras recargar, el horario aparece libre =', off2 === 1, '(esperado:', out[1].ok || out[2].ok ? 'no, ya lo tomo alguien' : 'si', ')')
  await q(`delete from barber_schedules where barber_id=$1 and weekday=$2 and slot_minutes=15`, [barbers[0], dow])
  await pool.end()
})().catch((e) => { console.error(e); process.exit(1) })
