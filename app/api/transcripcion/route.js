import { NextResponse } from 'next/server'
import { guardarTranscripcion } from '@/lib/transcripcion'

// 📝 POST /api/transcripcion { id, texto } → guarda el texto de una nota de voz.
// El candado de sesión lo pone middleware.js, como en el resto de /api/.
export const dynamic = 'force-dynamic'

export async function POST(req) {
  try {
    const { id, texto } = await req.json()
    return NextResponse.json({ transcripcion: await guardarTranscripcion(id, texto) })
  } catch (err) {
    console.error('[/api/transcripcion]', err)
    return NextResponse.json({ error: err.message }, { status: 400 })
  }
}
