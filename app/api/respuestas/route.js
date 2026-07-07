import { NextResponse } from 'next/server'
import { getRespuestas, addRespuesta, editRespuesta, deleteRespuesta } from '@/lib/respuestas'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const respuestas = await getRespuestas()
    return NextResponse.json(respuestas)
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(req) {
  try {
    const { accion, id, texto, imagenUrl, ...extras } = await req.json()
    if (accion === 'add' || accion === 'agregar') {
      await addRespuesta(id, texto, imagenUrl, extras)
    } else if (accion === 'edit' || accion === 'actualizar') {
      await editRespuesta(id, texto, imagenUrl, extras)
    } else if (accion === 'delete' || accion === 'eliminar') {
      await deleteRespuesta(id)
    } else {
      return NextResponse.json({ error: `Accion desconocida: ${accion}` }, { status: 400 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
