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
  return SB.getRespuestasSupabase()
}

export async function addRespuesta(id, texto, imagenUrl, extras = {}) {
  return SB.addRespuestaSupabase(id, texto, imagenUrl, extras)
}

export async function editRespuesta(id, texto, imagenUrl, extras = {}) {
  return SB.editRespuestaSupabase(id, texto, imagenUrl, extras)
}

export async function deleteRespuesta(id) {
  return SB.deleteRespuestaSupabase(id)
}
