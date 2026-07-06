import { readSheet, appendRow, findRowByValue, updateRow, updateCell } from './sheets.js'

// Columnas RESPUESTAS_RAPIDAS: A=ID B=Texto C=ImagenURL

export function mapRespuestaRow(row) {
  return {
    id:       String(row[0] || ''),
    text:     row[1] || '',
    imageUrl: row[2] || '',
  }
}

export async function getRespuestas() {
  const rows = await readSheet('RESPUESTAS_RAPIDAS')
  return rows
    .filter(r => r[0] && r[1])
    .map(mapRespuestaRow)
}

export async function addRespuesta(id, texto, imagenUrl) {
  await appendRow('RESPUESTAS_RAPIDAS', [id, texto, imagenUrl || ''])
  return { ok: true }
}

export async function editRespuesta(id, texto, imagenUrl) {
  const found = await findRowByValue('RESPUESTAS_RAPIDAS', 0, id)
  if (!found) throw new Error(`Respuesta no encontrada: ${id}`)
  await updateRow('RESPUESTAS_RAPIDAS', found.rowNumber, [id, texto, imagenUrl || ''])
  return { ok: true }
}

export async function deleteRespuesta(id) {
  const found = await findRowByValue('RESPUESTAS_RAPIDAS', 0, id)
  if (!found) throw new Error(`Respuesta no encontrada: ${id}`)
  // "Eliminar" = vaciar las celdas B y C, dejar ID para no correr filas
  await updateRow('RESPUESTAS_RAPIDAS', found.rowNumber, [id, '', ''])
  return { ok: true }
}
