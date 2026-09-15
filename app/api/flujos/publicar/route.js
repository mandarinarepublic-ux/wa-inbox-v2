import { NextResponse } from 'next/server'
import { publicarFlujo } from '@/lib/flujos'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Publicar valida (nodos + choques de Disparador contra los DEMÁS publicados) y
// solo si no hay errores copia grafo -> grafo_vivo. Despublicar (publicar:false)
// no valida nada: solo deja de correr.
export async function POST(req) {
  try {
    const { flujo_id, publicar } = await req.json().catch(() => ({}))
    if (!flujo_id) return NextResponse.json({ ok: false, error: 'falta flujo_id' }, { status: 400 })
    const resultado = await publicarFlujo(flujo_id, !!publicar)
    return NextResponse.json(resultado)
  } catch (err) {
    console.error('[/api/flujos/publicar POST]', err.message)
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
