import { NextResponse } from 'next/server'
import { importarRecetas } from '@/lib/flujos'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Conversión ÚNICA de las recetas de bienvenida a flujos (spec §7). Idempotente:
// correrlo dos veces no duplica nada, solo suma a `saltados`. Apaga
// recetas.activo al final para que el motor viejo deje de correr en paralelo.
export async function POST() {
  try {
    const resultado = await importarRecetas()
    return NextResponse.json(resultado)
  } catch (err) {
    console.error('[/api/flujos/importar-recetas POST]', err.message)
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
