import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { updateEstado, updateModoIA, updateNotas, updateAlias, updateIdVenta, updateTemperatura } from '@/lib/contactos'
import { revisarVentaEnProceso } from '@/lib/capi'

// PATCH /api/contactos/estado
// Body: { telefono, campo, valor }
// campo: 'estado' | 'modoIA' | 'notas' | 'alias' | 'idVenta' | 'temperatura'
export async function PATCH(req) {
  try {
    const { telefono, campo, valor, phoneId } = await req.json()
    if (!telefono || !campo) {
      return NextResponse.json({ error: 'Faltan campos: telefono, campo' }, { status: 400 })
    }

    let result
    switch (campo) {
      case 'estado':
        // phoneId = en qué CANAL se cambia el estado. Sin él solo se escribe el
        // lado viejo (conversaciones), que es lo que sigue leyendo IND.
        result = await updateEstado(telefono, valor, phoneId)
        break
      case 'modoIA':
        result = await updateModoIA(telefono, valor) // 'IA' | 'HUMANO'
        break
      case 'notas':
        result = await updateNotas(telefono, valor)
        break
      case 'alias':
        result = await updateAlias(telefono, valor)
        break
      case 'idVenta':
        result = await updateIdVenta(telefono, valor)
        break
      case 'temperatura':
        result = await updateTemperatura(telefono, valor) // 'caliente'|'tibio'|'frio'|''
        break
      default:
        return NextResponse.json({ error: `Campo desconocido: ${campo}` }, { status: 400 })
    }

    // Marcar 🔥 CALIENTE o mandar el chat a SOPORTE es, para el negocio, una
    // venta en proceso → InitiateCheckout. La función relee las tres condiciones
    // de la base, así que no hace falta filtrar por `campo` acá: si el agente
    // marcó otra cosa, no se cumple ninguna y no se manda nada.
    //
    // Sin await a propósito: el botón del inbox no puede quedarse esperando a
    // Meta, y si esto falla el cambio de estado ya está guardado igual.
    //
    // Pero SIN await no alcanza: hay que envolverlo en waitUntil(). Una función
    // serverless se puede congelar apenas devuelve la respuesta, y ahí la promesa
    // suelta muere en el aire — la señal no sale y no queda rastro de que faltó,
    // porque el .catch() tampoco llega a correr. waitUntil() es el compromiso de
    // Vercel de mantenerla viva hasta que la promesa termine, sin retrasar ni un
    // milisegundo la respuesta al botón.
    //
    // Este patrón exacto ya costó una factura en el CRM (MAN-AND-5601, disparada
    // sin await justo antes de un router.push). Acá el que se pierde es el
    // InitiateCheckout de un chat marcado 🔥 CALIENTE o mandado a SOPORTE con
    // pocos mensajes y sin foto: el webhook no lo va a rescatar, porque para él
    // ese chat no cumple ninguna condición. Este es su único disparador.
    //
    // En MANDARINA esto pesa más que en IND: acá el 🔥 CALIENTE se usa a diario.
    waitUntil(
      revisarVentaEnProceso(telefono)
        .catch(e => console.error('[/api/contactos/estado] venta capi:', e.message))
    )

    return NextResponse.json(result)
  } catch (err) {
    console.error('[/api/contactos/estado]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
