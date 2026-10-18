import { NextResponse } from 'next/server'
import { getFbPageId } from '@/lib/social-supabase'

// Id de la Página de Facebook, para que el chat arme el link "Abrir en Meta ↗"
// (Business Suite). No es secreto: el id de una página es público.
export const dynamic = 'force-dynamic'

export async function GET() {
  const pageId = await getFbPageId().catch(() => '')
  return NextResponse.json({ pageId: pageId || '' })
}
