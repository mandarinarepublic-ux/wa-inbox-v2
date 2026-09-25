// scripts/enviar-lote.mjs — manda un lote de mensajes por el inbox de MANDI.
//
// Lo usa Claude desde la terminal cuando Rodrigo aprueba un envío ("dale").
// Cada mensaje sale por /api/saliente de producción, con la credencial de máquina
// (INBOX_API_TOKEN), así que va por el número correcto y queda en su chat igual
// que si lo hubiera mandado un vendedor.
//
//   node scripts/enviar-lote.mjs lote.json            → ensayo: revisa y NO manda
//   node scripts/enviar-lote.mjs lote.json --enviar   → manda de verdad
//
// lote.json = [{ telefono, phone_id, nombre, texto, entrante_at, saliente_at }]
// Justo antes de cada envío relee el hilo y decide con lib/lote-envio.js.
// El resultado queda en <lote>.resultado.json con el wamid de cada envío, para
// verificar la entrega en inbox.webhook_eventos (un 200 no es prueba de entrega).
import fs from 'node:fs'
import path from 'node:path'
import { revisarAntesDeEnviar, validarLote } from '../lib/lote-envio.js'
import { urlPropia } from '../lib/url-propia.js'

const PAUSA_MS = 20_000

function leerToken() {
  if (process.env.INBOX_API_TOKEN) return limpiar(process.env.INBOX_API_TOKEN)
  const archivo = path.resolve('.env.local')
  if (!fs.existsSync(archivo)) return ''
  for (const linea of fs.readFileSync(archivo, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*INBOX_API_TOKEN\s*=\s*(.*)$/)
    if (m) return limpiar(m[1])
  }
  return ''
}
// Comillas de `vercel env pull` y el BOM invisible que pega PowerShell (lib/env.js).
const limpiar = (v) => String(v || '').trim().replace(/^["']|["']$/g, '').replace(/[^\x21-\x7E]/g, '')

const esperar = (ms) => new Promise(r => setTimeout(r, ms))

async function main() {
  const [rutaLote, ...banderas] = process.argv.slice(2)
  const enviar = banderas.includes('--enviar')
  if (!rutaLote) {
    console.error('Uso: node scripts/enviar-lote.mjs lote.json [--enviar]')
    process.exit(2)
  }
  const lote = JSON.parse(fs.readFileSync(rutaLote, 'utf8'))
  const errores = validarLote(lote)
  if (errores.length) {
    console.error('El lote tiene errores, no se manda nada:\n- ' + errores.join('\n- '))
    process.exit(2)
  }
  const token = leerToken()
  if (!token) {
    console.error('Falta INBOX_API_TOKEN en .env.local (cópialo de Vercel, proyecto wa-inbox-v2).')
    process.exit(2)
  }
  const base = urlPropia()
  const auth = { Authorization: `Bearer ${token}` }
  console.log(`${enviar ? 'ENVÍO REAL' : 'ENSAYO (no manda nada)'} · ${lote.length} destinatarios · ${base}\n`)

  const resultado = []
  let enviados = 0
  for (const [i, d] of lote.entries()) {
    const quien = d.nombre || d.telefono
    try {
      const url = `${base}/api/hilo?phone=${encodeURIComponent(d.telefono)}&limite=30&canal=${encodeURIComponent(d.phone_id)}`
      const rh = await fetch(url, { headers: auth, cache: 'no-store' })
      // fetch no lanza con 4xx/5xx: un 401 aquí es la clave mala, no "chat vacío".
      if (!rh.ok) throw new Error(`no se pudo leer el chat (HTTP ${rh.status})`)
      const hilo = await rh.json()
      const r = revisarAntesDeEnviar({ hilo, entranteEsperadoAt: d.entrante_at, salienteEsperadoAt: d.saliente_at, texto: d.texto })
      if (!r.ok) {
        console.log(`⏭  ${quien}: ${r.motivo}`)
        resultado.push({ ...d, estado: 'saltado', motivo: r.motivo })
        continue
      }
      if (!enviar) {
        console.log(`✓  ${quien}: se mandaría`)
        resultado.push({ ...d, estado: 'listo' })
        continue
      }
      if (enviados > 0) await esperar(PAUSA_MS)
      const rs = await fetch(`${base}/api/saliente`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        // auto:true = no cuenta como respuesta de una persona (no toca push, flujo ni 📌).
        body: JSON.stringify({ Telefono: d.telefono, Mensaje: d.texto, Nombre: d.nombre || '', Canal: d.phone_id, auto: true }),
      })
      const data = await rs.json().catch(() => ({}))
      if (!rs.ok || !data.ok) throw new Error(data.error || `HTTP ${rs.status}`)
      enviados++
      console.log(`📤 ${quien}: enviado (${data.wamid})`)
      resultado.push({ ...d, estado: 'enviado', wamid: data.wamid })
    } catch (e) {
      console.log(`❌ ${quien}: ${e.message}`)
      resultado.push({ ...d, estado: 'error', motivo: e.message })
    }
    if (i === 0 && resultado[0]?.estado === 'error' && /HTTP 401/.test(resultado[0].motivo)) {
      console.error('\nLa clave fue rechazada (401). Revisa INBOX_API_TOKEN; no sigo.')
      break
    }
  }

  const salida = rutaLote.replace(/\.json$/i, '') + '.resultado.json'
  fs.writeFileSync(salida, JSON.stringify(resultado, null, 2))
  const cuenta = (e) => resultado.filter(r => r.estado === e).length
  console.log(`\nEnviados ${cuenta('enviado')} · listos ${cuenta('listo')} · saltados ${cuenta('saltado')} · errores ${cuenta('error')}`)
  console.log(`Detalle: ${salida}`)
}

main().catch(e => { console.error(e); process.exit(1) })
