// lib/registro-link-pago.js — Registra cada link de pago en crm.links_pago (13-nov-2026).
//
// El CRM tiene el REPORTE DE PAGOS (solo ADMIN, /dashboard/reporte-pagos) que
// dice si los links se pagaron. Payphone NO deja listar links: si un link no
// quedó registrado con su clientTransactionId, nadie puede preguntar después
// si lo pagaron. Por eso cada link que sale de este inbox se anota acá.
//
// Nunca lanza: el link ya existe en la pasarela y el vendedor tiene que poder
// mandarlo igual. Si no se registra queda en el log de Vercel. Un link de dLocal
// igual aparece en el reporte (el CRM lee la lista de pagos de dLocal); uno de
// Payphone NO, y por eso hay que registrarlo.

export const ORIGEN = 'INBOX_MANDI'
export const TIENDA = 'MANDARINA'

const soloDigitos = (s) => String(s || '').replace(/\D/g, '')

/** La fila a insertar (pura, se prueba sin red). */
export function filaRegistroLink({ proveedor, monto, link, clientTxId, externoId, telefono, usuarioId, usuarioNombre }) {
  return {
    proveedor: proveedor === 'payphone' ? 'PAYPHONE' : 'DLOCAL',
    origen: ORIGEN,
    tienda: TIENDA,
    vendedor_id: usuarioId ? String(usuarioId) : null,
    vendedor_nombre: usuarioNombre || null,
    celular: soloDigitos(telefono),
    valor: Math.round(Number(monto) * 100) / 100,
    link: String(link || ''),
    client_tx_id: String(clientTxId || ''),
    externo_id: externoId || null,
  }
}

/** Inserta el registro. Devuelve true/false; nunca lanza. */
export async function registrarLinkPago(datos) {
  try {
    const fila = filaRegistroLink(datos)
    if (!fila.client_tx_id || !fila.link) return false
    // Import perezoso: lib/linkpago.js se prueba sin cargar el cliente de la base.
    const { getSupabase } = await import('./supabase.js')
    const crm = getSupabase().schema('crm')
    if (fila.vendedor_id && !fila.vendedor_nombre) {
      const { data } = await crm.from('usuarios').select('nombre').eq('usuario_id', fila.vendedor_id).maybeSingle()
      fila.vendedor_nombre = data?.nombre || null
    }
    const { error } = await crm.from('links_pago').insert(fila)
    if (error) throw new Error(error.message)
    return true
  } catch (e) {
    console.error('[registro-link-pago] no se registró el link', datos?.clientTxId, e.message)
    return false
  }
}
