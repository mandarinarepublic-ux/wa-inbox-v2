import { readSheet, appendRow, findRowByValue, updateRow, updateCell } from './sheets.js'
import { readRespuestas } from './cache.js'
import { revalidateTag } from 'next/cache'
import { dualRead, dualWrite } from './supabase.js'
import * as SB from './inbox-supabase.js'

// Columnas RESPUESTAS_RAPIDAS: A=ID B=Texto C-L=ImagenURL 1..10 M=Botones
const MAX_IMGS = 10

export function mapRespuestaRow(row, i = 0) {
  const obj = {
    id:       String(row[0] || '').trim() || `fila-${i + 2}`,
    text:     row[1] || '',
    imageUrl: row[2] || '',
  }
  // imageUrl2..imageUrl10 → columnas D..L (índices 3..11)
  for (let k = 2; k <= MAX_IMGS; k++) obj[`imageUrl${k}`] = row[k + 1] || ''
  // Botones interactivos (col M, índice 12): títulos separados por '|' (máx 3)
  obj.botones = String(row[12] || '').split('|').map(s => s.trim()).filter(Boolean).slice(0, 3)
  return obj
}

export async function getRespuestas() {
  return dualRead(
    async () => {
      // Cacheado 30s (readRespuestas): las respuestas rápidas cambian muy poco.
      const rows = await readRespuestas()
      const esHeader = (r) =>
        String(r[0]).toLowerCase() === 'id' ||
        ['texto', 'respuesta'].includes(String(r[1]).toLowerCase())
      return rows
        .filter(r => r[1] && String(r[1]).trim() && !esHeader(r))
        .map((r, i) => mapRespuestaRow(r, i))
    },
    () => SB.getRespuestasSupabase(),
  )
}

// Construye la fila: [id, texto, img1..img10, botones]
function buildRow(id, texto, imagenUrl, extras = {}) {
  const row = [id, texto, imagenUrl || '']
  for (let k = 2; k <= MAX_IMGS; k++) row.push(extras[`imagenUrl${k}`] || '')
  // Col M: botones (títulos separados por '|')
  const botones = Array.isArray(extras.botones) ? extras.botones : (extras.botones ? String(extras.botones).split('|') : [])
  row.push(botones.map(s => String(s).trim()).filter(Boolean).slice(0, 3).join('|'))
  return row
}

export async function addRespuesta(id, texto, imagenUrl, extras = {}) {
  return dualWrite(
    async () => {
      await appendRow('RESPUESTAS_RAPIDAS', buildRow(id, texto, imagenUrl, extras))
      revalidateTag('respuestas')
      return { ok: true }
    },
    () => SB.addRespuestaSupabase(id, texto, imagenUrl, extras),
    'respuesta.add',
  )
}

export async function editRespuesta(id, texto, imagenUrl, extras = {}) {
  return dualWrite(
    async () => {
      const found = await findRowByValue('RESPUESTAS_RAPIDAS', 0, id)
      if (!found) throw new Error(`Respuesta no encontrada: ${id}`)
      await updateRow('RESPUESTAS_RAPIDAS', found.rowNumber, buildRow(id, texto, imagenUrl, extras))
      revalidateTag('respuestas')
      return { ok: true }
    },
    () => SB.editRespuestaSupabase(id, texto, imagenUrl, extras),
    'respuesta.edit',
  )
}

export async function deleteRespuesta(id) {
  return dualWrite(
    async () => {
      const found = await findRowByValue('RESPUESTAS_RAPIDAS', 0, id)
      if (!found) throw new Error(`Respuesta no encontrada: ${id}`)
      // "Eliminar" = vaciar B..L, dejar ID para no correr filas
      await updateRow('RESPUESTAS_RAPIDAS', found.rowNumber, buildRow(id, '', '', {}))
      revalidateTag('respuestas')
      return { ok: true }
    },
    () => SB.deleteRespuestaSupabase(id),
    'respuesta.delete',
  )
}
