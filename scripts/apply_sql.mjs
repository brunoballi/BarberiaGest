// Aplica un archivo SQL a una base Postgres vía conexión directa.
// Uso: node scripts/apply_sql.mjs <ruta_sql> "<CONNECTION_STRING>"
import { readFileSync } from 'node:fs'
import pg from 'pg'

const [, , sqlPath, connString] = process.argv
if (!sqlPath || !connString) {
  console.error('Uso: node scripts/apply_sql.mjs <ruta_sql> "<CONNECTION_STRING>"')
  process.exit(1)
}

let sql = readFileSync(sqlPath, 'utf8').replace(/^﻿/, '')

const client = new pg.Client({ connectionString: connString, ssl: { rejectUnauthorized: false } })

try {
  await client.connect()
  const who = await client.query('select current_database() db, current_user usr')
  console.log('CONECTADO:', who.rows[0])
  console.log('Aplicando', sqlPath, '(', sql.length, 'chars )...')
  await client.query(sql)
  console.log('OK: SQL aplicado sin error')
} catch (e) {
  console.error('ERROR:', e.message)
  if (e.where) console.error('where:', e.where)
  process.exitCode = 1
} finally {
  await client.end()
}
