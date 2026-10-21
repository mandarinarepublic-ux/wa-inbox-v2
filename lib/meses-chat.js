// lib/meses-chat.js — el hilo de un chat partido por MES, con los meses viejos plegados.
//
// Pedido de Rodrigo (20-oct-2026): hay chats con meses de historia (el suyo, sobre
// todo) y para llegar a lo de hoy había que atravesarlo todo. El mes en curso va
// siempre abierto; cada mes anterior queda como una línea "Mostrar septiembre 2026 ·
// 34 mensajes" que se abre con un clic.
//
// ⚠️ Si el cliente no escribió este mes, el ÚLTIMO mes con mensajes también va
// abierto: si no, el chat se abriría vacío, todo plegado, y parecería que se
// borraron los mensajes (el mismo susto de la ventana de 3000).

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** 'AAAA-MM' de una fecha (hora local del navegador, igual que los separadores de día). */
export function claveMes(d) {
  if (!(d instanceof Date) || isNaN(d)) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** 'septiembre 2026' a partir de 'AAAA-MM'. */
export function nombreMes(clave) {
  const [a, m] = String(clave).split('-')
  const nombre = MESES[Number(m) - 1]
  return nombre ? `${nombre} ${a}` : 'sin fecha'
}

/**
 * Parte `msgs` (ya ordenados del más viejo al más nuevo) en tramos por mes.
 * Devuelve [{ clave, nombre, msgs, siempreAbierto }] en el mismo orden.
 *
 * Un mensaje sin fecha legible se queda en el tramo del mensaje anterior: nunca se
 * esconde en un tramo propio ni se pierde (sin dato NO significa sin fila).
 */
export function tramosPorMes(msgs, fechaDe, ahora = new Date()) {
  const tramos = []
  for (const m of msgs || []) {
    const clave = claveMes(fechaDe(m)) || tramos[tramos.length - 1]?.clave || ''
    const ultimo = tramos[tramos.length - 1]
    if (ultimo && ultimo.clave === clave) ultimo.msgs.push(m)
    else tramos.push({ clave, nombre: nombreMes(clave), msgs: [m], siempreAbierto: false })
  }
  const actual = claveMes(ahora)
  tramos.forEach((t, i) => {
    t.siempreAbierto = t.clave === actual || i === tramos.length - 1 || !t.clave
  })
  return tramos
}
