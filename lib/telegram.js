// lib/telegram.js — avisos por Telegram.
//
// Sin TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID esto es un NO-OP silencioso, igual que
// enviarPush() sin claves VAPID: se despliega hoy, no rompe nada, y se enciende
// después creando el bot y cargando las dos variables.
//
// Config (Vercel, cargar desde el PANEL WEB — por PowerShell les pega un BOM que
// revienta solo en producción):
//   TELEGRAM_BOT_TOKEN  → el que te da @BotFather
//   TELEGRAM_CHAT_ID    → el chat/grupo destino (puede ser negativo si es grupo)

const API = 'https://api.telegram.org'

const token  = () => String(process.env.TELEGRAM_BOT_TOKEN || '').replace(/[^\x21-\x7E]/g, '')
const chatId = () => String(process.env.TELEGRAM_CHAT_ID   || '').replace(/[^\x21-\x7E]/g, '')

export function telegramConfigurado() {
  return Boolean(token() && chatId())
}

/**
 * Manda un texto al chat configurado. NUNCA lanza.
 *
 * ⚠️ `fetch` no lanza con 4xx/5xx — devuelve una respuesta con `ok:false`. Sin
 * mirar `res.ok`, un token vencido se vería idéntico a un envío bueno y el aviso
 * se perdería en silencio para siempre.
 */
export async function enviarTelegram(texto) {
  if (!telegramConfigurado()) return { ok: false, motivo: 'sin-config' }
  try {
    const res = await fetch(`${API}/bot${token()}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId(),
        text: String(texto || ''),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    })
    if (!res.ok) {
      const detalle = await res.text().catch(() => '')
      console.error('[telegram] rechazado:', res.status, detalle.slice(0, 200))
      return { ok: false, motivo: `http-${res.status}` }
    }
    return { ok: true }
  } catch (e) {
    console.error('[telegram] error de red:', e?.message || e)
    return { ok: false, motivo: 'red' }
  }
}
