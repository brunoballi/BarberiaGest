// Load test real contra la API de Supabase (PostgREST + GoTrue).
// Node >=18 (usa fetch nativo). NO instala nada. Sin secretos hardcodeados:
// todo viene por variables de entorno.
//
// Uso (PowerShell):
//   $env:SUPABASE_URL="https://<ref>.supabase.co"
//   $env:SUPABASE_ANON_KEY="<anon key del branch>"
//   $env:TEST_EMAIL="loadtest@valhalla.test"; $env:TEST_PASSWORD="..."
//   $env:VUS="25"; $env:DURATION_S="30"
//   node loadtest/run.mjs
//
// IMPORTANTE: correr SOLO contra un entorno aislado (Supabase branch), nunca prod.

const URL = process.env.SUPABASE_URL
const ANON = process.env.SUPABASE_ANON_KEY
const EMAIL = process.env.TEST_EMAIL
const PASSWORD = process.env.TEST_PASSWORD
const VUS = parseInt(process.env.VUS ?? '25', 10)          // usuarios virtuales concurrentes
const DURATION_S = parseInt(process.env.DURATION_S ?? '30', 10)

if (!URL || !ANON || !EMAIL || !PASSWORD) {
  console.error('Faltan envs: SUPABASE_URL, SUPABASE_ANON_KEY, TEST_EMAIL, TEST_PASSWORD')
  process.exit(1)
}

async function signIn() {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  if (!r.ok) throw new Error(`login falló ${r.status}: ${await r.text()}`)
  return (await r.json()).access_token
}

// Endpoints representativos del uso real (lecturas). Se completan con ?select=*&limit=...
const ENDPOINTS = [
  '/rest/v1/weeks?select=*&order=start_date.desc&limit=10',
  '/rest/v1/services?select=*',
  '/rest/v1/benefits?select=*&is_active=eq.true',
  '/rest/v1/transactions?select=*&order=transaction_date.desc&limit=50',
  '/rest/v1/settlements?select=*&limit=50',
  '/rest/v1/expenses?select=*&limit=50',
]

const lat = []           // latencias (ms)
const status = {}        // conteo por código
let done = 0, errors = 0

function pct(arr, p) {
  if (!arr.length) return 0
  const s = [...arr].sort((a, b) => a - b)
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))])
}

async function worker(token, deadline) {
  const headers = { apikey: ANON, Authorization: `Bearer ${token}` }
  let i = 0
  while (Date.now() < deadline) {
    const path = ENDPOINTS[i++ % ENDPOINTS.length]
    const t0 = performance.now()
    try {
      const r = await fetch(URL + path, { headers })
      await r.text()
      lat.push(performance.now() - t0)
      status[r.status] = (status[r.status] ?? 0) + 1
      if (!r.ok) errors++
    } catch {
      errors++
      status['ERR'] = (status['ERR'] ?? 0) + 1
    }
    done++
  }
}

const t = await signIn()
console.log(`Login OK. Lanzando ${VUS} VUs por ${DURATION_S}s contra ${URL}`)
const deadline = Date.now() + DURATION_S * 1000
const start = performance.now()
await Promise.all(Array.from({ length: VUS }, () => worker(t, deadline)))
const elapsed = (performance.now() - start) / 1000

console.log('\n===== RESULTADO LOAD TEST =====')
console.log(`Requests:      ${done}`)
console.log(`Duración:      ${elapsed.toFixed(1)}s`)
console.log(`Throughput:    ${(done / elapsed).toFixed(1)} req/s`)
console.log(`Errores:       ${errors} (${((errors / done) * 100).toFixed(2)}%)`)
console.log(`Latencia p50:  ${pct(lat, 50)} ms`)
console.log(`Latencia p95:  ${pct(lat, 95)} ms`)
console.log(`Latencia p99:  ${pct(lat, 99)} ms`)
console.log(`Status:        ${JSON.stringify(status)}`)
