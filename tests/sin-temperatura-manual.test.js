// Guardia del diseño 2026-09-22 (port a MANDI 23-sep): la temperatura es AUTOMÁTICA (tiempo desde el
// último mensaje del cliente, lib/temperatura.js). Nadie la escribe: ni botones,
// ni flujos, ni seguimientos. Si alguien repone un escritor, esta prueba se cae.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const raiz = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
function archivos(dir) {
  const out = []
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) out.push(...archivos(p))
    else if (/\.(js|jsx)$/.test(n)) out.push(p)
  }
  return out
}

// El inbox SOCIAL (FB/IG) tiene su propia temperatura manual y queda fuera por
// ahora (decisión de Rodrigo, 23-sep-2026): sus archivos no cuentan.
const esSocial = (f) => /social|Social/.test(f)

test("nadie escribe la temperatura a mano (WhatsApp)", () => {
  const prohibidos = [/updateTemperatura/, /setTemperatura/, /TEMPERATURA AL LLEGAR/, /temperaturaAlPasar/]
  const culpables = []
  for (const dir of ['app', 'lib', 'components']) {
    for (const f of archivos(join(raiz, dir)).filter(f => !esSocial(f))) {
      const s = readFileSync(f, 'utf8')
      for (const re of prohibidos) if (re.test(s)) culpables.push(`${f.replace(raiz, '')} → ${re}`)
    }
  }
  assert.deepEqual(culpables, [])
})
