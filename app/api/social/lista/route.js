import { NextResponse } from 'next/server'
import { getSocialConversacionesSupabase } from '@/lib/social-supabase'

// Lista de conversaciones del Social Inbox (FB/IG) desde Supabase.
// Reemplaza la lectura client-side del CSV de la hoja SOCIAL (gviz).
export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  try {
    const convs = await getSocialConversacionesSupabase()
    return NextResponse.json(convs)
  } catch (err) {
    console.error('[/api/social/lista]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
