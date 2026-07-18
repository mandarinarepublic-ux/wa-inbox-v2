import { NextResponse } from 'next/server'
import { getContactos } from '@/lib/contactos'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const soloDigitos = (s) => String(s || '').replace(/\D/g, '')
const DIA_MS = 24 * 60 * 60 * 1000

// Lista de contactos que te han escrito, con la marca dentro/fuera de la ventana 24h
// (calculada desde ultimo_entrante_at). Alimenta la pestaña CONTACTOS.
export async function GET() {
  try {
    const contactos = await getContactos()
    const now = Date.now()
    const lista = (contactos || [])
      .filter((c) => soloDigitos(c.telefono).length >= 9)
      .map((c) => {
        const entMs = c.ultimoEntranteAt ? new Date(c.ultimoEntranteAt).getTime() : 0
        return {
          telefono: c.telefono,
          nombre: c.nombre || '',
          alias: c.alias || '',
          estado: c.estado || 'pendiente',
          modoIA: c.modoIA !== false,
          idVenta: c.idVenta || '',
          ultimoEntranteAt: c.ultimoEntranteAt || null,
          ultimoMensajeAt: c.ultimoMensajeAt || null,
          // dentro de 24h → se puede escribir texto libre; fuera → solo plantilla.
          dentro24h: entMs > 0 && now - entMs < DIA_MS,
        }
      })
      .sort((a, b) => new Date(b.ultimoMensajeAt || 0) - new Date(a.ultimoMensajeAt || 0))

    return NextResponse.json({ ok: true, total: lista.length, contactos: lista })
  } catch (err) {
    console.error('[/api/directorio]', err.message)
    return NextResponse.json({ ok: false, error: err.message, contactos: [] }, { status: 500 })
  }
}
