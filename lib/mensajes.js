import { readMensajesTail, readMensajesFull } from './cache.js'
import { hashWamid } from './utils.js'

// Columnas MENSAJES:
// A=ID B=Telefono C=Nombre D=Tipo E=Contenido F=MediaURL G=Fecha H=Direccion
// I=MediaID J=RespuestaIA K=FotoIA L=ContextoID

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
  }
}

export async function getMensajes() {
  // Leer últimas 3000 filas — suficiente para historial reciente
  // evita el límite de Google Sheets API en hojas con 10k+ filas.
  // Cacheado 8s (readMensajesTail): una lectura por ventana sirve a todas las pestañas.
  const rows = await readMensajesTail(3000)
  return rows
    // Requiere un teléfono VÁLIDO (≥9 dígitos): salta el header y filas con telefono
    // "0"/vacío que generan chats fantasma (ej. "Rodrigo +0").
    .filter(r => r[1] && r[1] !== 'Telefono' && String(r[1]).replace(/\D/g, '').length >= 9)
    .map(mapMensajeRow)
    // Descarta mensajes de sistema de WhatsApp (avisos, cambios de número) y filas
    // vacías (sin texto ni media) → evitan "chats fantasma" que ni están en CONTACTOS.
    .filter(m => String(m.tipo).toLowerCase() !== 'system' && (String(m.mensaje).trim() || String(m.mediaUrl).trim()))
}

// Busca UN mensaje por su wamid (columna A) en TODA la hoja — sirve para resolver
// mensajes citados que quedaron fuera de la ventana de getMensajes() (últimas 3000).
export async function getMensajeById(id) {
  // Match por HASH del wamid: el context.id (col L) y el id guardado (col A) del mismo
  // mensaje tienen distinto envoltorio pero el mismo hash interno.
  const objetivo = hashWamid(id)
  const rows = await readMensajesFull()
  for (const r of rows) {
    if (!r[0] || r[1] === 'Telefono') continue
    if (hashWamid(r[0]) === objetivo) return mapMensajeRow(r)
  }
  return null
}
