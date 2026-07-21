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
  return SB.getMensajesSupabase(3000)
}

// HISTORIAL COMPLETO de un chat (bajo demanda al abrirlo). La lista lateral solo
// trae el último mensaje de cada conversación; sin esto un chat viejo se vería con
// una sola burbuja (el síntoma de "se borraron los mensajes").
export async function getHilo(telefono, limite = 800) {
  return SB.getHiloSupabase(telefono, limite)
}

// Lista lateral: ÚLTIMO mensaje de cada conversación, sobre TODO el historial.
export async function getLista() {
  return SB.getListaSupabase()
}

// Búsqueda de texto en TODO el historial (server-side en Supabase).
export async function buscarMensajes(q, limite = 300) {
  return SB.buscarMensajesSupabase(q, limite)
}

// Busca UN mensaje por su wamid — sirve para resolver mensajes citados que quedaron
// fuera de la ventana de getMensajes() (últimas 3000).
export async function getMensajeById(id) {
  return SB.getMensajeByIdSupabase(id)
}
