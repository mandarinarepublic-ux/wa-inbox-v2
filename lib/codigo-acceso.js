// lib/codigo-acceso.js — el código de acceso del club de premios (15-oct-2026).
//
// El club (premios.mandarinaec.com / premios.indlovers.com) genera el código y le
// pide al inbox que lo mande, porque el token de Meta vive AQUÍ y no debe salir.
// La ruta (app/api/codigo-acceso) solo acepta un código de 6 dígitos para un
// celular de Ecuador: con la llave robada no se puede mandar ningún otro mensaje.
// Archivo IDÉNTICO en los dos inbox.

import { timingSafeEqual } from 'node:crypto'

const limpio = (x) => String(x ?? '').replace(/[^\x21-\x7E]/g, '') // BOM y espacios de PowerShell

/** Authorization: Bearer <FIDELIDAD_OTP_TOKEN>. Sin llave configurada, nadie entra. */
export function llaveValida(cabecera, esperada) {
  const e = limpio(esperada)
  if (!e) return false
  const r = limpio(String(cabecera ?? '').replace(/^Bearer\s+/i, ''))
  const a = Buffer.from(r), b = Buffer.from(e)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** 0991112222 | 593991112222 → 593991112222; cualquier otra cosa → '' */
function celularEcuador(x) {
  const d = String(x ?? '').replace(/\D/g, '')
  if (d.length === 10 && d.startsWith('09')) return '593' + d.slice(1)
  if (d.length === 12 && d.startsWith('5939')) return d
  return ''
}

/** { ok, cuerpo } listo para POST /{phone_id}/messages, o { ok:false, error }. */
export function armarCodigoAcceso({ celular, codigo, plantilla = 'codigo_acceso', idioma = 'es' }) {
  const to = celularEcuador(celular)
  const c = String(codigo ?? '')
  if (!to) return { ok: false, error: 'celular inválido' }
  if (!/^\d{6}$/.test(c)) return { ok: false, error: 'código inválido' }
  return {
    ok: true,
    cuerpo: {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: plantilla,
        language: { code: idioma },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: c }] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: c }] },
        ],
      },
    },
  }
}
