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
  const esHeader = (r) =>
    String(r[0]).toLowerCase() === 'id' ||
    ['texto', 'respuesta'].includes(String(r[1]).toLowerCase())
  return rows
    // Requiere solo el texto (col B) → lee filas agregadas a mano sin ID. Salta el header.
    .filter(r => r[1] && String(r[1]).trim() && !esHeader(r))
    .map((r, i) => ({
      id:       String(r[0] || '').trim() || `fila-${i + 2}`,
      text:     r[1] || '',
      imageUrl: r[2] || '',
    }))
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
