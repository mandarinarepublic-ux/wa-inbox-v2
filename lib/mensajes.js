import { readSheetTail, findRowByValue } from './sheets.js'

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
    respuestaIA:    row[9] || '',
    imagenProducto: row[10] || '',
    contextoId:     row[11] || '',
  }
}

export async function getMensajes() {
  // Leer últimas 3000 filas — suficiente para historial reciente
  // evita el límite de Google Sheets API en hojas con 10k+ filas
  const rows = await readSheetTail('MENSAJES', 3000)
  return rows
    .filter(r => r[1] && r[1] !== 'Telefono') // saltar header si aparece
    .map(mapMensajeRow)
}

// Busca UN mensaje por su wamid (columna A) en TODA la hoja — sirve para resolver
// mensajes citados que quedaron fuera de la ventana de getMensajes() (últimas 3000).
export async function getMensajeById(id) {
  const found = await findRowByValue('MENSAJES', 0, id)
  if (!found) return null
  return mapMensajeRow(found.values)
}
