// Prueba de normalizePhone (app/components/phone-input.tsx): que el MISMO teléfono produzca SIEMPRE la
// misma forma canónica, venga como venga escrito. Se corre con:  node scripts/probar-normalizacion-de-telefonos.mjs
// Nació de un bug real: 3415099604 (área 341 + 5099604) quedaba como 34099604 porque la regla del "15" lo
// confundía con un celular viejo. Los números de acá son inventados.
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import Module from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const js = ts.transpileModule(readFileSync('app/components/phone-input.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020 },
}).outputText
const m = new Module('phone-input'); m.paths = Module._nodeModulePaths(process.cwd()); m._compile(js, 'phone-input.js')
const { normalizePhone } = m.exports

const casos = [
  ['3415099604', '+543415099604'], // área 341 + 5099604: el "15" está en el medio, NO es prefijo
  ['341 509-9604', '+543415099604'],
  ['+54 341 509-9604', '+543415099604'],
  ['+54 9 341 509-9604', '+543415099604'],
  ['0341 509 9604', '+543415099604'],
  ['3411234567', '+543411234567'],
  ['341 15 123-4567', '+543411234567'], // celular viejo con 15: se limpia
  ['0341 15 1234567', '+543411234567'],
  ['011 15 1234-5678', '+541112345678'], // AMBA, área de 2 dígitos
  ['11 15 1234 5678', '+541112345678'],
  ['3415123456', '+543415123456'],
  ['3411512345', '+543411512345'],
  ['3515099604', '+543515099604'],
  ['2611512345', '+542611512345'],
]
let mal = 0
for (const [entrada, esperado] of casos) {
  const obtenido = normalizePhone(entrada)
  const ok = obtenido === esperado
  if (!ok) mal++
  console.log(`${ok ? 'ok ' : 'MAL'}  ${entrada.padEnd(22)} -> ${obtenido}${ok ? '' : `   (esperado ${esperado})`}`)
}
console.log(mal === 0 ? `\nTodo bien (${casos.length} casos)` : `\n${mal} caso(s) mal`)
process.exit(mal === 0 ? 0 : 1)
