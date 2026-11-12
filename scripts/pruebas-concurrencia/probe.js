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

  // P1: bloqueo parcial EN SECUENCIA: primero el bloqueo, despues la reserva
  await reset()
  await q(`insert into schedule_exceptions(branch_id,barber_id,exception_date,closed_all_day,start_time,end_time,reason) values ($1,$2,$3,false,'10:00','11:00','medico')`, [br.id, barbers[4], d1])
  let r = await fire([book(barbers[4], '1100000001')])
  console.log('P1 reserva DESPUES del bloqueo ->', r[0].ok ? 'ACEPTADA (BUG)' : 'rechazada: ' + r[0].msg)

  // P1b: el bloqueo se carga sobre un turno que YA existe (decision del admin)
  await reset()
  await fire([book(barbers[4], '1100000002')])
  await q(`insert into schedule_exceptions(branch_id,barber_id,exception_date,closed_all_day,start_time,end_time,reason) values ($1,$2,$3,false,'10:00','11:00','medico')`, [br.id, barbers[4], d1])
  console.log('P1b turno ya existente + bloqueo cargado despues: turnos activos =', (await q(`select count(*)::int n from appointments where status='reservado'`))[0].n, '(el bloqueo no avisa ni cancela)')

  // P1c: carrera real, medida por orden de commit
  let raced = 0
  for (let i = 0; i < 300; i++) {
    await reset()
    await fire([
      (c) => c.query(`insert into schedule_exceptions(branch_id,barber_id,exception_date,closed_all_day,start_time,end_time,reason) values ($1,$2,$3,false,'10:00','11:00','medico')`, [br.id, barbers[4], d1]),
      book(barbers[4], '1100000003'),
    ], 3)
    // dentro del bloqueo y creado por una transaccion que EMPEZO despues de que el bloqueo ya estaba confirmado?
    const n = (await q(`select count(*)::int n from appointments a, schedule_exceptions e where a.status='reservado' and e.barber_id=a.barber_id and a.xmin::text::bigint > e.xmin::text::bigint`))[0].n
    raced += n
  }
  console.log('P1c reservas que entraron dentro de un bloqueo en 300 carreras (id de transaccion posterior al bloqueo) =', raced)

  // P2: doble cancelacion del barbero, 300 veces
  let dup = 0, both = 0
  for (let i = 0; i < 300; i++) {
    await reset()
    const rr = await fire([book(barbers[2], '1100000004')]); const ref = rr[0].v.rows[0].reference
    const id = (await q(`select id from appointments where reference=$1`, [ref]))[0].id
    const out = await fire([asUser(barbers[2], `select cancel_appointment_barber('${id}','motivo')`), asUser(barbers[2], `select cancel_appointment_barber('${id}','motivo')`)], 2)
    if (out.every((x) => x.ok)) both++
    const notes = (await q(`select notes from appointments where id=$1`, [id]))[0].notes
    if ((notes.match(/Cancelado/g) || []).length > 1) dup++
  }
  console.log(`P2 doble cancelacion simultanea: ambas OK=${both}/300, nota duplicada=${dup}/300`)

  // P3: sin preferencia, deadlocks en 30 rondas distintas (40 clientes, 1 horario)
  let dl = 0, tot = 0, other = {}
  for (let i = 0; i < 30; i++) {
    await reset()
    const out = await fire(Array.from({ length: 40 }, (_, k) => (c) => c.query(`select * from create_appointment_public_rl($1,$2,null,'Z',$3,$4,$5::uuid[])`, [`ipx${k}`, br.id, `11${String(500000 + i * 100 + k)}`, t, [svc.id]])), i % 3 ? 0 : 5)
    out.forEach((x) => { tot++; if (!x.ok) { if (/deadlock/i.test(x.msg)) dl++; else if (!/Ese horario/.test(x.msg)) other[x.msg.slice(0, 60)] = 1 } })
  }
  console.log(`P3 sin preferencia: deadlocks=${dl}/${tot}, otros errores=${JSON.stringify(other)}`)
  await pool.end()
})().catch((e) => { console.error(e); process.exit(1) })
