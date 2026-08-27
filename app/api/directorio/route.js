import { NextResponse } from 'next/server'
import { getContactos } from '@/lib/contactos'
import { getBandejasPorTelefonoSupabase } from '@/lib/inbox-supabase'
import { canalParaEscribir } from '@/lib/bandeja'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const soloDigitos = (s) => String(s || '').replace(/\D/g, '')

// Lista de contactos que te han escrito, con la marca dentro/fuera de la ventana 24h
// (calculada desde ultimo_entrante_at). Alimenta la pestaña CONTACTOS.
export async function GET() {
  try {
    // Sin filtro de canal: la agenda es UNA sola, compartida por los dos numeros.
    const contactos = await getContactos(null)
    // ...pero la VENTANA no es de la agenda, es de cada (cliente, numero).
    //
    // ☠️ ACA VIVIA LA MITAD DE LOS 79 MENSAJES MUERTOS DE AGOSTO. Esta ruta
    // calculaba `dentro24h` con `c.ultimoEntranteAt`, que es el ultimo entrante
    // de la PERSONA mezclando los dos numeros. Resultado: pintaba la ventana en
    // VERDE porque el cliente habia escrito al OTRO numero, el vendedor escribia
    // confiado, y Meta rechazaba el mensaje con 131047. La otra mitad era que el
    // envio salia por el canal de la PESTANA; por eso ahora se devuelve `canal`.
    const bandejas = await getBandejasPorTelefonoSupabase()
    const now = Date.now()
    const lista = (contactos || [])
      .filter((c) => soloDigitos(c.telefono).length >= 9)
      .map((c) => {
        const { canal, dentro24h, ultimoEntranteAt } =
          canalParaEscribir(bandejas.get(c.telefono), now)
        return {
          telefono: c.telefono,
          nombre: c.nombre || '',
          alias: c.alias || '',
          estado: c.estado || 'pendiente',
          modoIA: c.modoIA !== false,
          idVenta: c.idVenta || '',
          // El numero por el que ESTA persona escribio mas reciente. Vacio = no
          // escribio por ninguno; entonces no hay a donde mandarle texto libre.
          canal,
          // Se conserva el de la persona para la columna "hace X" de la lista,
          // pero YA NO decide nada: `ultimoEntranteDelCanal` es el que manda.
          ultimoEntranteAt: c.ultimoEntranteAt || null,
          ultimoEntranteDelCanal: ultimoEntranteAt,
          ultimoMensajeAt: c.ultimoMensajeAt || null,
          // dentro de 24h → texto libre; fuera → solo plantilla. Medido contra
          // el canal elegido, nunca contra la persona.
          dentro24h,
        }
      })
      .sort((a, b) => new Date(b.ultimoMensajeAt || 0) - new Date(a.ultimoMensajeAt || 0))

    return NextResponse.json({ ok: true, total: lista.length, contactos: lista })
  } catch (err) {
    console.error('[/api/directorio]', err.message)
    return NextResponse.json({ ok: false, error: err.message, contactos: [] }, { status: 500 })
  }
}
