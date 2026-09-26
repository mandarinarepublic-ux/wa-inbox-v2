// lib/anuncio-vista.js — cómo se NOMBRA un anuncio en el disparador de FLUJOS y en AUTOS.
//
// Antes se mostraba el titular del referral, y Meta pone ahí el nombre de la
// página ("Mandarina Republic") o el botón ("Chatear con nosotros") en casi todos:
// la lista era una fila de anuncios idénticos. Ahora manda el nombre que tiene el
// anuncio en el Administrador de anuncios (+ campaña), con la etiqueta propia por
// encima si alguien la puso, y el texto del anuncio como pista.

const GENERICOS = /^(mandarina republic|chatear con nosotros|enviar mensaje|más información)$/i

/** Nombre principal: etiqueta propia > nombre en Ads Manager > titular útil > texto > id. */
export function nombreDeAnuncio(a = {}) {
  const etiqueta = String(a.etiqueta || '').trim()
  const titular = String(a.titular || '').trim()
  // La etiqueta se autollenaba con el titular: si es genérica o igual al titular, no es "propia".
  if (etiqueta && !GENERICOS.test(etiqueta) && etiqueta !== titular) return etiqueta
  if (a.nombre_anuncio) return String(a.nombre_anuncio)
  if (titular && !GENERICOS.test(titular)) return titular
  const primera = String(a.texto || '').split('\n').map((l) => l.trim()).find(Boolean)
  return primera ? primera.slice(0, 60) : `Anuncio ${a.source_id || ''}`.trim()
}

/** Resumen corto del texto del anuncio. */
export function extractoDeAnuncio(a = {}, max = 90) {
  const t = String(a.texto || '').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

const ESTADOS = { ACTIVE: 'activo', PAUSED: 'pausado', ADSET_PAUSED: 'pausado', CAMPAIGN_PAUSED: 'pausado', ARCHIVED: 'archivado', DELETED: 'borrado' }
export const estadoDeAnuncio = (a = {}) => ESTADOS[a.estado_anuncio] || ''
