// lib/guias-registro.js — el botón 🚚 de AUTOMATIZACIONES: busca las guías de
// Servientrega reenviadas al inbox, lee la foto y las registra en el CRM.
// La lógica de decidir vive en lib/guias-servientrega.js (pura y probada); acá
// solo está lo que toca red y base.
//
// Registrar una guía = lo MISMO que hace el CRM a mano (`createGuia` +
// `logCambio` en app/api/pedidos/[id]/route.js del CRM): una fila en
// `crm.guias_despacho` y una línea 'GUIA_DESPACHO' en la bitácora. NO cambia el
// estado del pedido: eso lo sigue haciendo Despacho.
//
// ⚠️ Idempotente por NÚMERO DE GUÍA: una guía que ya está en `guias_despacho` no
// se vuelve a leer ni a registrar, así que apretar el botón dos veces no duplica.

import { getSupabase, CUENTA } from './supabase.js'
import {
  REMITENTES_GUIAS, esTextoDeGuia, extraerDelTexto, extraerDeOcr, mismoNombre, elegirPedido,
} from './guias-servientrega.js'

const DIAS_ATRAS = 15
const MAX_POR_VUELTA = 8          // ~4 s de OCR cada una: entra holgado en los 60 s
const USUARIO = 'INBOX-GUIAS'

// OCR gratuito (Tesseract, sin IA ni tokens). El trabajador se crea una vez por
// vuelta y se cierra al final. En Vercel solo /tmp se puede escribir: ahí cachea
// el idioma que baja la primera vez.
async function crearLector() {
  const { createWorker } = await import('tesseract.js')
  return createWorker('spa', 1, { cachePath: '/tmp/tesseract' })
}

async function leerFoto(lector, url) {
  const r = await fetch(url, { cache: 'no-store' })
  if (!r.ok) throw new Error(`no se pudo bajar la foto (${r.status})`)
  const buf = Buffer.from(await r.arrayBuffer())
  const { data } = await lector.recognize(buf)
  return data?.text || ''
}

const tail9 = (s) => String(s || '').replace(/\D/g, '').slice(-9)

async function clientesPorCelular(crm, celular) {
  const t9 = tail9(celular)
  if (t9.length < 9) return []
  const { data, error } = await crm.from('clientes').select('cliente_id, nombre, celular').ilike('celular', `%${t9}`)
  if (error) throw error
  return data || []
}

async function clientesPorNombre(crm, nombre) {
  const palabras = String(nombre || '').split(/\s+/).filter(w => w.length > 2)
  if (palabras.length < 2) return []
  const { data, error } = await crm.from('clientes').select('cliente_id, nombre, celular')
    .ilike('nombre', `%${palabras[0]}%`).ilike('nombre', `%${palabras[1]}%`).limit(20)
  if (error) throw error
  return (data || []).filter(c => mismoNombre(c.nombre, nombre))
}

/**
 * @param {{ simular?: boolean }} opts  simular=true lee y empareja pero NO escribe.
 * @returns {{ registradas, pendientes, yaEstaban, revisadas }}
 */
export async function procesarGuias({ simular = false } = {}) {
  const sb = getSupabase()
  const crm = sb.schema('crm')
  const desde = new Date(Date.now() - DIAS_ATRAS * 864e5).toISOString()

  const { data: msgs, error } = await sb.from('mensajes')
    .select('wa_message_id, telefono, fecha, texto, media_url')
    .eq('cuenta', CUENTA).eq('direccion', 'ENTRANTE')
    .in('telefono', REMITENTES_GUIAS)
    .gte('fecha', desde)
    // Las más NUEVAS primero: una guía que nunca empareja (envío que no es de un
    // cliente del CRM) no tapa a las de hoy; a los 15 días sale sola de la ventana.
    .order('fecha', { ascending: false })
  if (error) throw error

  const candidatas = []
  for (const m of msgs || []) {
    if (!esTextoDeGuia(m.texto)) continue
    const g = extraerDelTexto(m.texto)
    if (g.numero && !candidatas.some(c => c.guia.numero === g.numero)) candidatas.push({ m, guia: g })
  }

  // Las que ya están en el CRM no se tocan (idempotencia por número de guía).
  const numeros = candidatas.map(c => c.guia.numero)
  const yaRegistradas = new Set()
  if (numeros.length) {
    const { data, error: e } = await crm.from('guias_despacho').select('numero_guia').in('numero_guia', numeros)
    if (e) throw e
    for (const r of data || []) yaRegistradas.add(String(r.numero_guia).trim())
  }
  const porHacer = candidatas.filter(c => !yaRegistradas.has(c.guia.numero))

  const registradas = [], pendientes = []
  let lector = null
  try {
    for (const { m, guia } of porHacer.slice(0, MAX_POR_VUELTA)) {
      const base = { guia: guia.numero, destino: guia.destino, fecha: m.fecha, foto: m.media_url || '' }
      try {
        if (!m.media_url) { pendientes.push({ ...base, motivo: 'llegó sin foto: no se puede leer el destinatario' }); continue }
        lector = lector || await crearLector()
        const ocr = extraerDeOcr(await leerFoto(lector, m.media_url))
        base.destinatario = ocr.nombre
        base.celular = ocr.celulares[0] || ''

        // 1) por celular (lo seguro); 2) si no, por nombre completo.
        let clientes = []
        for (const c of ocr.celulares) { clientes = await clientesPorCelular(crm, c); if (clientes.length) { base.celular = c; break } }
        if (!clientes.length && ocr.nombre) clientes = await clientesPorNombre(crm, ocr.nombre)
        if (!clientes.length) {
          pendientes.push({ ...base, motivo: ocr.celulares.length || ocr.nombre ? 'no encontré a ese cliente en el CRM' : 'no pude leer el destinatario en la foto' })
          continue
        }

        const ids = [...new Set(clientes.map(c => c.cliente_id))]
        const { data: pedidos, error: ep } = await crm.from('pedidos')
          .select('pedido_id, estado_pedido, fecha_pedido').in('cliente_id', ids)
        if (ep) throw ep
        const pids = (pedidos || []).map(p => p.pedido_id)
        const conGuia = new Set()
        if (pids.length) {
          const { data: gs, error: eg } = await crm.from('guias_despacho').select('pedido_id').in('pedido_id', pids)
          if (eg) throw eg
          for (const g of gs || []) conGuia.add(g.pedido_id)
        }
        const { pedido, motivo } = elegirPedido(pedidos, conGuia)
        if (!pedido) { pendientes.push({ ...base, motivo }); continue }

        if (!simular) {
          const { error: ei } = await crm.from('guias_despacho').insert({
            pedido_id: pedido.pedido_id,
            numero_guia: guia.numero,
            transportista: 'SERVIENTREGA',
            foto_guia_url: m.media_url,
            registrado_por: USUARIO,
            notas: `Automático desde WhatsApp (reenvío ${m.telefono}) · ${m.wa_message_id}`,
          })
          if (ei) throw ei
          // La bitácora es un extra: si falla, la guía ya quedó y no se reintenta.
          await crm.from('logs_pedidos').insert({
            pedido_id: pedido.pedido_id, usuario: USUARIO, campo: 'GUIA_DESPACHO',
            valor_antes: '', valor_despues: `SERVIENTREGA #${guia.numero} 📷`,
          }).then(({ error: el }) => { if (el) console.error('[guias] bitácora:', el.message) })
        }
        registradas.push({ ...base, pedido: pedido.pedido_id, estado: pedido.estado_pedido, nota: motivo })
      } catch (e) {
        pendientes.push({ ...base, motivo: `error: ${e?.message || e}` })
      }
    }
  } finally {
    if (lector) await lector.terminate().catch(() => {})
  }

  return {
    simular,
    revisadas: candidatas.length,
    yaEstaban: yaRegistradas.size,
    quedanParaOtraVuelta: Math.max(0, porHacer.length - MAX_POR_VUELTA),
    registradas,
    pendientes,
  }
}
