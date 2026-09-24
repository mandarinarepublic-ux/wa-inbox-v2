// lib/overrides.js — cambios optimistas que el poll no puede pisar.
//
// Al tocar un botón (etapa, 📌, 🤫…) la pantalla cambia al instante, pero la
// lectura siguiente puede venir del caché del edge (s-maxage=5 + swr=20 → hasta
// 25 s de respuesta vieja) y "revertir" el botón solo. Ya pasó con el estado y la
// temperatura. Cada cambio vive 35 s por encima de lo que traiga el poll.
//
// Módulo PURO.
export const TTL_OVERRIDE_MS = 35000

/** Suma campos al override de un teléfono, conservando los que siguen vigentes. */
export function sumarOverride(overrides, tel, campos, ahoraMs = Date.now(), ttl = TTL_OVERRIDE_MS) {
  const previo = overrides?.[tel]
  const vigentes = previo && Number(previo.expiresAt) > ahoraMs ? previo.campos : {}
  return { ...overrides, [tel]: { campos: { ...vigentes, ...campos }, expiresAt: ahoraMs + ttl } }
}

/** Aplica los overrides vigentes sobre el mapa de contactos que trajo el poll. */
export function aplicarOverrides(mapa, overrides, ahoraMs = Date.now()) {
  const out = { ...mapa }
  for (const [tel, o] of Object.entries(overrides || {})) {
    if (!o || !(Number(o.expiresAt) > ahoraMs) || !out[tel]) continue
    out[tel] = { ...out[tel], ...o.campos }
  }
  return out
}
