import { NextResponse } from 'next/server'
import { getLista, getMensajes } from '@/lib/mensajes'
import { getContactos } from '@/lib/contactos'

// Sync unificado del inbox: UNA sola función en vez de 3 (/api/lista +
// /api/mensajes + /api/contactos) por cada ciclo de polling → 1/3 de las
// invocaciones. Las tres lecturas corren en paralelo.
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const [lista, rows, contactos] = await Promise.all([
      getLista(),
      getMensajes(),
      getContactos(),
    ])
    return NextResponse.json({ lista, rows, contactos }, {
      // Cache COMPARTIDO en el edge, corto (5s) para no agregar latencia visible al
      // vendedor: varias pestañas que pollean dentro de la misma ventana comparten
      // UNA ejecución de origen. stale-while-revalidate sirve al instante y revalida.
      headers: { 'Cache-Control': 's-maxage=5, stale-while-revalidate=20' },
    })
  } catch (err) {
    console.error('[/api/inbox-sync]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
