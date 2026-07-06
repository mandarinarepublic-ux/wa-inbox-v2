import { NextResponse } from 'next/server'
import { getRespuestas, addRespuesta, editRespuesta, deleteRespuesta } from '@/lib/respuestas'

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
    const { accion, id, texto, imagenUrl } = await req.json()
    if (accion === 'add') {
      await addRespuesta(id, texto, imagenUrl)
    } else if (accion === 'edit') {
      await editRespuesta(id, texto, imagenUrl)
    } else if (accion === 'delete') {
      await deleteRespuesta(id)
    } else {
      return NextResponse.json({ error: `Accion desconocida: ${accion}` }, { status: 400 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
