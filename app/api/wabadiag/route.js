import { NextResponse } from 'next/server'
import { GRAPH } from '@/lib/whatsapp'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// TEMPORAL — diagnóstico para descubrir el WABA ID. Protegido con clave (?k=).
// NO expone el token; solo respuestas de Graph (ids/nombres). BORRAR tras usar.
const META_TOKEN    = process.env.META_TOKEN || ''
const META_PHONE_ID = process.env.META_PHONE_ID || '1024077200794372'
const KEY = 'mnd_diag_7g2x'
const tok = () => encodeURIComponent(META_TOKEN)
const j = async (url) => { try { const r = await fetch(url); return await r.json() } catch (e) { return { _fetchError: e.message } } }

export async function GET(req) {
  const { searchParams } = new URL(req.url)
  if (searchParams.get('k') !== KEY) return NextResponse.json({ ok: false, error: 'no autorizado' }, { status: 403 })
  if (!META_TOKEN) return NextResponse.json({ ok: false, error: 'sin META_TOKEN' })

  const [me, dbg, accounts, phone, ownWaba, cliWaba, businesses] = await Promise.all([
    j(`${GRAPH}/me?fields=id,name&access_token=${tok()}`),
    j(`${GRAPH}/debug_token?input_token=${tok()}&access_token=${tok()}`),
    j(`${GRAPH}/me/accounts?fields=id,name&access_token=${tok()}`),
    j(`${GRAPH}/${META_PHONE_ID}?fields=id,display_phone_number,verified_name,whatsapp_business_account&access_token=${tok()}`),
    j(`${GRAPH}/me/owned_whatsapp_business_accounts?access_token=${tok()}`),
    j(`${GRAPH}/me/client_whatsapp_business_accounts?access_token=${tok()}`),
    j(`${GRAPH}/me/businesses?fields=id,name&access_token=${tok()}`),
  ])

  return NextResponse.json({ ok: true, me, tokenData: dbg?.data || dbg, accounts, phone, ownWaba, cliWaba, businesses })
}
