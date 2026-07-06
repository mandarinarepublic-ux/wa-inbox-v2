import { NextResponse } from 'next/server'
import { updateEstado, updateModoIA, updateNotas, updateAlias } from '@/lib/contactos'

// PATCH /api/contactos/estado
// Body: { telefono, campo, valor }
// campo: 'estado' | 'modoIA' | 'notas' | 'alias'
export async function PATCH(req) {
  try {
    const { telefono, campo, valor } = await req.json()
    if (!telefono || !campo) {
      return NextResponse.json({ error: 'Faltan campos: telefono, campo' }, { status: 400 })
    }

    let result
    switch (campo) {
      case 'estado':
        result = await updateEstado(telefono, valor)
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
      default:
        return NextResponse.json({ error: `Campo desconocido: ${campo}` }, { status: 400 })
    }

    return NextResponse.json(result)
  } catch (err) {
    console.error('[/api/contactos/estado]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
