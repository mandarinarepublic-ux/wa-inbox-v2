// lib/linkpago.js — Un solo punto para crear links de pago, con el proveedor que
// se elija: dLocal Go o Payphone.
//
//   - Panel Ventas: el vendedor elige en el selector (dLocal / Payphone).
//   - LINKPAGO<monto> escrito en el chat (WhatsApp, FB, IG): usa
//     LINKPAGO_PROVEEDOR. Sin esa variable sigue siendo dLocal, así que
//     desplegar esto no cambia nada hasta que alguien elija Payphone.
import { crearLinkPago as crearLinkDlocal } from './dlocal.js'
import { crearLinkPayphone } from './payphone.js'

// Local y no importado de supabase.js: así este archivo se prueba sin cargar
// el cliente de la base.
const soloDigitos = (s) => String(s || '').replace(/\D/g, '')

export const PROVEEDORES = ['dlocal', 'payphone']

/** 'dlocal' | 'payphone', o null si no es ninguno de los dos. */
export function normalizarProveedor(p) {
  const v = String(p || '').replace(/[^\x21-\x7E]/g, '').toLowerCase()
  return PROVEEDORES.includes(v) ? v : null
}

/** El proveedor del LINKPAGO escrito en el chat. */
export function proveedorPorDefecto() {
  return normalizarProveedor(process.env.LINKPAGO_PROVEEDOR) || 'dlocal'
}

/**
 * Crea el link y devuelve la URL de pago.
 * `ref` es lo que identifica el link: el teléfono del cliente (WhatsApp) o una
 * etiqueta como "SOCIAL" cuando no hay teléfono.
 */
export async function crearLink(proveedor, monto, ref) {
  const p = normalizarProveedor(proveedor) || proveedorPorDefecto()
  if (p === 'payphone') return crearLinkPayphone(monto, soloDigitos(ref))
  // dLocal: mismo order_id de siempre ("<telefono>-<timestamp>"), que es de
  // donde /api/pago-dlocal saca a quién avisar.
  const base = soloDigitos(ref) || String(ref || 'LINK')
  return crearLinkDlocal(monto, `${base}-${Date.now()}`)
}
