// lib/linkpago.js — Un solo punto para crear links de pago, con el proveedor que
// se elija: dLocal Go o Payphone.
//
//   - Panel Ventas: el vendedor elige en el selector (dLocal / Payphone).
//   - LINKPAGO<monto> escrito en el chat (WhatsApp, FB, IG): usa
//     LINKPAGO_PROVEEDOR. Sin esa variable sigue siendo dLocal, así que
//     desplegar esto no cambia nada hasta que alguien elija Payphone.
import { crearLinkPagoConId as crearLinkDlocal } from './dlocal.js'
import { crearLinkPayphoneConId } from './payphone.js'
import { registrarLinkPago } from './registro-link-pago.js'

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
export async function crearLink(proveedor, monto, ref, quien = {}) {
  const p = normalizarProveedor(proveedor) || proveedorPorDefecto()
  const telefono = soloDigitos(ref)
  // Cada link queda anotado en crm.links_pago para el REPORTE DE PAGOS del CRM
  // (13-nov-2026). `quien` = { usuarioId } del vendedor, si lo hay; un LINKPAGO
  // que escribe el propio cliente no tiene vendedor.
  if (p === 'payphone') {
    const r = await crearLinkPayphoneConId(monto, telefono)
    await registrarLinkPago({ proveedor: p, monto, link: r.link, clientTxId: r.clientTransactionId, telefono, usuarioId: quien?.usuarioId })
    return r.link
  }
  // dLocal: mismo order_id de siempre ("<telefono>-<timestamp>"), que es de
  // donde /api/pago-dlocal saca a quién avisar.
  const base = telefono || String(ref || 'LINK')
  const r = await crearLinkDlocal(monto, `${base}-${Date.now()}`)
  await registrarLinkPago({ proveedor: p, monto, link: r.link, clientTxId: r.orderId, externoId: r.id, telefono, usuarioId: quien?.usuarioId })
  return r.link
}
