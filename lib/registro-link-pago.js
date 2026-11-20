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

// ── Aviso de Payphone (notificación externa) → link PAGADO (19-nov-2026) ─────
// Cuando Payphone avisa un pago aprobado, el link queda PAGADO en crm.links_pago
// para que el REPORTE DE PAGOS del CRM lo vea sin esperar a CONSULTAR.

// ☠️ Payphone manda la fecha SIN zona ("2026-11-16T18:06:56") y es hora de
// Ecuador: leída tal cual en Vercel (UTC) quedaría 5 horas antes.
export function fechaPayphone(f) {
  if (!f) return new Date().toISOString()
  const s = String(f)
  const conZona = /[zZ]|[+-]\d{2}:?\d{2}$/.test(s)
  const d = new Date(conZona ? s : `${s}-05:00`)
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
}

/** Lo que se escribe en la fila del link a partir de la venta de Payphone (pura). */
export function cambioLinkPagado(t, ahora = new Date()) {
  return {
    estado: 'PAGADO',
    transaction_id: t?.transactionId != null ? String(t.transactionId) : null,
    tarjeta: t?.cardBrand || null,
    pagado_en: fechaPayphone(t?.date),
    revisado_en: ahora.toISOString(),
  }
}

/**
 * Marca PAGADO el link de esta venta (por su clientTransactionId). Solo toca
 * links que todavía no estén PAGADO (no pisa la fecha del primer aviso).
 * Devuelve cuántas filas cambió; nunca lanza.
 */
export async function marcarLinkPagado(t) {
  const ctx = String(t?.clientTransactionId || '')
  if (!ctx) return 0
  try {
    const { getSupabase } = await import('./supabase.js')
    const { data, error } = await getSupabase().schema('crm').from('links_pago')
      .update(cambioLinkPagado(t))
      .eq('proveedor', 'PAYPHONE')
      .eq('client_tx_id', ctx)
      .neq('estado', 'PAGADO')
      .select('id')
    if (error) throw new Error(error.message)
    return (data || []).length
  } catch (e) {
    console.error('[registro-link-pago] no se marcó PAGADO', ctx, e.message)
    return 0
  }
}
