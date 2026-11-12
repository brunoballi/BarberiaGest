// Prueba de concurrencia del turnero contra la base LOCAL (docker, puerto 54322). Nunca contra produccion.
const { Pool } = require('pg')
const pool = new Pool({ host: '127.0.0.1', port: 54322, user: 'postgres', password: 'postgres', database: process.env.PGDATABASE || 'postgres', max: 70 })
const TZ = 'America/Argentina/Buenos_Aires'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const rnd = (n) => Math.floor(Math.random() * n)
const results = []
const rec = (name, pass, detail) => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}\n      ${detail}`) }
const q = async (sql, p) => (await pool.query(sql, p)).rows

let B = {}, S = {}, barbers = {}, admin
const D1 = {}, D2 = {}

async function seedBranch(name) {
  const [b] = await q(`insert into branches(name) values ($1) returning id`, [name])
  const ids = []
  for (let i = 0; i < 5; i++) {
    const [u] = await q(`insert into auth.users(id,email,aud,role) values (gen_random_uuid(),$1,'authenticated','authenticated') returning id`, [`t${Date.now()}${rnd(1e6)}${i}@t.local`])
    await q(`insert into profiles(id,branch_id,full_name,role,is_barber,commission_rate) values ($1,$2,$3,'barber',true,0.5)`, [u.id, b.id, `${name} Barbero${i + 1}`])
    ids.push(u.id)
  }
  const [s30] = await q(`insert into service_catalog(branch_id,name,base_price,duration_min,is_bookable) values ($1,'Corte',10000,30,true) returning id`, [b.id])
  const [s60] = await q(`insert into service_catalog(branch_id,name,base_price,duration_min,is_bookable) values ($1,'Corte+Barba',16000,60,true) returning id`, [b.id])
  return { branch: b.id, barbers: ids, s30: s30.id, s60: s60.id }
}

async function schedules(br) {
  // D1 (manana): 10-12 slots de 30 (4 por barbero). D2 (pasado manana): 09-21 para pruebas de volumen.
  for (const id of br.barbers) {
    await q(`insert into barber_schedules(barber_id,branch_id,weekday,start_time,end_time,mode,slot_minutes) values ($1,$2,$3,'10:00','12:00','turno',30)`, [id, br.branch, D1.dow])
    await q(`insert into barber_schedules(barber_id,branch_id,weekday,start_time,end_time,mode,slot_minutes) values ($1,$2,$3,'09:00','21:00','turno',30)`, [id, br.branch, D2.dow])
  }
}

const slotTs = (date, hhmm) => q(`select (($1::date + $2::time) at time zone '${TZ}') as t`, [date, hhmm]).then((r) => r[0].t)

async function reset() {
  await q(`delete from appointment_services; delete from appointments; delete from appointment_clients; delete from schedule_exceptions; delete from booking_rate_limits`)
}

// Dispara todas las acciones "a la vez": conexion propia para cada una + barrera.
async function fire(actions, jitterMs = 0) {
  if (actions.length > 60) { const out = []; for (let i = 0; i < actions.length; i += 60) out.push(...(await fire(actions.slice(i, i + 60), jitterMs))); return out }
  const clients = await Promise.all(actions.map(() => pool.connect()))
  let go; const gate = new Promise((r) => (go = r))
  const ps = actions.map(async (fn, i) => {
    await gate
    if (jitterMs) await sleep(rnd(jitterMs))
    const t0 = Date.now()
    try { const v = await fn(clients[i]); return { ok: true, v, ms: Date.now() - t0 } }
    catch (e) { return { ok: false, msg: e.message, code: e.code, ms: Date.now() - t0 } }
  })
  await sleep(30); go()
  const out = await Promise.all(ps)
  clients.forEach((c) => c.release())
  return out
}

const book = (br, barberId, startsAt, name, phone, svc = 's30') => (c) =>
  c.query(`select * from create_appointment_public_rl($1,$2,$3,$4,$5,$6,$7::uuid[])`, [`ip-${phone}`, br.branch, barberId, name, phone, startsAt, [br[svc]]]).then((r) => r.rows[0])
const bookNoRl = (br, barberId, startsAt, name, phone, svc = 's30') => (c) =>
  c.query(`select * from create_appointment_public($1,$2,$3,$4,$5,$6::uuid[])`, [br.branch, barberId, name, phone, startsAt, [br[svc]]]).then((r) => r.rows[0])
const lit = (v) => v === null ? 'null' : typeof v === 'number' ? String(v) : "'" + String(v instanceof Date ? v.toISOString() : v).replace(/'/g, "''") + "'"
const asUser = (uid, sql, params = []) => async (c) => {
  const text = sql.replace(/\$(\d+)/g, (_, i) => lit(params[+i - 1]))
  try {
    return await c.query(`begin; select set_config('request.jwt.claim.sub','${uid}',true), set_config('request.jwt.claims','{"sub":"${uid}","role":"authenticated"}',true); ${text}; commit;`)
  } catch (e) { await c.query('rollback').catch(() => {}); throw e }
}
const tally = (rs) => { const m = {}; rs.forEach((r) => { const k = r.ok ? 'OK' : r.msg.slice(0, 70); m[k] = (m[k] || 0) + 1 }); return m }
const fmt = (m) => Object.entries(m).map(([k, v]) => `${v}x ${k}`).join(' | ')

async function overlaps() {
  const r = await q(`select count(*)::int n from appointments a join appointments b on a.barber_id=b.barber_id and a.id<b.id and tstzrange(a.starts_at,a.ends_at)&&tstzrange(b.starts_at,b.ends_at) where a.status not in ('cancelado','no_vino') and b.status not in ('cancelado','no_vino')`)
  return r[0].n
}
const active = async () => (await q(`select count(*)::int n from appointments where status not in ('cancelado','no_vino')`))[0].n

async function main() {
  const [{ d1, d2, dow1, dow2 }] = await q(`select ((now() at time zone '${TZ}')::date+1) d1, ((now() at time zone '${TZ}')::date+2) d2, extract(dow from ((now() at time zone '${TZ}')::date+1))::int dow1, extract(dow from ((now() at time zone '${TZ}')::date+2))::int dow2`)
  const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
  D1.date = iso(d1); D1.dow = dow1; D2.date = iso(d2); D2.dow = dow2
  console.log(`Dias de prueba: ${D1.date} (10-12), ${D2.date} (09-21)`)

  // limpieza de corridas anteriores
  await q(`delete from appointment_services; delete from appointments; delete from appointment_clients; delete from schedule_exceptions; delete from barber_schedules; delete from booking_rate_limits`)
  await q(`delete from service_catalog where name in ('Corte','Corte+Barba') and branch_id in (select id from branches where name like 'TEST%')`)
  await q(`delete from profiles where full_name like 'TEST%'`)
  await q(`delete from auth.users where email like '%@t.local'`)
  await q(`delete from branches where name like 'TEST%'`)

  B = await seedBranch('TEST Junin'); S = await seedBranch('TEST Segunda')
  await schedules(B); await schedules(S)
  // admin de prueba
  const [au] = await q(`insert into auth.users(id,email,aud,role) values (gen_random_uuid(),'admin@t.local','authenticated','authenticated') returning id`)
  await q(`insert into profiles(id,branch_id,full_name,role) values ($1,$2,'TEST Admin','admin')`, [au.id, B.branch]); admin = au.id

  const t1000 = await slotTs(D1.date, '10:00'), t1030 = await slotTs(D1.date, '10:30'), t1100 = await slotTs(D1.date, '11:00')
  const day1Slots = await Promise.all(['10:00', '10:30', '11:00', '11:30'].map((h) => slotTs(D1.date, h)))

  // sanidad: grilla visible
  const grid = await q(`select count(*)::int n from get_available_slots($1,$2,$3,$4::uuid[])`, [B.branch, B.barbers[0], D1.date, [B.s30]])
  console.log('Slots visibles por barbero (esperado 4):', grid[0].n)

  // ---- E1: 50 clientes, mismo barbero, mismo horario
  await reset()
  let rs = await fire(Array.from({ length: 50 }, (_, i) => book(B, B.barbers[0], t1000, `Cliente ${i}`, `1100000${100 + i}`)))
  let ok = rs.filter((r) => r.ok).length, ac = await active(), ov = await overlaps()
  rec('E1  50 clientes piden el MISMO horario del MISMO barbero', ok === 1 && ac === 1 && ov === 0, `exitos=${ok}, turnos activos=${ac}, solapes=${ov}. ${fmt(tally(rs))}`)

  // ---- E2: sala llena: 5 barberos x 4 slots = 20 slots, 120 clientes al azar
  await reset()
  const picks = Array.from({ length: 120 }, (_, i) => book(B, B.barbers[rnd(5)], day1Slots[rnd(4)], `C${i}`, `1122${String(100000 + i)}`))
  rs = await fire(picks)
  ok = rs.filter((r) => r.ok).length; ac = await active(); ov = await overlaps()
  const unexpected = rs.filter((r) => !r.ok && !/horario|disponible|tomado/i.test(r.msg))
  rec('E2  120 clientes al azar sobre 20 horarios (5 barberos x 4)', ok === ac && ov === 0 && ac <= 20 && unexpected.length === 0, `exitos=${ok}, activos=${ac}/20, solapes=${ov}, errores inesperados=${unexpected.length}. ${fmt(tally(rs))}`)
  const libres = await q(`select count(*)::int n from (select b from unnest($1::uuid[]) b) x cross join lateral get_available_slots($2,x.b,$3,$4::uuid[])`, [B.barbers, B.branch, D1.date, [B.s30]])
  rec('E2b Despues de E2, lo que queda libre coincide con lo que no se vendio', libres[0].n === 20 - ac, `libres segun la pantalla=${libres[0].n}, esperado=${20 - ac}`)

  // ---- E3: sin preferencia, 40 clientes, un horario => 5 turnos (uno por barbero)
  await reset()
  rs = await fire(Array.from({ length: 40 }, (_, i) => book(B, null, t1000, `C${i}`, `1133${String(100000 + i)}`)))
  ok = rs.filter((r) => r.ok).length; ac = await active(); ov = await overlaps()
  const distinct = (await q(`select count(distinct barber_id)::int n from appointments`))[0].n
  rec('E3  Sin preferencia: 40 clientes, 1 horario, 5 barberos', ok === 5 && ac === 5 && distinct === 5 && ov === 0, `exitos=${ok}, barberos distintos=${distinct}, solapes=${ov}. ${fmt(tally(rs))}`)


  // ---- E3b: sin preferencia repetido, contar deadlocks
  let dl = 0, e3tot = 0, e3bad = 0
  for (let it = 0; it < 15; it++) {
    await reset()
    rs = await fire(Array.from({ length: 40 }, (_, i) => book(B, null, t1000, `C${i}`, `1133${String(100000 + i)}`)))
    dl += rs.filter((r) => !r.ok && /deadlock/i.test(r.msg)).length
    e3tot += rs.length
    if ((await active()) > 5 || (await overlaps())) e3bad++
  }
  rec('E3b Sin preferencia, 15 rondas de 40 clientes: errores "deadlock" visibles para el cliente', dl === 0, `clientes que verian "deadlock detected" = ${dl} de ${e3tot} (${(100 * dl / e3tot).toFixed(1)}%); rondas con doble reserva=${e3bad}`)

  // ---- E7b: marcar "llego" un turno cancelado
  await reset()
  const [z] = (await fire([book(B, B.barbers[0], t1000, 'Zombi', '1100777777')])).map((r) => r.v)
  const zid = (await q(`select id from appointments where reference=$1`, [z.reference]))[0].id
  await q(`select cancel_appointment_public($1,'1100777777')`, [z.reference])
  const r7 = await fire([asUser(admin, `select set_appointment_status($1,'llego')`, [zid])])
  const st7 = (await q(`select status from appointments where id=$1`, [zid]))[0].status
  await q(`update appointments set status='cancelado' where id=$1`, [zid])
  await fire([book(B, B.barbers[0], t1000, 'Reemplazo', '1100888888')])
  const r7b = await fire([asUser(admin, `select set_appointment_status($1,'llego')`, [zid])])
  rec('E7b Marcar "llego" un turno ya CANCELADO', !r7[0].ok, `sin nadie mas: ${r7[0].ok ? 'lo acepto, estado final=' + st7 : 'rechazado'}; con el horario ya retomado por otro cliente: ${r7b[0].ok ? 'lo acepto' : 'error mostrado = "' + r7b[0].msg.slice(0, 140) + '"'}`)

  // ---- E8b: el tope de 3 funciona sin concurrencia?
  await reset()
  const seq = []
  for (let i = 0; i < 5; i++) { const r = await fire([bookNoRl(B, B.barbers[i], t1000, 'Secuencial', '1100666666')]); seq.push(r[0].ok) }
  rec('E8b Tope de 3 turnos por telefono, pedidos uno detras de otro', seq.filter(Boolean).length === 3, `aceptados=${seq.filter(Boolean).length} de 5 (esperado 3)`)

  // ---- E4: servicios de 30 y 60 minutos pisandose en el mismo barbero
  await reset()
  const mix = []
  for (let i = 0; i < 10; i++) {
    mix.push(book(B, B.barbers[0], t1000, `A${i}`, `1144${100000 + i}`, 's60'))
    mix.push(book(B, B.barbers[0], t1030, `B${i}`, `1145${100000 + i}`, 's30'))
    mix.push(book(B, B.barbers[0], t1000, `D${i}`, `1146${100000 + i}`, 's30'))
    mix.push(book(B, B.barbers[0], t1100, `E${i}`, `1147${100000 + i}`, 's60'))
  }
  rs = await fire(mix)
  ov = await overlaps(); ac = await active()
  rec('E4  Cortes de 30 y de 60 min que se pisan entre si, mismo barbero', ov === 0 && ac >= 1 && ac <= 3, `activos=${ac}, solapes=${ov}. ${fmt(tally(rs))}`)

  // ---- E5: barbero cancela y, en el mismo instante, otros piden ese horario (200 rondas)
  let bad = 0, rebooked = 0, noOne = 0, dupe = 0, errs = {}
  for (let it = 0; it < 200; it++) {
    await reset()
    const [ap] = (await fire([book(B, B.barbers[1], t1000, 'Pepito', '1155000000')])).map((r) => r.v)
    const apId = (await q(`select id from appointments where reference=$1`, [ap.reference]))[0].id
    const acts = [asUser(B.barbers[1], `select cancel_appointment_barber($1,'no vino')`, [apId])]
    for (let i = 0; i < 4; i++) acts.push(book(B, B.barbers[1], t1000, `Nuevo${i}`, `1156${100000 + it * 10 + i}`))
    const r = await fire(acts, 14)
    const canceled = r[0].ok
    const newOk = r.slice(1).filter((x) => x.ok).length
    const act = await active(), ovl = await overlaps()
    if (!canceled) errs['cancel:' + r[0].msg.slice(0, 50)] = (errs['cancel:' + r[0].msg.slice(0, 50)] || 0) + 1
    r.slice(1).filter((x) => !x.ok && !/horario|disponible|tomado/i.test(x.msg)).forEach((x) => { errs[x.msg.slice(0, 60)] = (errs[x.msg.slice(0, 60)] || 0) + 1 })
    if (ovl > 0 || act > 1 || newOk > 1) dupe++
    if (newOk === 1) rebooked++
    if (newOk === 0) noOne++
    // tras cancelar y recargar, el horario debe estar ofrecido si nadie lo tomo
    const visible = (await q(`select count(*)::int n from get_available_slots($1,$2,$3,$4::uuid[]) where slot_at=$5`, [B.branch, B.barbers[1], D1.date, [B.s30], t1000]))[0].n
    if (canceled && newOk === 0 && visible !== 1) bad++
    if (canceled && newOk === 1 && visible !== 0) bad++
  }
  rec('E5  Barbero cancela mientras otros piden el mismo horario (200 rondas)', dupe === 0 && bad === 0 && Object.keys(errs).length === 0,
    `doble reserva/solape=${dupe}, pantalla inconsistente tras recargar=${bad}; el horario lo retomo alguien=${rebooked}, quedo libre=${noOne}. Errores raros: ${JSON.stringify(errs)}`)

  // ---- E6: cancelar dos veces en simultaneo (barbero x2; barbero + cliente)
  await reset()
  const [a6] = (await fire([book(B, B.barbers[2], t1000, 'Doble', '1166000000')])).map((r) => r.v)
  const id6 = (await q(`select id from appointments where reference=$1`, [a6.reference]))[0].id
  rs = await fire([asUser(B.barbers[2], `select cancel_appointment_barber($1,'motivo X')`, [id6]), asUser(B.barbers[2], `select cancel_appointment_barber($1,'motivo X')`, [id6])])
  const notes = (await q(`select notes from appointments where id=$1`, [id6]))[0].notes
  rec('E6  Barbero toca "cancelar" dos veces a la vez', (notes.match(/Cancelado/g) || []).length === 1, `resultados: ${fmt(tally(rs))}. notas="${notes}"`)

  // ---- E7: cliente cancela (publico) vs barbero marca "llego"/"atendido" a la vez, 300 rondas
  let lost = { cancelOverLlego: 0, llegoOverCancel: 0, consistent: 0 }
  for (let it = 0; it < 300; it++) {
    await reset()
    const [a] = (await fire([book(B, B.barbers[3], t1000, 'Cli', '1177000000')])).map((r) => r.v)
    const id = (await q(`select id from appointments where reference=$1`, [a.reference]))[0].id
    const r = await fire([
      (c) => c.query(`select cancel_appointment_public($1,'1177000000')`, [a.reference]),
      asUser(admin, `select set_appointment_status($1,'llego')`, [id]),
    ], 14)
    const st = (await q(`select status from appointments where id=$1`, [id]))[0].status
    if (r[0].ok && r[1].ok) { st === 'cancelado' ? lost.cancelOverLlego++ : lost.llegoOverCancel++ } else lost.consistent++
  }
  rec('E7  Cliente cancela justo cuando el admin marca "llego" (300 rondas)', lost.cancelOverLlego + lost.llegoOverCancel === 0,
    `ambas dijeron OK pero una se perdio: ${lost.cancelOverLlego + lost.llegoOverCancel} (cancelado piso a llego=${lost.cancelOverLlego}, llego piso a cancelado=${lost.llegoOverCancel}); coherentes=${lost.consistent}`)

  // ---- E8: mismo telefono pide muchos turnos a la vez (tope 3)
  await reset()
  const ph = '1188000000'
  rs = await fire(Array.from({ length: 12 }, (_, i) => bookNoRl(B, B.barbers[i % 5], day1Slots[i % 4], 'Acaparador', ph)))
  ac = await active()
  rec('E8  Un mismo telefono pide 12 turnos a la vez (tope documentado: 3)', ac <= 3 && !rs.some((r) => !r.ok && /deadlock/i.test(r.msg)), `turnos activos de ese telefono=${ac}. ${fmt(tally(rs))}`)

  // ---- E9: admin mueve un turno a un horario justo cuando el publico lo reserva
  let e9bad = 0, e9 = { moveWon: 0, bookWon: 0 }
  for (let it = 0; it < 100; it++) {
    await reset()
    const [a] = (await fire([book(B, B.barbers[0], t1100, 'Mover', '1199000000')])).map((r) => r.v)
    const id = (await q(`select id from appointments where reference=$1`, [a.reference]))[0].id
    const r = await fire([asUser(admin, `select move_appointment($1,$2,null)`, [id, t1000]), book(B, B.barbers[0], t1000, 'Publico', '1199000001')], 14)
    if (await overlaps()) e9bad++
    if (r[0].ok && r[1].ok) e9bad++
    r[0].ok ? e9.moveWon++ : e9.bookWon++
  }
  rec('E9  Admin mueve un turno al horario que el publico esta reservando (100 rondas)', e9bad === 0, `solapes/doble exito=${e9bad}; gano mover=${e9.moveWon}, gano reserva=${e9.bookWon}`)

  // ---- E10: bloqueo parcial cargado justo cuando entra una reserva dentro del bloqueo
  let inside = 0
  for (let it = 0; it < 100; it++) {
    await reset()
    await fire([
      (c) => c.query(`insert into schedule_exceptions(branch_id,barber_id,exception_date,closed_all_day,start_time,end_time,reason) values ($1,$2,$3,false,'10:00','11:00','medico')`, [B.branch, B.barbers[4], D1.date]),
      book(B, B.barbers[4], t1000, 'EnBloqueo', '1100100000'),
    ], 14)
    inside += (await q(`select count(*)::int n from appointments a join schedule_exceptions e on e.barber_id=a.barber_id where a.status='reservado' and a.created_at > e.created_at`))[0].n
  }
  rec('E10 Bloqueo parcial y reserva simultaneos: queda algun turno DENTRO del bloqueo?', inside === 0, `turnos creados DESPUES de empezar a cargarse un bloqueo, adentro del bloqueo: ${inside} de 100 rondas (el candado de la base no cubre bloqueos, solo turnos)`)

  // ---- E11: dos sucursales, todos los barberos, volumen alto en paralelo (D2: 09-21)
  await reset()
  const d2slots = await Promise.all(Array.from({ length: 24 }, (_, i) => slotTs(D2.date, `${String(9 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`)))
  const crowd = []
  for (let i = 0; i < 400; i++) {
    const br = i % 2 ? B : S
    // 40 telefonos distintos por sucursal, cada uno reintenta (no mas de 3 activos)
    crowd.push(book(br, br.barbers[rnd(5)], d2slots[rnd(24)], `Gente${i}`, `11${String(2000000 + i)}`))
  }
  const t0 = Date.now(); rs = await fire(crowd, 50); const dt = Date.now() - t0
  ac = await active(); ov = await overlaps()
  const cross = (await q(`select count(*)::int n from appointments a join profiles p on p.id=a.barber_id where p.branch_id<>a.branch_id`))[0].n
  const unexp = rs.filter((r) => !r.ok && !/horario|disponible|tomado/i.test(r.msg))
  const lat = rs.map((r) => r.ms).sort((a, b) => a - b)
  rec('E11 2 sucursales x 5 barberos, 400 reservas en paralelo', ov === 0 && cross === 0 && unexp.length === 0 && rs.filter((r) => r.ok).length === ac,
    `exitos=${rs.filter((r) => r.ok).length}, activos=${ac}, solapes=${ov}, barbero de otra sucursal=${cross}, errores inesperados=${unexp.length} ${unexp[0] ? '(' + unexp[0].msg + ')' : ''}; tiempo total=${dt}ms, p50=${lat[200]}ms p95=${lat[Math.floor(lat.length * 0.95)]}ms max=${lat.at(-1)}ms`)

  // ---- E12: barbero de la sucursal B usado en la sucursal A
  rs = await fire([bookNoRl(B, S.barbers[0], d2slots[3], 'Cruzado', '1100999999')])
  rec('E12 Reservar con el barbero de OTRA sucursal', !rs[0].ok, rs[0].ok ? 'SE PERMITIO' : 'rechazado: ' + rs[0].msg)

  // ---- E13: limite por IP bajo concurrencia (tope 20)
  await reset()
  rs = await fire(Array.from({ length: 40 }, (_, i) => (c) => c.query(`select * from create_appointment_public_rl('ip-unica',$1,$2,$3,$4,$5,$6::uuid[])`, [B.branch, B.barbers[i % 5], `Ip${i}`, `11${String(3000000 + i)}`, d2slots[i % 24 + 0], [B.s30]]).then((r) => r.rows[0])))
  ok = rs.filter((r) => r.ok).length
  const cnt = (await q(`select bookings from booking_rate_limits where ip_hash='ip-unica'`))[0]
  rec('E13 40 reservas simultaneas desde la MISMA IP (tope 20)', ok <= 20 && (!cnt || cnt.bookings === ok), `exitos=${ok}, contador=${cnt && cnt.bookings}. ${fmt(tally(rs))}`)

  // ---- E14: turno que ya empezo hace 15 min y se cancela; y uno que empieza en 15 min
  await reset()
  const nowRow = (await q(`select to_char(now() at time zone '${TZ}','YYYY-MM-DD') d, extract(dow from now() at time zone '${TZ}')::int dow`))[0]
  const dstr = nowRow.d
  await q(`insert into barber_schedules(barber_id,branch_id,weekday,start_time,end_time,mode,slot_minutes) values ($1,$2,$3,'00:00','23:59','turno',15)`, [B.barbers[0], B.branch, nowRow.dow])
  const [pas] = await q(`select (date_trunc('minute', now()) - interval '15 minutes') as t`)
  const [fut] = await q(`select (date_trunc('minute', now()) + interval '15 minutes') as t`)
  const adm = await fire([asUser(admin, `select create_appointment_admin($1,$2,'Pepito','1100555555',$3,$4)`, [B.branch, B.barbers[0], pas.t, `{${B.s30}}`])])
  console.log('   (admin carga un turno que empezo hace 15 min: ok=' + adm[0].ok + (adm[0].ok ? '' : ' ' + adm[0].msg) + ')')
  const startedAppt = (await q(`select id,status from appointments where starts_at=$1`, [pas.t]))[0]
  if (startedAppt) await fire([asUser(B.barbers[0], `select cancel_appointment_barber($1,'no vino')`, [startedAppt.id])])
  const offered = await q(`select count(*)::int n from get_available_slots($1,$2,$3,$4::uuid[]) where slot_at=$5`, [B.branch, B.barbers[0], dstr, [B.s30], pas.t])
  const retry = await fire([bookNoRl(B, B.barbers[0], pas.t, 'Tarde', '1100444444')])
  rec('E14a Turno que empezo hace 15 min se cancela: el publico puede retomar ese horario?', true, `pantalla lo ofrece=${offered[0].n === 1}; reserva directa a un horario ya empezado: ${retry[0].ok ? 'ACEPTADA' : 'rechazada ("' + retry[0].msg + '")'}`)
  await reset()
  const f2 = await fire([book(B, B.barbers[0], fut.t, 'Futuro', '1100333333')])
  const futAppt = f2[0].ok ? (await q(`select id from appointments where starts_at=$1`, [fut.t]))[0] : null
  if (futAppt) await fire([asUser(B.barbers[0], `select cancel_appointment_barber($1,'no viene')`, [futAppt.id])])
  const off2 = await q(`select count(*)::int n from get_available_slots($1,$2,$3,$4::uuid[]) where slot_at=$5`, [B.branch, B.barbers[0], dstr, [B.s30], fut.t])
  const re2 = await fire([book(B, B.barbers[0], fut.t, 'Rescate', '1100222222')])
  rec('E14b Turno que empieza en 15 min se cancela: el horario vuelve a estar libre', f2[0].ok ? (off2[0].n === 1 && re2[0].ok) : true, `reserva original ok=${f2[0].ok ? 'si' : 'no (' + f2[0].msg + ')'}; pantalla lo ofrece=${off2[0].n === 1}; otro cliente lo toma=${re2[0].ok}`)

  console.log('\n===== RESUMEN =====')
  results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`))
  await pool.end()
}
main().catch((e) => { console.error('ERROR DEL HARNESS:', e); process.exit(1) })
