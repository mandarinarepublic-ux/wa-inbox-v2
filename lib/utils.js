// ── AVATAR COLORS ────────────────────────────────────────────────
const COLORS = [
  '#10b981','#f59e0b','#6366f1','#ef4444',
  '#8b5cf6','#ec4899','#14b8a6','#f97316',
  '#3b82f6','#84cc16',
]

export const colorFor   = (phone) => COLORS[parseInt(phone.slice(-2) || '0') % COLORS.length]
export const initialsFor = (name)  => name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()

// ── DATE FORMATTING ──────────────────────────────────────────────
// Parsea tanto ISO (2026-06-09T...) como DD/MM/YYYY HH:mm
function parseDate(val) {
  if (!val) return new Date(NaN)
  // Formato DD/MM/YYYY HH:mm
  const m = String(val).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})/)
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5])
  // ISO u otros formatos nativos
  return new Date(val)
}

export function fmtTime(iso) {
  if (!iso) return ''
  const d    = parseDate(iso)
  const now  = new Date()
  const diff = (now - d) / 86_400_000
  if (diff < 1) return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
  if (diff < 2) return 'Ayer'
  if (diff < 7) return d.toLocaleDateString('es-MX', { weekday: 'short' })
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })
}

export function fmtDate(iso) {
  return parseDate(iso).toLocaleDateString('es-MX', {
    weekday: 'long', day: 'numeric', month: 'long',
  })
}

// ── BUILD CONVERSATIONS FROM FLAT ROWS ───────────────────────────
/**
 * Agrupa filas del Sheet en conversaciones por número de teléfono.
 * Devuelve array ordenado por último mensaje (más reciente primero).
 */
export function buildConvs(rows) {
  const map = {}

  rows.forEach(row => {
    const p = row.telefono
    if (!map[p]) map[p] = { telefono: p, nombre: row.nombre, msgs: [] }
    // Evitar duplicados por id
    if (!map[p].msgs.find(m => m.id === row.id)) {
      map[p].msgs.push(row)
    }
  })

  return Object.values(map)
    .map(conv => {
      const sorted = [...conv.msgs].sort(
        (a, b) => parseDate(a.timestamp) - parseDate(b.timestamp)
      )
      const last   = sorted[sorted.length - 1]
      const unread = sorted.filter(
        m => m.direccion === 'ENTRANTE' && m.estado === 'recibido'
      ).length
      return { ...conv, msgs: sorted, last, unread }
    })
    .sort((a, b) => parseDate(b.last.timestamp) - parseDate(a.last.timestamp))
}
