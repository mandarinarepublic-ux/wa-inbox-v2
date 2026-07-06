import { NextResponse } from 'next/server'

// Make sigue siendo el que envía mensajes por WhatsApp — eso no cambia
const MAKE_SEND_WEBHOOK = process.env.MAKE_SEND_WEBHOOK || 'https://hook.us2.make.com/2j5dzq4gjqkjjnyxiyb46bons15awy2k'

export async function POST(req) {
  try {
    const body = await req.json()
    const res = await fetch(MAKE_SEND_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return NextResponse.json({ ok: res.ok })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
