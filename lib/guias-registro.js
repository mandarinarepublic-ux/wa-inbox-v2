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
// `crm.guias_despacho`, una línea 'GUIA_DESPACHO' en la bitácora y el pedido a
// COMPLETADO (como "Registrar despacho" del CRM). Ver completarPedido.
//
// ⚠️ Idempotente por NÚMERO DE GUÍA: una guía que ya está en `guias_despacho` no
// se vuelve a leer ni a registrar, así que procesar dos veces no duplica.

import { getSupabase, CUENTA } from './supabase.js'
import {
  REMITENTES_GUIAS, esTextoDeGuia, extraerDelTexto, extraerDeOcr, mismoNombre, elegirPedido,
  palabrasParaBuscar, textoBitacora, celularCasiIgual, direccionParecida, nombreCompatible,
  excluidoDeGuias,
  patronSinTildes, palabrasDireccionParaBuscar, puntuarCliente, puedeRecibirGuia, ordenarResultados, tipoDeBusqueda,
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
const COLS_CLIENTE = 'cliente_id, nombre, celular, cedula, direccion'

async function clientesPorCedula(crm, cedula) {
  // En el CRM la cédula aparece con espacios al final o como RUC (+001): prefijo.
  const { data, error } = await crm.from('clientes').select(COLS_CLIENTE).ilike('cedula', `${cedula}%`)
  if (error) throw error
  return data || []
}

async function clientesPorCelular(crm, celular) {
  const t9 = tail9(celular)
  if (t9.length < 9) return []
  const { data, error } = await crm.from('clientes').select(COLS_CLIENTE).ilike('celular', `%${t9}`)
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
    const { data, error } = await crm.from('clientes').select(COLS_CLIENTE)
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
 * Con lo leído de la foto, ¿a qué pedido va?
 *
 * ☠️ Regla de Rodrigo (10-oct): "en caso de duda no registres la guía; prefiero
 * hacerlo a mano". Registrar pasa el pedido a COMPLETADO, así que un error se
 * paga caro. Se registra SOLA únicamente cuando no hay nada que dudar:
 *   · CÉDULA que está en el CRM (hoy la guía no la imprime, ver cedulaValida), o
 *   · CELULAR exacto de UN solo cliente, cuyo nombre no contradice al de la
 *     guía, y con UN solo pedido que pueda recibirla.
 * Todo lo demás —encontrado por nombre (aunque coincidan dirección o celular a
 * un dígito), varios clientes con ese celular, nombre distinto, varios pedidos
 * posibles— queda PENDIENTE con el pedido propuesto (`sugerido`) y el motivo de
 * la duda, para confirmarlo con un clic.
 *
 * @returns {{ pedido, sugerido, motivo, metodo, nota, celular }}
 *   `pedido` solo cuando se puede registrar sin preguntar.
 */
async function emparejar(crm, { celulares = [], nombre = '', cedulas = [] }, direccionGuia = '') {
  let clientes = [], metodo = '', celular = celulares[0] || ''
  for (const c of cedulas) {
    clientes = await clientesPorCedula(crm, c)
    if (clientes.length) { metodo = 'cedula'; break }
  }
  if (!clientes.length) {
    for (const c of celulares) {
      clientes = await clientesPorCelular(crm, c)
      if (clientes.length) { celular = c; metodo = 'celular'; break }
    }
  }
  if (!clientes.length && nombre) { clientes = await clientesPorNombre(crm, nombre); metodo = 'nombre' }
  if (!clientes.length) {
    return { pedido: null, celular, motivo: celulares.length || nombre ? 'no encontré a ese cliente en el CRM' : 'no pude leer el destinatario en la foto' }
  }
  const personas = new Set(clientes.map(c => c.cliente_id)).size
  if (metodo === 'nombre' && personas > 1) {
    return { pedido: null, celular, motivo: `hay ${personas} clientes con ese nombre en el CRM` }
  }
  const ids = [...new Set(clientes.map(c => c.cliente_id))]
  const { data: pedidos, error } = await crm.from('pedidos')
    .select('pedido_id, estado_pedido, fecha_pedido, direccion_pedido, cliente_id').in('cliente_id', ids)
  if (error) throw error
  const conGuia = await guiasDePedidos(crm, (pedidos || []).map(p => p.pedido_id))
  const { pedido, motivo, posibles } = elegirPedido(pedidos, conGuia)
  if (!pedido) return { pedido: null, celular, motivo }

  const cli = clientes.find(c => c.cliente_id === pedido.cliente_id) || clientes[0]
  const nombreCrm = String(cli.nombre || '').trim()
  // El cliente que se encontró en el CRM puede ser un excluido aunque la foto
  // no se haya leído bien (ver EXCLUIDOS_DE_GUIAS).
  const exCrm = excluidoDeGuias({ nombre: nombreCrm, celulares: [cli.celular] })
  if (exCrm) return { pedido: null, celular, excluido: exCrm, motivo: `excluido: las guías de ${exCrm} no se registran desde GUÍAS` }
  const duda = (porque) => ({ pedido: null, sugerido: pedido, celular, motivo: `duda: ${porque} — propuesto ${pedido.pedido_id} (${nombreCrm})` })

  if (metodo === 'cedula') return posibles > 1 ? duda(motivo) : { pedido, celular, metodo, motivo: '', nota: '' }

  if (metodo === 'celular') {
    if (personas > 1) return duda(`${personas} clientes del CRM tienen ese celular`)
    if (nombre && !nombreCompatible(nombreCrm, nombre)) return duda(`el celular cuadra pero el nombre de la guía (${nombre}) no se parece al del CRM`)
    if (posibles > 1) return duda(motivo)
    return { pedido, celular, metodo, motivo: '', nota: '' }
  }

  // Por nombre: siempre a confirmar. Se dice qué lo respalda para decidir rápido.
  const celCasi = celulares.some(c => celularCasiIgual(c, cli.celular))
  const dirIgual = direccionParecida(pedido.direccion_pedido || cli.direccion || '', direccionGuia)
  const respaldo = [
    celCasi ? `celular a un dígito (CRM ${cli.celular})` : `celular distinto (CRM ${cli.celular || '—'})`,
    dirIgual ? 'misma dirección' : 'dirección distinta',
    posibles > 1 ? motivo : '',
  ].filter(Boolean).join(', ')
  return duda(`encontrado solo por nombre; ${respaldo}`)
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
  return completarPedido(crm, pedidoId, usuario)
}

// Pedido con guía = despachado = COMPLETADO, igual que "Registrar despacho" del
// CRM (app/dashboard/despacho/page.js manda ESTADO_PEDIDO:'COMPLETADO' junto con
// la guía) y con la misma línea 'ESTADO_PEDIDO' en la bitácora, que es la que
// usa lib/etapaCliente.js del CRM para fechar el "en tránsito". Un pedido ya
// cerrado (COMPLETADO, ENTREGADO, CANCELADO) no se toca.
const CERRADOS = ['COMPLETADO', 'ENTREGADO', 'CANCELADO']
async function completarPedido(crm, pedidoId, usuario) {
  const { data: p, error } = await crm.from('pedidos').select('estado_pedido').eq('pedido_id', pedidoId).maybeSingle()
  if (error) throw error
  const antes = String(p?.estado_pedido || '')
  if (!p || CERRADOS.includes(antes.toUpperCase())) return antes
  const { error: eu } = await crm.from('pedidos')
    .update({ estado_pedido: 'COMPLETADO', fecha_actualizacion: new Date().toISOString() })
    .eq('pedido_id', pedidoId).eq('estado_pedido', antes)   // si otro lo cambió en medio, no se pisa
  if (eu) throw eu
  const { error: el } = await crm.from('logs_pedidos').insert({
    pedido_id: pedidoId, usuario, campo: 'ESTADO_PEDIDO', valor_antes: antes, valor_despues: 'COMPLETADO',
  })
  if (el) console.error('[guias] bitácora estado:', el.message)
  return 'COMPLETADO'
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

  const registradas = [], pendientes = [], excluidas = []
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

        // Excluidos (EXCLUIDOS_DE_GUIAS): ni se empareja. Queda EXCLUIDA, fuera
        // de "Sin asignar", y tampoco se puede asignar a mano.
        const exGuia = excluidoDeGuias(leido)
        const r = exGuia
          ? { pedido: null, excluido: exGuia, motivo: `excluido: las guías de ${exGuia} no se registran desde GUÍAS` }
          : m.media_url || leido.celulares.length || leido.nombre
            ? await emparejar(crm, leido, guia.direccion)
            : { pedido: null, motivo: 'llegó sin foto: no se puede leer el destinatario' }
        if (r.celular) base.celular = r.celular
        if (r.excluido) {
          excluidas.push({ ...base, motivo: r.motivo })
          if (!simular) await guardarFila(sb, { ...base, estado: 'EXCLUIDA', motivo: r.motivo, pedido_id: null, metodo: null, pedido_sugerido: null })
          continue
        }
        if (!r.pedido) {
          const sugerido = r.sugerido?.pedido_id || null
          pendientes.push({ ...base, motivo: r.motivo, pedido_sugerido: sugerido })
          if (!simular) await guardarFila(sb, { ...base, estado: 'PENDIENTE', motivo: r.motivo, pedido_id: null, metodo: null, pedido_sugerido: sugerido })
          continue
        }
        let estadoFinal = r.pedido.estado_pedido
        if (!simular) {
          estadoFinal = await escribirEnCrm(crm, {
            numero: guia.numero, pedidoId: r.pedido.pedido_id, fotoUrl: m.media_url, usuario: USUARIO_AUTO,
            notas: `Automático desde WhatsApp (reenvío ${m.telefono}, ${r.metodo}) · ${m.wa_message_id}`,
            fechaDespacho: base.fecha_guia || m.fecha,
            bitacora: textoBitacora({ numero: guia.numero, foto: m.media_url, fechaGuia: base.fecha_guia || m.fecha, destino: guia.destino, destinatario: base.destinatario, celular: base.celular, direccion: guia.direccion, metodo: r.metodo }),
          })
          await guardarFila(sb, { ...base, estado: 'REGISTRADA', motivo: r.nota || null, pedido_id: r.pedido.pedido_id, metodo: r.metodo, registrado_por: USUARIO_AUTO, pedido_sugerido: null })
        }
        registradas.push({ ...base, pedido_id: r.pedido.pedido_id, estado_pedido: estadoFinal, estado_antes: r.pedido.estado_pedido, nota: r.nota })
      } catch (e) {
        pendientes.push({ ...base, motivo: `error: ${e?.message || e}` })
      }
    }
  } finally {
    if (lector) await lector.terminate().catch(() => {})
  }

  return { simular, revisadas: candidatas.length, yaEstaban: registradasCrm.size, quedanParaOtraVuelta: quedan, registradas, pendientes, excluidas }
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
      estado: enC ? 'REGISTRADA' : (f.estado === 'PENDIENTE' || f.estado === 'EXCLUIDA' ? f.estado : 'NUEVA'),
      motivo: enC ? '' : (f.motivo || ''),
      nota: enC ? (f.motivo || '') : '',
      pedido_id: enC?.pedido_id || '',
      pedido_sugerido: enC ? '' : (f.pedido_sugerido || ''),
      registrado_por: enC?.registrado_por || '',
      registrado_en: enC?.fecha_despacho || '',
      metodo: enC ? (f.metodo || (enC.registrado_por === USUARIO_AUTO ? '' : 'crm')) : '',
      ...(enC ? clienteDe.get(enC.pedido_id) || {} : {}),
    }
  })
  return { dias: DIAS_ATRAS, guias }
}

/**
 * Buscar pedidos para asignar a mano. Sirve para dos cosas:
 *   · al abrir ✋ Asignar, con lo que se leyó de la guía (celular, destinatario,
 *     dirección) → propone candidatos sin que haya que escribir nada;
 *   · con lo que se escriba en el buscador: número de pedido, celular, cédula,
 *     nombre o un pedazo de dirección.
 * Cada dato trae candidatos POR SEPARADO y `puntuarCliente` los ordena por
 * cuántas pruebas reúnen (ver lib/guias-servientrega.js).
 */
export async function buscarPedidos({ q = '', celular = '', nombre = '', direccion = '' } = {}) {
  const crm = getSupabase().schema('crm')
  const COLS_PED = 'pedido_id, estado_pedido, fecha_pedido, monto_total, cliente_id'
  const texto = String(q || '').trim()
  const b = tipoDeBusqueda(texto)
  const entrada = { celulares: [], cedula: '', nombre: '', direccion: '' }
  if (texto) {
    if (b.tipo === 'numero') { entrada.celulares = [b.valor]; entrada.cedula = b.valor.length >= 10 ? b.valor.slice(0, 10) : '' }
    else if (b.tipo === 'texto') { entrada.nombre = texto; entrada.direccion = texto }
  } else {
    entrada.celulares = celular ? [celular] : []
    entrada.nombre = nombre
    entrada.direccion = direccion
  }

  // 1) Clientes candidatos, cada dato por su lado.
  const consultas = []
  const porCampo = (campo, patron, limite = 200) =>
    consultas.push(crm.from('clientes').select(COLS_CLIENTE).ilike(campo, patron).limit(limite)
      .then(({ data, error }) => { if (error) throw error; return data || [] }))
  // Nombre y dirección: regex sin tildes ni ñ (`patronSinTildes`), no `ilike` con comodines.
  const porRegex = (campo, regex, limite = 200) =>
    consultas.push(crm.from('clientes').select(COLS_CLIENTE).filter(campo, 'imatch', regex).limit(limite)
      .then(({ data, error }) => { if (error) throw error; return data || [] }))
  for (const c of entrada.celulares) {
    const t9 = tail9(c)
    if (t9.length < 9) continue
    porCampo('celular', `%${t9.slice(-4)}`, 300)   // un dígito cambiado al principio…
    porCampo('celular', `%${t9.slice(0, 5)}%`, 300) // …o al final
  }
  if (entrada.cedula) consultas.push(clientesPorCedula(crm, entrada.cedula))
  const palabrasNom = palabrasParaBuscar(entrada.nombre).sort((x, y) => y.length - x.length).slice(0, 3)
  for (const w of palabrasNom) porRegex('nombre', patronSinTildes(w))
  // Una sola palabra corta ("Ana") no pasa por palabrasParaBuscar (pide 4+ letras).
  const corto = b.tipo === 'texto' && texto.length >= 3 && !palabrasNom.length
  const cortas = corto ? sinTildes(texto).split(/[^a-z0-9]+/).filter(w => w.length >= 2).slice(0, 3) : []
  for (const w of cortas) porRegex('nombre', patronSinTildes(w, { palabraEntera: true }))
  for (const w of palabrasDireccionParaBuscar(entrada.direccion)) porRegex('direccion', patronSinTildes(w))

  const clientes = new Map()
  for (const lista of await Promise.all(consultas)) for (const c of lista) clientes.set(c.cliente_id, c)
  const puntuados = []
  for (const c of clientes.values()) {
    const p = puntuarCliente(c, entrada)
    if (p.puntos) puntuados.push({ c, ...p })
    else if (cortas.length) {
      const delCrm = sinTildes(c.nombre).split(/[^a-z0-9]+/)
      const n = cortas.filter(w => delCrm.includes(w)).length
      if (n) puntuados.push({ c, puntos: 5 * n, razones: [`👤 nombre ${n}/${cortas.length}`] })
    }
  }
  const mejores = puntuados.sort((x, y) => y.puntos - x.puntos).slice(0, 30)

  // 2) Sus pedidos (o el pedido escrito).
  let pedidos = []
  if (b.tipo === 'pedido' && texto) {
    const { data, error } = await crm.from('pedidos').select(`${COLS_PED}, clientes(${COLS_CLIENTE})`)
      .ilike('pedido_id', `%${texto}%`).order('fecha_pedido', { ascending: false }).limit(15)
    if (error) throw error
    pedidos = (data || []).map(p => ({ p, c: p.clientes || {}, puntos: 100, razones: ['🧾 pedido'] }))
  } else if (mejores.length) {
    const { data, error } = await crm.from('pedidos').select(COLS_PED)
      .in('cliente_id', mejores.map(m => m.c.cliente_id)).order('fecha_pedido', { ascending: false }).limit(300)
    if (error) throw error
    const de = new Map(mejores.map(m => [m.c.cliente_id, m]))
    pedidos = (data || []).map(p => ({ p, ...de.get(p.cliente_id) }))
  }

  const conGuia = await guiasDePedidos(crm, pedidos.map(x => x.p.pedido_id))
  const ahora = Date.now()
  return ordenarResultados(pedidos.map(({ p, c, puntos, razones }) => ({
    pedido_id: p.pedido_id, estado_pedido: p.estado_pedido, fecha_pedido: p.fecha_pedido,
    monto_total: p.monto_total, cliente: String(c?.nombre || '').trim(),
    celular: c?.celular || '', direccion: String(c?.direccion || '').replace(/\s+/g, ' ').trim().slice(0, 80),
    tiene_guia: conGuia.has(p.pedido_id), puede: puedeRecibirGuia(p, conGuia, ahora),
    puntos, razones,
  }))).slice(0, 20)
}

const sinTildes = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * Buscar una guía por su NÚMERO en todo el CRM (cualquier fecha, la haya
 * registrado el inbox o alguien a mano en el CRM). Acepta un pedazo del número.
 */
export async function buscarGuia(numero) {
  const d = String(numero || '').replace(/\D/g, '')
  if (d.length < 4) return []
  const crm = getSupabase().schema('crm')
  const { data, error } = await crm.from('guias_despacho')
    .select('numero_guia, pedido_id, transportista, fecha_despacho, registrado_por, foto_guia_url, pedidos(estado_pedido, clientes(nombre, celular))')
    .ilike('numero_guia', `%${d}%`).order('fecha_despacho', { ascending: false }).limit(10)
  if (error) throw error
  return (data || []).map(g => ({
    numero_guia: String(g.numero_guia || '').trim(), pedido_id: g.pedido_id, transportista: g.transportista || '',
    fecha_despacho: g.fecha_despacho, registrado_por: g.registrado_por || '', foto: /^https?:\/\//i.test(g.foto_guia_url || '') ? g.foto_guia_url : '',   // va a un href: nada de javascript:
    estado_pedido: g.pedidos?.estado_pedido || '', cliente: String(g.pedidos?.clientes?.nombre || '').trim(),
    celular: g.pedidos?.clientes?.celular || '',
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
  const { data: ped, error } = await crm.from('pedidos').select('pedido_id, clientes(nombre, celular)').eq('pedido_id', pedidoId).maybeSingle()
  if (error) throw error
  if (!ped) throw new Error(`No existe el pedido ${pedidoId}`)

  const quien = usuario || 'INBOX'
  const previa = (await filasGuardadas(sb, [numero])).get(numero) || {}
  // Excluidos (EXCLUIDOS_DE_GUIAS): tampoco a mano, ni por la guía ni por el pedido.
  const ex = excluidoDeGuias({ nombre: previa.destinatario, celulares: [previa.celular] })
    || excluidoDeGuias({ nombre: ped.clientes?.nombre, celulares: [ped.clientes?.celular] })
  if (ex || previa.estado === 'EXCLUIDA') throw new Error(`Las guías de ${ex || 'este cliente'} no se registran desde GUÍAS`)
  const fechaGuia = previa.fecha_guia || c.m.fecha
  const estado = await escribirEnCrm(crm, {
    numero, pedidoId, fotoUrl: c.m.media_url, usuario: quien,
    notas: `Asignada a mano desde el inbox (reenvío ${c.m.telefono}) · ${c.m.wa_message_id}`,
    fechaDespacho: fechaGuia,
    bitacora: textoBitacora({ numero, foto: c.m.media_url, fechaGuia, destino: c.guia.destino, destinatario: previa.destinatario, celular: previa.celular, direccion: c.guia.direccion, metodo: 'manual' }),
  })
  await guardarFila(sb, {
    numero_guia: numero, wa_message_id: c.m.wa_message_id, fecha_mensaje: c.m.fecha,
    media_url: c.m.media_url || '', destino: c.guia.destino, direccion: c.guia.direccion,
    destinatario: previa.destinatario || null, celular: previa.celular || null, fecha_guia: previa.fecha_guia || null,
    estado: 'REGISTRADA', motivo: null, pedido_id: pedidoId, metodo: 'manual', registrado_por: quien, pedido_sugerido: null,
  })
  return { ok: true, numero, pedidoId, estado }
}
