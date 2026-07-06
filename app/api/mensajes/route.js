import { NextResponse } from 'next/server'
import { getMensajes } from '@/lib/mensajes'

export async function GET() {
  try {
    const mensajes = await getMensajes()
    return NextResponse.json(mensajes)
  } catch (err) {
    console.error('[/api/mensajes]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
