// Aplica MIGRACIONES_COMBINADAS.sql al proyecto destino vía conexión directa Postgres.
// Uso: node scripts/run_migrations.mjs "<CONNECTION_STRING>"
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const connString = process.argv[2]
if (!connString) {
  console.error('FALTA connection string como primer argumento')
  process.exit(1)
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(__dirname, '..', 'MIGRACIONES_COMBINADAS.sql')
const sql = readFileSync(sqlPath, 'utf8').replace(/^﻿/, '')

const client = new pg.Client({
  connectionString: connString,
  ssl: { rejectUnauthorized: false },
})

try {
  await client.connect()
  const who = await client.query('select current_database() db, current_user usr')
  console.log('CONECTADO:', who.rows[0])
  console.log('Aplicando migraciones (', sql.length, 'chars )...')
  await client.query(sql)
  console.log('OK: migraciones aplicadas sin error')
} catch (e) {
  console.error('ERROR:', e.message)
  if (e.position) console.error('posicion:', e.position)
  process.exitCode = 1
} finally {
  await client.end()
}
