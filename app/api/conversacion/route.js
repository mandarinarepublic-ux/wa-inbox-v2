import { readMensajesTail } from '@/lib/cache'
import { usaSupabaseLectura } from '@/lib/supabase'
import { getConversacionSupabase } from '@/lib/inbox-supabase'

export const dynamic = 'force-dynamic'

const soloDigitos = (s) => String(s || '').replace(/\D/g, '')

// GET /api/conversacion?phone=593...&limite=20
// Devuelve el hilo del contacto como [{role, content}] para que MANDI (mandi-agent)
// tenga memoria de la conversación. mandi-agent no tiene credenciales de Sheets, así que
// delega la lectura aquí (el inbox sí las tiene). Replica la lógica de conversacion.js.
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url)
    const phone = searchParams.get('phone')
    const limite = Math.min(parseInt(searchParams.get('limite') || '20', 10) || 20, 60)
    const objetivo = soloDigitos(phone)
    if (!objetivo) return Response.json([])

    // Modo Supabase: el hilo sale de inbox.mensajes (así el bot lee Supabase sin cambios).
    if (usaSupabaseLectura()) {
      return Response.json(await getConversacionSupabase(phone, limite))
    }

    const rows = await readMensajesTail(3000)
    const msgs = []
    for (const r of rows) {
      const tel = soloDigitos(r[1])
      if (!tel) continue
      if (!(tel === objetivo || tel.endsWith(objetivo.slice(-9)) || objetivo.endsWith(tel.slice(-9)))) continue
      const contenido = String(r[4] || '').trim()
      if (!contenido) continue
      const dir = String(r[7] || 'ENTRANTE').toUpperCase()
      msgs.push({ role: dir === 'SALIENTE' ? 'assistant' : 'user', content: contenido })
    }
    // El mensaje actual ya lo logueó Make (última fila entrante): lo quitamos
    if (msgs.length && msgs[msgs.length - 1].role === 'user') msgs.pop()
    let out = msgs.slice(-limite)
    while (out.length && out[0].role !== 'user') out.shift()
    // Fusionar turnos consecutivos del mismo rol
    const res = []
    for (const m of out) {
      const last = res[res.length - 1]
      if (last && last.role === m.role) last.content += '\n' + m.content
      else res.push({ role: m.role, content: m.content })
    }
    return Response.json(res)
  } catch (err) {
    console.error('[/api/conversacion]', err)
    return Response.json([])
  }
}
