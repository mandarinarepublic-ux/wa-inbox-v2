import { readMensajesTail, readMensajesFull } from './cache.js'
import { hashWamid } from './utils.js'
import { dualRead } from './supabase.js'
import * as SB from './inbox-supabase.js'

// Columnas MENSAJES:
// A=ID B=Telefono C=Nombre D=Tipo E=Contenido F=MediaURL G=Fecha H=Direccion
// I=MediaID J=RespuestaIA K=FotoIA L=ContextoID M=Botones (JSON [{id,title}])

export function mapMensajeRow(row) {
  return {
    id:             row[0] || '',
    telefono:       String(row[1] || ''),
    nombre:         row[2] || String(row[1] || '') || 'Sin nombre',
    tipo:           row[3] || 'texto',
    mensaje:        row[4] || '',
    mediaUrl:       row[5] || '',
    timestamp:      row[6] || '',
    direccion:      row[7] || 'ENTRANTE',
    mediaId:        row[8] || '',   // col I — sirve para el proxy /api/media (no caduca)
    respuestaIA:    row[9] || '',
    imagenProducto: row[10] || '',
    contextoId:     row[11] || '',
    botones:        row[12] || '',  // col M — botones interactivos que enviamos (JSON)
  }
}

export async function getMensajes() {
  return dualRead(
    async () => {
      // Leer últimas 3000 filas — suficiente para historial reciente.
      // Cacheado 8s (readMensajesTail): una lectura por ventana sirve a todas las pestañas.
      const rows = await readMensajesTail(3000)
      return rows
        .filter(r => r[1] && r[1] !== 'Telefono' && String(r[1]).replace(/\D/g, '').length >= 9)
        .map(mapMensajeRow)
        .filter(m => String(m.tipo).toLowerCase() !== 'system' && (String(m.mensaje).trim() || String(m.mediaUrl).trim() || String(m.mediaId).trim() || String(m.botones).trim()))
    },
    () => SB.getMensajesSupabase(3000),
  )
}

const soloDig = (v) => String(v || '').replace(/\D/g, '')

// HISTORIAL COMPLETO de un chat (bajo demanda al abrirlo). La lista lateral solo
// trae el último mensaje de cada conversación; sin esto un chat viejo se vería con
// una sola burbuja (el síntoma de "se borraron los mensajes").
export async function getHilo(telefono, limite = 800) {
  return dualRead(
    async () => {
      const t9 = soloDig(telefono).slice(-9)
      if (t9.length < 9) return []
      const todos = await getMensajes()
      return todos.filter(m => soloDig(m.telefono).slice(-9) === t9).slice(-limite)
    },
    () => SB.getHiloSupabase(telefono, limite),
  )
}

// Lista lateral: ÚLTIMO mensaje de cada conversación, sobre TODO el historial.
// Reemplaza al armado desde la ventana global de 3000, que ocultaba los chats viejos.
export async function getLista() {
  return dualRead(
    async () => {
      const todos = await getMensajes()
      const ultimo = {}
      todos.forEach(m => { ultimo[m.telefono] = m }) // getMensajes viene en orden asc
      return Object.values(ultimo)
    },
    () => SB.getListaSupabase(),
  )
}

// Búsqueda de texto en TODO el historial (server-side en Supabase).
export async function buscarMensajes(q, limite = 300) {
  return dualRead(
    async () => {
      const term = String(q || '').trim().toLowerCase()
      if (term.length < 2) return []
      const todos = await getMensajes()
      return todos.filter(m => String(m.mensaje || '').toLowerCase().includes(term)).slice(-limite)
    },
    () => SB.buscarMensajesSupabase(q, limite),
  )
}

// Busca UN mensaje por su wamid (columna A) en TODA la hoja — sirve para resolver
// mensajes citados que quedaron fuera de la ventana de getMensajes() (últimas 3000).
export async function getMensajeById(id) {
  return dualRead(
    async () => {
      // Match por HASH del wamid: el context.id (col L) y el id guardado (col A) del
      // mismo mensaje tienen distinto envoltorio pero el mismo hash interno.
      const objetivo = hashWamid(id)
      const rows = await readMensajesFull()
      for (const r of rows) {
        if (!r[0] || r[1] === 'Telefono') continue
        if (hashWamid(r[0]) === objetivo) return mapMensajeRow(r)
      }
      return null
    },
    () => SB.getMensajeByIdSupabase(id),
  )
}
