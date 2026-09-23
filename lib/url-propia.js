// lib/url-propia.js — la dirección con la que un CRON se llama a sí mismo.
//
// ☠️ Los crons armaban la dirección con `new URL(req.url).origin`. Vercel Cron
// invoca la dirección INTERNA del despliegue (`wa-inbox-v2-xxxx-….vercel.app`),
// que tiene la protección de Vercel prendida: toda llamada a `/api/saliente`
// rebota con `401 Protected deployment` ANTES de llegar a nuestro código, y el
// cron devuelve 200 igual. En IND eso dio CERO seguimientos en toda la historia;
// en MANDI no se notaba solo porque las reglas estaban apagadas (verificado el
// 23-sep-2026: la URL del despliegue contesta "Protected deployment").
//
// El dominio de producción contesta nuestro propio candado, que sí acepta la
// credencial de máquina (la pone enviarSaliente / responderConIA).
// El webhook NO usa esto: lo llama Meta por el dominio público.
export const URL_PRODUCCION = 'https://inbox.apps.mandarinaec.com'

/** Base sin barra final. `INBOX_URL` la sobreescribe sin tocar código. */
export function urlPropia(env = process.env) {
  const base = String(env?.INBOX_URL || '').replace(/[^\x21-\x7E]/g, '').trim() || URL_PRODUCCION
  return base.replace(/\/+$/, '')
}
