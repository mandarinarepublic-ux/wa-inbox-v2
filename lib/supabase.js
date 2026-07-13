// lib/supabase.js — cliente Supabase para el inbox (schema `inbox`), SOLO server-side.
// Usa la service_role key (ignora RLS). NUNCA importar en el navegador.
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

// Cuenta fija de este inbox (MANDI). IND usa 'IND'.
export const CUENTA = process.env.INBOX_CUENTA || 'MANDI'

// Backend de datos: 'sheets' (default) | 'supabase' | 'dual'.
// - sheets:   lee/escribe Sheets (hoy).
// - dual:     escribe a AMBOS (Sheets manda), lee de Sheets → para validar.
// - supabase: lee/escribe Supabase (Sheets queda de respaldo por dual-write inverso).
export const DATA_BACKEND = process.env.DATA_BACKEND || 'sheets'
export const usaSupabaseLectura = () => DATA_BACKEND === 'supabase'
export const escribeSupabase = () => DATA_BACKEND === 'supabase' || DATA_BACKEND === 'dual'
export const escribeSheets = () => DATA_BACKEND === 'sheets' || DATA_BACKEND === 'dual'

let _client = null
export function getSupabase() {
  if (_client) return _client
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase no configurado: falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY')
  }
  _client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    db: { schema: 'inbox' },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return _client
}

export function supabaseConfigurado() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
}

/** Teléfono normalizado a solo dígitos (para matching/dedup). */
export const soloDigitos = (s) => String(s || '').replace(/\D/g, '')

/**
 * Teléfono CANÓNICO para la PK de conversaciones (evita duplicados por formato).
 * '0987654321' / '987654321' / '593987654321' → '593987654321' (Ecuador).
 */
export function canonTel(s) {
  let d = soloDigitos(s).replace(/^0+/, '')
  if (!d) return ''
  if (!d.startsWith('593') && d.length <= 10) d = '593' + d
  return d
}

// ─── Dispatchers dual-write / lectura ────────────────────────────────────────

/** Escritura espejo best-effort: no bloquea ni rompe la operación del usuario. */
export function mirror(fn, label = 'mirror') {
  Promise.resolve()
    .then(fn)
    .catch((e) => console.warn(`[inbox:${label}] espejo falló:`, e?.message || e))
}

/**
 * Escritura respetando DATA_BACKEND:
 * - 'sheets'   → solo Sheets.
 * - 'dual'     → Sheets (primaria, await) + Supabase (espejo best-effort).
 * - 'supabase' → Supabase (primaria, await) + Sheets (espejo best-effort de respaldo).
 */
export async function dualWrite(sheetsFn, supabaseFn, label = 'write') {
  if (DATA_BACKEND === 'supabase') {
    const r = await supabaseFn()
    mirror(sheetsFn, `${label}:sheets`)
    return r
  }
  const r = await sheetsFn()
  if (DATA_BACKEND === 'dual') mirror(supabaseFn, `${label}:supabase`)
  return r
}

/** Lectura: Supabase si DATA_BACKEND='supabase', si no Sheets. */
export async function dualRead(sheetsFn, supabaseFn) {
  return DATA_BACKEND === 'supabase' ? supabaseFn() : sheetsFn()
}
