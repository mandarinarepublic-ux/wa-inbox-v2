// lib/entregas-fallidas.js — avisar cuando un mensaje NO le llegó al cliente.
//
// ⚠️ POR QUÉ EXISTE, con números: en agosto murieron 9 mensajes sin que nadie se
// enterara. Tres el 19-ago y seis el 16-ago, todos rechazados por Meta con 131047
// ("más de 24 h desde que el cliente respondió a ESTE número"). El vendedor los vio
// salir, con su ✓ y todo, y el cliente nunca los recibió.
//
// Lo único que lo decía era un `⚠` rojo de 11 píxeles al lado de la hora, con el
// motivo escondido en un `title=` — o sea invisible al tacto en un celular. Es la
// misma trampa del bug de push de julio, que estuvo 17 días roto porque el aviso
// solo se veía en la PC.
//
// Este chequeo se pidió por escrito el 29-jul y no se hizo. Los 9 mensajes de
// agosto se encontraron por casualidad, revisando otra cosa.
//
// La regla del proyecto que esto sostiene: **un camino que tiene que ser visible
// hay que forzarlo a fallar y comprobar que se ve.** Un tablero en blanco se ve
// exactamente igual que un tablero sano.

/** Motivos de Meta que sabemos nombrar en español. El resto se muestra crudo. */
const MOTIVOS = {
  131047: 'Ventana de 24 h cerrada — hace más de un día que no te escribe a ESE número',
  131026: 'El número no puede recibir mensajes (¿no tiene WhatsApp?)',
  131053: 'El archivo que se mandó no lo acepta WhatsApp',
  132000: 'La plantilla no coincide con lo que espera Meta',
  131049: 'Meta limitó la entrega para cuidar la experiencia del usuario',
  130472: 'El usuario está en un experimento de Meta y no recibe este mensaje',
  131042: 'Meta bloqueó los envíos por un PAGO PENDIENTE de la cuenta de WhatsApp — paga en Meta Business → Facturación',
  131031: 'Meta BLOQUEÓ la cuenta de WhatsApp — revisa el Administrador de WhatsApp',
}

/**
 * Códigos que no son de UN cliente sino de la CUENTA: mientras duren, no sale
 * ningún mensaje a nadie.
 *
 * ⚠️ El 17-oct-2026 IND amaneció con un pago pendiente a Meta (131042): desde las
 * 8:00 fallaron todos los salientes y nos enteramos porque los vendedores dijeron
 * que "no se van los mensajes". El aviso los listaba como 8 fallos de clientes
 * sueltos, cuando era UNA causa que frenaba todo.
 */
export const CODIGOS_DE_CUENTA = new Set([131042, 131031])

export const esFalloDeCuenta = (codigo) => CODIGOS_DE_CUENTA.has(Number(codigo))

/** Código de error de Meta → texto legible. */
export function motivoLegible(codigo, textoCrudo = '') {
  const n = Number(codigo)
  if (MOTIVOS[n]) return MOTIVOS[n]
  const crudo = String(textoCrudo || '').trim()
  return crudo ? `${crudo}${n ? ` (${n})` : ''}` : (n ? `Error ${n} de Meta` : 'Motivo desconocido')
}

/**
 * Agrupa los fallos por (teléfono, número nuestro, motivo).
 *
 * Se agrupa porque el modo normal de fallar es en tanda: el 16-ago fueron SEIS
 * mensajes seguidos al mismo cliente por el mismo motivo. Seis avisos idénticos
 * no informan mejor que uno que diga "6 mensajes"; informan peor, porque entrenan
 * a ignorarlos.
 */
export function agruparFallos(filas) {
  const grupos = new Map()
  for (const f of filas || []) {
    const clave = `${f.telefono}|${f.phone_id || ''}|${f.codigo || ''}`
    const g = grupos.get(clave)
    if (g) {
      g.cuantos += 1
      if (f.fecha && (!g.fecha || f.fecha > g.fecha)) g.fecha = f.fecha
      continue
    }
    grupos.set(clave, {
      telefono: String(f.telefono || ''),
      nombre:   String(f.nombre || '').trim(),
      phoneId:  String(f.phone_id || ''),
      codigo:   f.codigo || null,
      motivo:   motivoLegible(f.codigo, f.motivo),
      fecha:    f.fecha || null,
      cuantos:  1,
      // Si el cliente SÍ tiene la ventana abierta por el otro número, eso es lo
      // que convierte el aviso en algo accionable: no es "se perdió", es "mándalo
      // por acá". Lo rellena quien consulta (ver rutaAlternativa).
      alternativa: f.alternativa || null,
    })
  }
  return [...grupos.values()].sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')))
}

/** Nombre corto del número nuestro, para que el aviso no muestre un id de Meta. */
function etiqueta(phoneId, canales) {
  const c = (canales || []).find(x => String(x.phoneId) === String(phoneId))
  return c ? c.etiqueta : (phoneId || '—')
}

/**
 * Texto del aviso. Devuelve '' si no hay nada que avisar — y eso importa: un aviso
 * vacío periódico es ruido, y el ruido se acaba ignorando justo el día que trae
 * algo de verdad.
 */
export function textoAvisoFallidos(grupos, { canales = [], baseUrl = '' } = {}) {
  if (!grupos || !grupos.length) return ''
  const total = grupos.reduce((n, g) => n + g.cuantos, 0)
  const cab = total === 1
    ? '⚠️ <b>Un mensaje NO le llegó al cliente</b>'
    : `⚠️ <b>${total} mensajes NO les llegaron a los clientes</b>`

  const lineas = grupos.slice(0, 10).map(g => {
    const quien = g.nombre || `+${g.telefono}`
    const cuenta = g.cuantos > 1 ? ` · ${g.cuantos} mensajes` : ''
    let l = `\n• <b>${quien}</b> — salió por ${etiqueta(g.phoneId, canales)}${cuenta}\n   ${g.motivo}`
    if (g.alternativa) {
      l += `\n   ✅ <b>Sí puedes escribirle por ${etiqueta(g.alternativa, canales)}</b> — ahí la ventana está abierta`
    }
    return l
  })

  // Si hay más grupos de los que caben, se DICE. Un recorte silencioso se lee
  // como "esto es todo lo que pasó", y no lo es.
  const resto = grupos.length > 10 ? `\n\n…y ${grupos.length - 10} clientes más.` : ''
  const link  = baseUrl ? `\n\n${baseUrl}/inbox` : ''

  // Un bloqueo de cuenta va ARRIBA y aparte: no es "a estos clientes no les
  // llegó", es "no sale nada a nadie hasta que lo arregles".
  const deCuenta = grupos.find(g => esFalloDeCuenta(g.codigo))
  const alarma = deCuenta
    ? `🛑 <b>NO ESTÁ SALIENDO NINGÚN MENSAJE</b>\n${deCuenta.motivo}\nLos mensajes fallidos NO se reenvían solos: después de arreglarlo hay que mandarlos otra vez.\n\n`
    : ''
  return `${alarma}${cab}${lineas.join('')}${resto}${link}`
}

/**
 * Filas para el tablero de errores del CRM (`crm.eventos_sistema`, se ve en
 * /dashboard/errores). Una por MOTIVO, no por cliente: el tablero es para ver
 * qué está roto; la lista de clientes va en el detalle.
 */
export function eventosParaTablero(grupos, cuenta) {
  const porCodigo = new Map()
  for (const g of grupos || []) {
    const clave = String(g.codigo ?? '')
    const e = porCodigo.get(clave) || { codigo: g.codigo ?? null, motivo: g.motivo, mensajes: 0, clientes: [] }
    e.mensajes += g.cuantos
    e.clientes.push({ telefono: g.telefono, nombre: g.nombre || null, cuantos: g.cuantos, phone_id: g.phoneId || null })
    porCodigo.set(clave, e)
  }
  return [...porCodigo.values()].map(e => {
    const deCuenta = esFalloDeCuenta(e.codigo)
    const quien = e.clientes.length === 1 ? '1 cliente' : `${e.clientes.length} clientes`
    return {
      fuente: 'whatsapp',
      nivel: 'error',
      mensaje: (deCuenta ? `🛑 NO SALE NINGÚN MENSAJE de ${cuenta}. ` : `WhatsApp ${cuenta}: `)
        + `${e.mensajes} ${e.mensajes === 1 ? 'mensaje NO llegó' : 'mensajes NO llegaron'} (${quien}) — ${e.motivo}`,
      pedido_id: null,
      detalle: { origen: 'inbox', cuenta, codigo: e.codigo, de_cuenta: deCuenta, mensajes: e.mensajes, clientes: e.clientes },
    }
  })
}
