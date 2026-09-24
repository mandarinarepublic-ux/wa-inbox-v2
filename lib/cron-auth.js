// lib/cron-auth.js — ¿Esta llamada a un cron es de verdad de Vercel (o de una persona con el secreto)?
//
// UNA sola regla para todos los crons (24-sep-2026). Antes cada ruta tenía la suya
// y dos (seguimientos y flujos) aceptaban la cabecera `x-vercel-cron` SIEMPRE: esa
// cabecera la puede mandar cualquiera, así que se podían disparar desde afuera
// sabiendo solo la dirección. Y `pagos` quedaba ABIERTO del todo sin secreto.
//
// Con CRON_SECRET configurado (lo está en producción en los dos inbox), Vercel
// manda `Authorization: Bearer <secreto>` en cada cron real: eso es lo único que
// vale, más `?key=` para dispararlo a mano. Sin secreto, se acepta la cabecera
// (mejor un cron que corre que uno muerto en silencio) pero se avisa en el log.
// Módulo PURO: recibe las cabeceras, la URL y el entorno.

export function autorizadoCron(req, env = process.env) {
  // Se acepta el valor tal cual Y sin BOM/espacios: PowerShell pega un BOM
  // invisible, y no sabemos si Vercel lo manda en la cabecera o no.
  const crudo = String(env.CRON_SECRET || '')
  const secretos = [...new Set([crudo, crudo.replace(/^\uFEFF/, '').trim()])].filter(Boolean)
  const auth = req.headers.get('authorization') || ''
  if (secretos.length) {
    let keyQ = null
    try { keyQ = new URL(req.url).searchParams.get('key') } catch { /* URL rara → sin key */ }
    return secretos.some(s => auth === `Bearer ${s}` || keyQ === s)
  }
  const esCron = req.headers.get('x-vercel-cron') != null
  if (esCron) console.error('[cron-auth] ⚠️ falta CRON_SECRET: el cron se acepta solo por la cabecera x-vercel-cron, que se puede falsificar')
  return esCron
}
