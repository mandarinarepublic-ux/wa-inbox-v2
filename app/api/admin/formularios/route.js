// app/api/admin/formularios/route.js — 📝 crear y publicar en Meta los formularios
// de WhatsApp (lib/formularios.js). 14-nov-2026.
//
// Existe porque META_TOKEN es *Sensitive* en Vercel: nadie lo puede leer, pero la
// app sí lo tiene en ejecución (mismo truco que /api/admin/meta-waba).
//
//   GET                       → estado del formulario en la WABA de MANDI.
//   POST ?accion=crear        → lo crea y lo publica. Si ya está PUBLICADO no hace
//                               nada; si quedó en BORRADOR (falló la publicación)
//                               lo borra y lo vuelve a crear.
//   ?formulario=datos_pedido  (por defecto)
//
// Seguridad: no está en lib/rutas-publicas.js → el candado exige sesión del CRM o
// la clave de máquina. Nunca devuelve el token.
import { CANALES } from '@/lib/canales'
import { env } from '@/lib/env'
import { FORMULARIOS, formularioValido, flowJsonDatosPedido } from '@/lib/formularios'

export const dynamic = 'force-dynamic'

const GRAPH = 'https://graph.facebook.com/v23.0'
const JSON_DE = { datos_pedido: flowJsonDatosPedido }

async function graph(ruta, metodo = 'GET', cuerpo) {
  try {
    const r = await fetch(`${GRAPH}${ruta}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${env('META_TOKEN')}`, ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) },
      ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
      cache: 'no-store',
    })
    const data = await r.json().catch(() => ({}))
    return r.ok ? data : { ok: false, status: r.status, error: data?.error }
  } catch (e) {
    return { ok: false, status: 0, error: { message: e.message } }
  }
}

function contexto(req) {
  const url = new URL(req.url)
  const clave = formularioValido(url.searchParams.get('formulario') || 'datos_pedido')
  const canal = CANALES.find((c) => c.id === 'MANDI') || CANALES[0]
  return { url, clave, wabaId: canal?.wabaId }
}

async function buscar(wabaId, nombre) {
  const r = await graph(`/${wabaId}/flows?fields=id,name,status,validation_errors&limit=200`)
  if (r?.ok === false) return { error: r }
  return { flow: (r?.data || []).find((f) => f.name === nombre) || null }
}

export async function GET(req) {
  const { clave, wabaId } = contexto(req)
  if (!clave) return Response.json({ error: 'Formulario desconocido', formularios: Object.keys(FORMULARIOS) }, { status: 400 })
  if (!env('META_TOKEN')) return Response.json({ error: 'Falta META_TOKEN' }, { status: 500 })
  const nombre = FORMULARIOS[clave].flowName
  const { flow, error } = await buscar(wabaId, nombre)
  if (error) return Response.json({ ok: false, nombre, error }, { status: 502 })
  return Response.json({ ok: true, nombre, existe: !!flow, flow })
}

export async function POST(req) {
  const { url, clave, wabaId } = contexto(req)
  if (url.searchParams.get('accion') !== 'crear') return Response.json({ error: 'Usa ?accion=crear' }, { status: 400 })
  if (!clave) return Response.json({ error: 'Formulario desconocido', formularios: Object.keys(FORMULARIOS) }, { status: 400 })
  if (!env('META_TOKEN')) return Response.json({ error: 'Falta META_TOKEN' }, { status: 500 })
  const nombre = FORMULARIOS[clave].flowName

  const previo = await buscar(wabaId, nombre)
  if (previo.error) return Response.json({ ok: false, paso: 'buscar', error: previo.error }, { status: 502 })
  if (previo.flow?.status === 'PUBLISHED') return Response.json({ ok: true, yaEstaba: true, flow: previo.flow })
  if (previo.flow) {
    // Un borrador viejo (de un intento fallido): se borra para crearlo limpio.
    const b = await graph(`/${previo.flow.id}`, 'DELETE')
    if (b?.ok === false) return Response.json({ ok: false, paso: 'borrar borrador', flow: previo.flow, error: b.error }, { status: 502 })
  }

  const creado = await graph(`/${wabaId}/flows`, 'POST', {
    name: nombre,
    categories: ['OTHER'],
    flow_json: JSON.stringify(JSON_DE[clave]()),
    publish: true,
  })
  if (creado?.ok === false) return Response.json({ ok: false, paso: 'crear', error: creado.error }, { status: 502 })
  // Meta devuelve el id y, si el JSON tiene problemas, `validation_errors` (en ese
  // caso queda en BORRADOR). Se relee para confirmar el estado real.
  const final = await buscar(wabaId, nombre)
  return Response.json({ ok: final.flow?.status === 'PUBLISHED', creado, flow: final.flow || null })
}
