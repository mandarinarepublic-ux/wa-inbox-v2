import { NextResponse } from 'next/server'
import { getSupabase, CUENTA } from '@/lib/supabase'
import { consultarAgente } from '@/lib/responder-ia'
import { guardarSombraIASupabase } from '@/lib/inbox-supabase'
import { elegirParaSombra, enParalelo } from '@/lib/sombra-barrido'

export const dynamic = 'force-dynamic'
export const revalidate = 0
// Cada consulta al agente tarda 5-20 s; 15 chats de a 3 a la vez caben holgados.
export const maxDuration = 300

// 🕵️ IA en SOMBRA (17-nov-2026). Ruta privada: el candado del CRM (middleware) la
// cubre como a todo /api. La clave del agente vive SOLO en el servidor.
//   GET  → últimas respuestas guardadas en inbox.ia_sombra (para revisarlas en AUTOS)
//   POST → barre los chats en PENDIENTES: le pregunta al agente qué contestaría al
//          último mensaje de cada uno y lo guarda. ☠️ NO envía nada a ningún cliente.

export async function GET() {
  try {
    const { data, error } = await getSupabase()
      .from('ia_sombra')
      .select('id, telefono, mensaje, respuesta, respuestas_rapidas, derivar, etapa, tools, modelo, tokens_in, tokens_out, ms, error, creado_en')
      .eq('cuenta', CUENTA)
      .order('id', { ascending: false })
      .limit(40)
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true, filas: data || [] })
  } catch (err) {
    console.error('[/api/ia-sombra GET]', err.message)
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}

export async function POST() {
  try {
    const sb = getSupabase()
    const { data: convs, error: e1 } = await sb
      .from('conversaciones')
      .select('conversacion_id, telefono, alias, nombre_contacto')
      .eq('cuenta', CUENTA)
      .eq('estado', 'PENDIENTE')
      .limit(200)
    if (e1) throw new Error(e1.message)

    // Último ENTRANTE de cada chat. Una consulta por chat (son pocos y así no
    // hay tope de 1000 filas que se coma a alguno).
    const ultimos = (await Promise.all((convs || []).map(async c => {
      const { data } = await sb
        .from('mensajes')
        .select('wa_message_id, tipo, texto, fecha, nombre')
        .eq('cuenta', CUENTA)
        .eq('conversacion_id', c.conversacion_id)
        .eq('direccion', 'ENTRANTE')
        .order('fecha', { ascending: false })
        .limit(1)
      const m = data?.[0]
      if (!m) return null
      return {
        telefono: c.telefono, nombre: c.alias || c.nombre_contacto || m.nombre || '',
        wamid: m.wa_message_id, tipo: m.tipo, texto: m.texto, fecha: m.fecha,
      }
    }))).filter(Boolean)

    const wamids = ultimos.map(u => u.wamid).filter(Boolean)
    const yaRevisados = new Set()
    if (wamids.length) {
      const { data: hechos } = await sb
        .from('ia_sombra')
        .select('wa_message_id')
        .eq('cuenta', CUENTA)
        .is('error', null)
        .in('wa_message_id', wamids)
      for (const h of hechos || []) yaRevisados.add(h.wa_message_id)
    }

    const elegidos = elegirParaSombra(ultimos, yaRevisados)
    const resultados = await enParalelo(elegidos, 3, async (u) => {
      const d = await consultarAgente(u.telefono, u.nombre, u.texto, 'sombra')
      await guardarSombraIASupabase({
        telefono: u.telefono, wa_message_id: u.wamid, mensaje: String(u.texto).slice(0, 2000),
        respuesta: d?.ok ? [d.texto, ...d.imagenes].filter(Boolean).join('\n') : null,
        respuestas_rapidas: d?.ok ? d.respuestasRapidas : [],
        derivar: d?.ok ? (d.derivar || null) : null,
        etapa: d?.ok ? (d.etapa || null) : null,
        tools: d?.tools || null, modelo: d?.modelo || null,
        tokens_in: d?.tokensIn || null, tokens_out: d?.tokensOut || null,
        ms: d?.ms || null, error: d?.ok ? null : (d?.error || 'sin respuesta'),
      })
      return Boolean(d?.ok)
    })

    return NextResponse.json({
      ok: true,
      pendientes: (convs || []).length,
      revisados: elegidos.length,
      conError: resultados.filter(x => !x).length,
      yaEstaban: yaRevisados.size,
    })
  } catch (err) {
    console.error('[/api/ia-sombra POST]', err.message)
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
