import { NextResponse } from 'next/server'
import { getMensajes } from '@/lib/mensajes'

// Sin esto, Next.js 14 cachea la respuesta GET → el inbox mostraría datos
// congelados del último deploy. force-dynamic = lectura en vivo cada request.
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const mensajes = await getMensajes()
    return NextResponse.json(mensajes)
  } catch (err) {
    console.error('[/api/mensajes]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
