import { NextResponse } from 'next/server'
import { listarNotas, crearNota, editarNota, borrarNota, tipoNotaValido } from '@/lib/notas'

// Las notas cambian mientras el agente está mirando el chat: si Next las cachea,
// el panel muestra la lista de hace un rato y parece que no se guardó.
export const dynamic = 'force-dynamic'

// GET /api/notas?telefono=593...
export async function GET(req) {
  try {
    const telefono = new URL(req.url).searchParams.get('telefono')
    if (!telefono) return NextResponse.json({ error: 'Falta telefono' }, { status: 400 })
    return NextResponse.json({ notas: await listarNotas(telefono) })
  } catch (err) {
    console.error('[/api/notas GET]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// POST /api/notas  { telefono, texto, tipo? }
// `tipo` es opcional y llega del navegador: solo se aceptan los valores
// conocidos (pago_ok, pago_error) porque maneja el color de la nota — cualquier
// otra cosa se cae a null (neutral) en vez de colarse. Ver lib/notas.js.
export async function POST(req) {
  try {
    const { telefono, texto, tipo } = await req.json()
    if (!telefono) return NextResponse.json({ error: 'Falta telefono' }, { status: 400 })
    return NextResponse.json({ nota: await crearNota(telefono, texto, tipoNotaValido(tipo)) })
  } catch (err) {
    console.error('[/api/notas POST]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// PATCH /api/notas  { id, texto }
export async function PATCH(req) {
  try {
    const { id, texto } = await req.json()
    if (!id) return NextResponse.json({ error: 'Falta id' }, { status: 400 })
    return NextResponse.json({ nota: await editarNota(id, texto) })
  } catch (err) {
    console.error('[/api/notas PATCH]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// DELETE /api/notas?id=123
export async function DELETE(req) {
  try {
    const id = new URL(req.url).searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Falta id' }, { status: 400 })
    return NextResponse.json(await borrarNota(id))
  } catch (err) {
    console.error('[/api/notas DELETE]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
