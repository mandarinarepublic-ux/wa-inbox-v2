import { NextResponse } from 'next/server'

// Cron de SEGUIMIENTOS (Vercel Cron, ver vercel.json).
//
// Los seguimientos por TEMPERATURA (🔥🌤️❄️ marcada a mano) se retiraron el
// 23-sep-2026 con el port de la gestión de chats desde IND: la temperatura ya es
// automática (lib/temperatura.js) y nadie la escribe, así que esas reglas
// leerían una columna congelada. Estaban las tres apagadas al retirarlas.
//
// Acá entra la REACTIVACIÓN (etapa 3 del port): mensaje a quien se quedó callado
// en 💬/💳, nunca entre 22:00 y 08:00, sin escribir si el agente lleva el chat
// (camino 'despertar'), con reserva por la bandeja del número. Arrancará APAGADA.
// La versión anterior de este archivo está en git (commit anterior al 23-sep).

export const dynamic = 'force-dynamic'

function autorizado(req) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') || ''
  const isVercelCron = req.headers.get('x-vercel-cron') != null // Vercel lo pone solo en crons reales
  const keyQ = new URL(req.url).searchParams.get('key')
  if (isVercelCron) return true
  if (secret && (auth === `Bearer ${secret}` || keyQ === secret)) return true
  return false
}

export async function GET(req) {
  if (!autorizado(req)) {
    return NextResponse.json({ error: 'no autorizado' }, { status: 401 })
  }
  return NextResponse.json({ ok: true, skipped: 'seguimientos por temperatura retirados; la reactivación llega en la etapa 3' })
}
