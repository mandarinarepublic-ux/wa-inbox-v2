import { NextResponse } from 'next/server'
import { listarEtiquetas, crearEtiqueta, editarEtiqueta, ponerEtiqueta, quitarEtiqueta } from '@/lib/etiquetas'
import { usuarioDeCookie } from '@/lib/acceso'
import { secretoSesion } from '@/lib/sesion'

// 🏷️ Etiquetas de chats. Ver lib/etiquetas.js.
export const dynamic = 'force-dynamic'

const fallo = (err, donde) => {
  console.error(`[/api/etiquetas ${donde}]`, err)
  return NextResponse.json({ error: err.message }, { status: 400 })
}

// GET /api/etiquetas → todas las de la cuenta (también las desactivadas)
export async function GET() {
  try {
    return NextResponse.json({ etiquetas: await listarEtiquetas() }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) { return fallo(err, 'GET') }
}

// POST /api/etiquetas
//   { accion: 'crear',  nombre, color }
//   { accion: 'editar', id, nombre?, color?, activa? }
//   { accion: 'poner',  telefono, id }
//   { accion: 'quitar', telefono, id }
export async function POST(req) {
  try {
    const b = await req.json()
    switch (b?.accion) {
      case 'crear':  return NextResponse.json({ etiqueta: await crearEtiqueta(b) })
      case 'editar': return NextResponse.json({ etiqueta: await editarEtiqueta(b.id, b) })
      case 'poner': {
        if (!b.telefono || !b.id) throw new Error('Falta telefono o id')
        const usuario = await usuarioDeCookie(req.headers.get('cookie'), secretoSesion())
        return NextResponse.json(await ponerEtiqueta(b.telefono, b.id, usuario || 'inbox'))
      }
      case 'quitar': {
        if (!b.telefono || !b.id) throw new Error('Falta telefono o id')
        return NextResponse.json(await quitarEtiqueta(b.telefono, b.id))
      }
      default: throw new Error('Acción desconocida')
    }
  } catch (err) { return fallo(err, 'POST') }
}
