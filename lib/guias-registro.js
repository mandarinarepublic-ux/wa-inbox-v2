// lib/guias-registro.js — la sección 🚚 GUÍAS del inbox: las guías de
// Servientrega que Rodri VIP reenvía, leídas y anotadas en el CRM.
// La lógica de decidir vive en lib/guias-servientrega.js (pura y probada); acá
// solo está lo que toca red y base.
//
// Dos tablas, dos papeles:
//   · crm.guias_despacho       → la FUENTE DE VERDAD de "esta guía está en el
//                                pedido". Es la que mira el CRM.
//   · inbox.guias_servientrega → lo que el inbox leyó de cada guía (destinatario,
//                                celular) y, sobre todo, POR QUÉ una quedó sin
//                                asignar. Sin esto la sección no podría listar
//                                las pendientes.
//
// Registrar una guía = lo MISMO que hace el CRM a mano (`createGuia` +
// `logCambio` en app/api/pedidos/[id]/route.js del CRM): una fila en
// `crm.guias_despacho` y una línea 'GUIA_DESPACHO' en la bitácora. NO cambia el
// estado del pedido: eso lo sigue haciendo Despacho.
//
// ⚠️ Idempotente por NÚMERO DE GUÍA: una guía que ya está en `guias_despacho` no
// se vuelve a leer ni a registrar, así que procesar dos veces no duplica.

import { getSupabase, CUENTA } from './supabase.js'
import {
  REMITENTES_GUIAS, esTextoDeGuia, extraerDelTexto, extraerDeOcr, mismoNombre, elegirPedido,
  palabrasParaBuscar, textoBitacora,
} from './guias-servientrega.js'

export const DIAS_ATRAS = 30
const MAX_OCR_POR_VUELTA = 8      // ~2-4 s de OCR cada una: entra holgado en los 60 s
const USUARIO_AUTO = 'INBOX-GUIAS'

// ─── Lectura de la foto (OCR gratuito, Tesseract: sin IA ni tokens) ──────────
// En Vercel solo /tmp se puede escribir: ahí cachea el idioma que baja la primera vez.
async function crearLector() {
  const { createWorker } = await import('tesseract.js')
  return createWorker('spa', 1, { cachePath: '/tmp/tesseract' })
}

async function leerFoto(lector, url) {
  const r = await fetch(url, { cache: 'no-store' })
  if (!r.ok) throw new Error(`no se pudo bajar la foto (${r.status})`)
  const { data } = await lector.recognize(Buffer.from(await r.arrayBuffer()))
  return data?.text || ''
}

// ─── Clientes y pedidos del CRM ─────────────────────────────────────────────
const tail9 = (s) => String(s || '').replace(/\D/g, '').slice(-9)

async function clientesPorCelular(crm, celular) {
  const t9 = tail9(celular)
  if (t9.length < 9) return []
  const { data, error } = await crm.from('clientes').select('cliente_id, nombre, celular').ilike('celular', `%${t9}`)
  if (error) throw error
  return data || []
}

// Por nombre: se trae a quien comparta alguna de las palabras largas del nombre
// de la guía y `mismoNombre` decide (acepta una letra de diferencia por palabra).
async function clientesPorNombre(crm, nombre) {
  const palabras = palabrasParaBuscar(nombre).sort((x, y) => y.length - x.length).slice(0, 3)
  if (palabras.length < 2) return []
  const vistos = new Map()
  for (const w of palabras) {
    // Sin la última letra: "NAHIM" también tiene que traer a "Nahin".
    const { data, error } = await crm.from('clientes').select('cliente_id, nombre, celular')
      .ilike('nombre', `%${w.slice(0, -1)}%`).limit(200)
    if (error) throw error
    for (const c of data || []) vistos.set(c.cliente_id, c)
  }
  return [...vistos.values()].filter(c => mismoNombre(c.nombre, nombre))
}

async function guiasDePedidos(crm, pedidoIds) {
  const conGuia = new Set()
  if (!pedidoIds.length) return conGuia
  const { data, error } = await crm.from('guias_despacho').select('pedido_id').in('pedido_id', pedidoIds)
  if (error) throw error
  for (const g of data || []) conGuia.add(g.pedido_id)
  return conGuia
}

/**
 * Con lo leído de la foto, ¿a qué pedido va? 1) por celular (lo seguro);
 * 2) si no, por nombre, y solo si hay UNA persona posible.
 * @returns {{ pedido, motivo, metodo, nota, celular }}
 */
async function emparejar(crm, { celulares = [], nombre = '' }) {
  let clientes = [], metodo = 'celular', celular = celulares[0] || ''
  for (const c of celulares) {
    clientes = await clientesPorCelular(crm, c)
    if (clientes.length) { celular = c; break }
  }
  if (!clientes.length && nombre) { clientes = await clientesPorNombre(crm, nombre); metodo = 'nombre' }
  if (!clientes.length) {
    return { pedido: null, celular, motivo: celulares.length || nombre ? 'no encontré a ese cliente en el CRM' : 'no pude leer el destinatario en la foto' }
  }
  if (metodo === 'nombre' && clientes.length > 1) {
    return { pedido: null, celular, motivo: `hay ${clientes.length} clientes con ese nombre en el CRM` }
  }
  const ids = [...new Set(clientes.map(c => c.cliente_id))]
  const { data: pedidos, error } = await crm.from('pedidos')
    .select('pedido_id, estado_pedido, fecha_pedido').in('cliente_id', ids)
  if (error) throw error
  const conGuia = await guiasDePedidos(crm, (pedidos || []).map(p => p.pedido_id))
  const { pedido, motivo } = elegirPedido(pedidos, conGuia)
  if (!pedido) return { pedido: null, celular, motivo }
  // Por NOMBRE se avisa con el celular del CRM: así se ve si la guía o el CRM
  // tienen el número mal.
  const avisoNombre = metodo === 'nombre'
    ? `por nombre (${String(clientes[0].nombre || '').trim()}, cel. en el CRM ${clientes[0].celular || '—'})` : ''
  return { pedido, celular, metodo, motivo: '', nota: [avisoNombre, motivo].filter(Boolean).join(' · ') }
}

// ─── Escribir ───────────────────────────────────────────────────────────────
// `fechaDespacho`: la impresa en la guía (o, si el OCR no la leyó, la del
// mensaje). ☠️ Sin pasarla, la base pone now(): la hora del CLIC, que es lo que
// quedó en las primeras 23 guías del 9-oct.
async function escribirEnCrm(crm, { numero, pedidoId, fotoUrl, usuario, notas, fechaDespacho, bitacora }) {
  const { error } = await crm.from('guias_despacho').insert({
    pedido_id: pedidoId, numero_guia: numero, transportista: 'SERVIENTREGA',
    foto_guia_url: fotoUrl || '', registrado_por: usuario, notas,
    ...(fechaDespacho ? { fecha_despacho: fechaDespacho } : {}),
  })
  if (error) throw error
  // La bitácora es un extra: si falla, la guía ya quedó y no se reintenta.
  const { error: el } = await crm.from('logs_pedidos').insert({
    pedido_id: pedidoId, usuario, campo: 'GUIA_DESPACHO',
    valor_antes: '', valor_despues: bitacora || `SERVIENTREGA #${numero}${fotoUrl ? ' 📷' : ''}`,
  })
  if (el) console.error('[guias] bitácora:', el.message)
}

async function guardarFila(sb, fila) {
  const { error } = await sb.from('guias_servientrega')
    .upsert({ cuenta: CUENTA, ...fila, actualizado_en: new Date().toISOString() }, { onConflict: 'cuenta,numero_guia' })
  if (error) console.error('[guias] guardar fila:', error.message)
}

// ─── Lo que llegó al chat ───────────────────────────────────────────────────
/** Las guías reenviadas en los últimos DIAS_ATRAS días, más nuevas primero, sin repetir. */
async function guiasDelChat(sb) {
  const desde = new Date(Date.now() - DIAS_ATRAS * 864e5).toISOString()
  const { data, error } = await sb.from('mensajes')
    .select('wa_message_id, telefono, fecha, texto, media_url')
    .eq('cuenta', CUENTA).eq('direccion', 'ENTRANTE')
    .in('telefono', REMITENTES_GUIAS)
    .gte('fecha', desde)
    .order('fecha', { ascending: false })
  if (error) throw error
  const out = []
  for (const m of data || []) {
    if (!esTextoDeGuia(m.texto)) continue
    const g = extraerDelTexto(m.texto)
    if (g.numero && !out.some(x => x.guia.numero === g.numero)) out.push({ m, guia: g })
  }
  return out
}

async function enCrm(crm, numeros) {
  const mapa = new Map()   // numero → { pedido_id, registrado_por, fecha_despacho }
  if (!numeros.length) return mapa
  const { data, error } = await crm.from('guias_despacho')
    .select('numero_guia, pedido_id, registrado_por, fecha_despacho').in('numero_guia', numeros)
  if (error) throw error
  for (const r of data || []) mapa.set(String(r.numero_guia).trim(), r)
  return mapa
}

async function filasGuardadas(sb, numeros) {
  const mapa = new Map()
  if (!numeros.length) return mapa
  const { data, error } = await sb.from('guias_servientrega').select('*').eq('cuenta', CUENTA).in('numero_guia', numeros)
  if (error) throw error
  for (const r of data || []) mapa.set(r.numero_guia, r)
  return mapa
}

// ─── API de la sección ──────────────────────────────────────────────────────

/**
 * Procesa: las NUEVAS se leen con OCR (hasta 8 por vuelta) y las PENDIENTES se
 * vuelven a emparejar con lo ya leído, sin OCR (si alguien creó al cliente en el
 * CRM después, se resuelven solas).
 * @param {{ simular?: boolean }} opts  simular=true lee y empareja pero NO escribe.
 */
export async function procesarGuias({ simular = false } = {}) {
  const sb = getSupabase()
  const crm = sb.schema('crm')
  const candidatas = await guiasDelChat(sb)
  const numeros = candidatas.map(c => c.guia.numero)
  const [registradasCrm, filas] = await Promise.all([enCrm(crm, numeros), filasGuardadas(sb, numeros)])

  const registradas = [], pendientes = []
  let lector = null, ocrHechos = 0, quedan = 0
  try {
    for (const { m, guia } of candidatas) {
      if (registradasCrm.has(guia.numero)) continue
      const fila = filas.get(guia.numero)
      const base = {
        numero_guia: guia.numero, wa_message_id: m.wa_message_id, fecha_mensaje: m.fecha,
        media_url: m.media_url || '', destino: guia.destino, direccion: guia.direccion,
      }
      try {
        // Lo leído de la foto: de la fila guardada si ya se leyó, si no, OCR.
        let leido
        if (fila && (fila.celular || fila.destinatario)) {
          leido = { celulares: fila.celular ? [fila.celular] : [], nombre: fila.destinatario || '', fecha: fila.fecha_guia || '' }
        } else if (!m.media_url) {
          leido = { celulares: [], nombre: '', fecha: '' }
        } else {
          if (ocrHechos >= MAX_OCR_POR_VUELTA) { quedan++; continue }
          lector = lector || await crearLector()
          leido = extraerDeOcr(await leerFoto(lector, m.media_url), guia.direccion)
          ocrHechos++
        }
        base.destinatario = leido.nombre
        base.celular = leido.celulares[0] || ''
        base.fecha_guia = leido.fecha || null

        const r = m.media_url || leido.celulares.length || leido.nombre
          ? await emparejar(crm, leido)
          : { pedido: null, motivo: 'llegó sin foto: no se puede leer el destinatario' }
        if (r.celular) base.celular = r.celular
        if (!r.pedido) {
          pendientes.push({ ...base, motivo: r.motivo })
          if (!simular) await guardarFila(sb, { ...base, estado: 'PENDIENTE', motivo: r.motivo, pedido_id: null, metodo: null })
          continue
        }
        if (!simular) {
          await escribirEnCrm(crm, {
            numero: guia.numero, pedidoId: r.pedido.pedido_id, fotoUrl: m.media_url, usuario: USUARIO_AUTO,
            notas: `Automático desde WhatsApp (reenvío ${m.telefono}, ${r.metodo}) · ${m.wa_message_id}`,
            fechaDespacho: base.fecha_guia || m.fecha,
            bitacora: textoBitacora({ numero: guia.numero, foto: m.media_url, fechaGuia: base.fecha_guia || m.fecha, destino: guia.destino, destinatario: base.destinatario, celular: base.celular, direccion: guia.direccion, metodo: r.metodo }),
          })
          await guardarFila(sb, { ...base, estado: 'REGISTRADA', motivo: r.nota || null, pedido_id: r.pedido.pedido_id, metodo: r.metodo, registrado_por: USUARIO_AUTO })
        }
        registradas.push({ ...base, pedido_id: r.pedido.pedido_id, estado_pedido: r.pedido.estado_pedido, nota: r.nota })
      } catch (e) {
        pendientes.push({ ...base, motivo: `error: ${e?.message || e}` })
      }
    }
  } finally {
    if (lector) await lector.terminate().catch(() => {})
  }

  return { simular, revisadas: candidatas.length, yaEstaban: registradasCrm.size, quedanParaOtraVuelta: quedan, registradas, pendientes }
}

/**
 * Todo lo de la sección: cada guía reenviada en los últimos DIAS_ATRAS días con
 * su estado — REGISTRADA (está en el CRM), PENDIENTE (se leyó y no se pudo
 * asignar: con motivo) o NUEVA (todavía no se procesó).
 */
export async function listarGuias() {
  const sb = getSupabase()
  const crm = sb.schema('crm')
  const candidatas = await guiasDelChat(sb)
  const numeros = candidatas.map(c => c.guia.numero)
  const [registradasCrm, filas] = await Promise.all([enCrm(crm, numeros), filasGuardadas(sb, numeros)])

  // Nombre del cliente de cada pedido, para mostrarlo al lado.
  const pids = [...new Set([...registradasCrm.values()].map(r => r.pedido_id))]
  const clienteDe = new Map()
  if (pids.length) {
    const { data, error } = await crm.from('pedidos').select('pedido_id, estado_pedido, clientes(nombre)').in('pedido_id', pids)
    if (error) throw error
    for (const p of data || []) clienteDe.set(p.pedido_id, { cliente: String(p.clientes?.nombre || '').trim(), estado_pedido: p.estado_pedido })
  }

  const guias = candidatas.map(({ m, guia }) => {
    const f = filas.get(guia.numero) || {}
    const enC = registradasCrm.get(guia.numero)
    return {
      numero_guia: guia.numero, fecha_mensaje: m.fecha, media_url: m.media_url || '',
      destino: guia.destino, direccion: guia.direccion,
      destinatario: f.destinatario || '', celular: f.celular || '', fecha_guia: f.fecha_guia || '',
      estado: enC ? 'REGISTRADA' : (f.estado === 'PENDIENTE' ? 'PENDIENTE' : 'NUEVA'),
      motivo: enC ? '' : (f.motivo || ''),
      nota: enC ? (f.motivo || '') : '',
      pedido_id: enC?.pedido_id || '',
      registrado_por: enC?.registrado_por || '',
      registrado_en: enC?.fecha_despacho || '',
      metodo: enC ? (f.metodo || (enC.registrado_por === USUARIO_AUTO ? '' : 'crm')) : '',
      ...(enC ? clienteDe.get(enC.pedido_id) || {} : {}),
    }
  })
  return { dias: DIAS_ATRAS, guias }
}

/** Buscar un pedido para asignar a mano: por número de pedido, celular o nombre del cliente. */
export async function buscarPedidos(q) {
  const crm = getSupabase().schema('crm')
  const t = String(q || '').trim()
  if (t.length < 3) return []
  let clienteIds = null
  let pedidosQ = crm.from('pedidos').select('pedido_id, estado_pedido, fecha_pedido, monto_total, cliente_id, clientes(nombre, celular)')
  const digitos = t.replace(/\D/g, '')
  if (/[a-z]{2,}-/i.test(t)) {
    pedidosQ = pedidosQ.ilike('pedido_id', `%${t}%`)
  } else if (digitos.length >= 7 && digitos.length === t.replace(/[\s+-]/g, '').length) {
    clienteIds = (await clientesPorCelular(crm, digitos)).map(c => c.cliente_id)
  } else {
    const palabras = t.split(/\s+/).filter(w => w.length >= 2).slice(0, 3)
    let cq = crm.from('clientes').select('cliente_id')
    for (const w of palabras) cq = cq.ilike('nombre', `%${w}%`)
    const { data, error } = await cq.limit(50)
    if (error) throw error
    clienteIds = (data || []).map(c => c.cliente_id)
  }
  if (clienteIds) {
    if (!clienteIds.length) return []
    pedidosQ = pedidosQ.in('cliente_id', clienteIds)
  }
  const { data, error } = await pedidosQ.order('fecha_pedido', { ascending: false }).limit(15)
  if (error) throw error
  const conGuia = await guiasDePedidos(crm, (data || []).map(p => p.pedido_id))
  return (data || []).map(p => ({
    pedido_id: p.pedido_id, estado_pedido: p.estado_pedido, fecha_pedido: p.fecha_pedido,
    monto_total: p.monto_total, cliente: String(p.clientes?.nombre || '').trim(),
    celular: p.clientes?.celular || '', tiene_guia: conGuia.has(p.pedido_id),
  }))
}

/** Asignar A MANO una guía a un pedido (la persona eligió el pedido mirando la foto). */
export async function asignarGuia({ numero, pedidoId, usuario }) {
  const sb = getSupabase()
  const crm = sb.schema('crm')
  numero = String(numero || '').trim()
  pedidoId = String(pedidoId || '').trim()
  if (!numero || !pedidoId) throw new Error('Falta la guía o el pedido')

  const c = (await guiasDelChat(sb)).find(x => x.guia.numero === numero)
  if (!c) throw new Error(`La guía ${numero} no está entre las reenviadas de los últimos ${DIAS_ATRAS} días`)
  if ((await enCrm(crm, [numero])).has(numero)) throw new Error(`La guía ${numero} ya está registrada en el CRM`)
  const { data: ped, error } = await crm.from('pedidos').select('pedido_id').eq('pedido_id', pedidoId).maybeSingle()
  if (error) throw error
  if (!ped) throw new Error(`No existe el pedido ${pedidoId}`)

  const quien = usuario || 'INBOX'
  const previa = (await filasGuardadas(sb, [numero])).get(numero) || {}
  const fechaGuia = previa.fecha_guia || c.m.fecha
  await escribirEnCrm(crm, {
    numero, pedidoId, fotoUrl: c.m.media_url, usuario: quien,
    notas: `Asignada a mano desde el inbox (reenvío ${c.m.telefono}) · ${c.m.wa_message_id}`,
    fechaDespacho: fechaGuia,
    bitacora: textoBitacora({ numero, foto: c.m.media_url, fechaGuia, destino: c.guia.destino, destinatario: previa.destinatario, celular: previa.celular, direccion: c.guia.direccion, metodo: 'manual' }),
  })
  await guardarFila(sb, {
    numero_guia: numero, wa_message_id: c.m.wa_message_id, fecha_mensaje: c.m.fecha,
    media_url: c.m.media_url || '', destino: c.guia.destino, direccion: c.guia.direccion,
    destinatario: previa.destinatario || null, celular: previa.celular || null, fecha_guia: previa.fecha_guia || null,
    estado: 'REGISTRADA', motivo: null, pedido_id: pedidoId, metodo: 'manual', registrado_por: quien,
  })
  return { ok: true, numero, pedidoId }
}
