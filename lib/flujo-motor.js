// lib/flujo-motor.js — FLUJOS Fase B: correr UNA tanda de un flujo para un cliente.
// Lo llaman el webhook (al disparar y al avanzar con un entrante) y el cron
// /api/cron/flujos (esperas vencidas). Es el ÚNICO sitio que manda piezas de un
// flujo y escribe inbox.flujo_estado. Todo lo que toca red o base entra por
// `deps`, para poder probarlo sin ninguna de las dos (tests/flujo-motor.test.js).
//
// Orden FIJO dentro de una tanda: caminar → guardar/borrar el estado → registrar
// pasos → temperatura → mandar. El estado va ANTES del envío: si el cliente toca
// el botón mientras todavía estamos mandando las fotos, su entrante ya encuentra
// dónde está parado.
import { avanzarDesde, evaluarCondicion, paradaDeCamino, citaDeTanda, piezasDeNodos, temperaturaAlPasar } from './flujo.js'
import { esc } from './recetas.js'

/** PURO: la parada que devuelve paradaDeCamino → fila de inbox.flujo_estado. */
export function filaDeEstado(telefono, parada, { flujo_id, ultimoWamid = '' }) {
  return {
    telefono: String(telefono || ''),
    flujo_id,
    nodo_id: parada.nodoId,
    esperando: parada.esperando,
    puerto_tiempo: parada.puertoTiempo || null,
    vence_at: parada.venceAt,
    ultimo_wamid: ultimoWamid || '',
  }
}

/**
 * deps = { enviar(pieza)→{ok,status?}, guardarEstado(fila), borrarEstado(tel),
 *          registrarPasos({telefono, flujo_id, nodoIds}), setTemperatura(tel, temp),
 *          avisar(textoHtml), ahora()→Date, cuenta?, log? }
 * contacto = { telefono, nombre, alias, phoneId, temperatura, tieneVenta, estado, ultimoEntranteAt }
 * desde = { nodoId, puerto, saltarEsperaInicial? }
 */
export async function correrTanda(deps, { flujo, desde, esDisparo, contacto, wamidEntrante = '', ultimoWamid = '', respuestas = [] }) {
  const { enviar, guardarEstado, borrarEstado, registrarPasos, setTemperatura, avisar, ahora, cuenta = '', log = console.log } = deps
  const ctx = {
    temperatura: contacto?.temperatura || '', tieneVenta: !!contacto?.tieneVenta,
    estado: contacto?.estado || '', ahora: ahora(),
  }
  const camino = avanzarDesde(flujo?.grafo_vivo, {
    nodoId: desde?.nodoId, puerto: desde?.puerto, saltarEsperaInicial: !!desde?.saltarEsperaInicial,
    evaluar: (nodo) => evaluarCondicion(nodo, ctx),
  })

  const piezas = piezasDeNodos({
    nodos: camino.mensajes, respuestas,
    contacto: { telefono: contacto.telefono, nombre: contacto.nombre, alias: contacto.alias || '', phoneId: contacto.phoneId },
    citaId: citaDeTanda({ nodos: camino.mensajes, esDisparo, wamidEntrante, ultimoWamid }),
  })

  if (camino.motivo === 'huerfano') {
    log('[flujo]', flujo?.nombre, 'camino roto en', camino.detenidoEn, '→ se corta (el chat sigue en Pendientes)')
  }
  const parada = camino.motivo === 'huerfano' ? null : paradaDeCamino(camino, { ahora: ahora(), ultimoEntranteAt: contacto?.ultimoEntranteAt || null })

  // 1) estado: si el camino se detuvo en algo que espera → guardar; si terminó
  //    (fin o roto) → borrar. Nunca se deja un estado viejo colgado.
  if (parada) {
    await guardarEstado(filaDeEstado(contacto.telefono, parada, { flujo_id: flujo.flujo_id, ultimoWamid: wamidEntrante || ultimoWamid }))
  } else {
    await borrarEstado(contacto.telefono)
  }
  // 2) bitácora (contadores por nodo). Un fallo acá no frena la tanda.
  await Promise.resolve()
    .then(() => registrarPasos({ telefono: contacto.telefono, flujo_id: flujo.flujo_id, nodoIds: camino.visitados }))
    .catch((e) => log('[flujo] pasos:', e.message))
  // 3) temperatura del nodo ("si llegas hasta acá eres 🔥")
  const temp = temperaturaAlPasar(camino.mensajes)
  if (temp) {
    await Promise.resolve().then(() => setTemperatura(contacto.telefono, temp)).catch((e) => log('[flujo] temperatura:', e.message))
  }
  // 4) mandar, en orden
  let salieron = 0
  for (const p of piezas) {
    const r = await enviar(p)
    if (r?.ok) salieron++
    else log('[flujo]', flujo?.nombre, 'pieza rechazada', r?.status ?? 'red', contacto.telefono)
  }
  log('[flujo]', flujo?.nombre, 'a', contacto.telefono, `${salieron}/${piezas.length} piezas`, `(${camino.motivo})`)
  if (piezas.length && salieron === 0) {
    await Promise.resolve().then(() => avisar(
      `⚠️ <b>Flujo sin enviar${cuenta ? ` en ${esc(cuenta)}` : ''}</b>\n` +
      `flujo ${esc(flujo?.nombre || '')} a ${esc(contacto.telefono)}: 0/${piezas.length} piezas salieron. ` +
      'Revisa /api/saliente en los logs de Vercel.'
    )).catch(() => {})
  }
  return { camino, piezas, parada, salieron }
}
