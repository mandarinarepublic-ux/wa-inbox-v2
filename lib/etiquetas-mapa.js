// lib/etiquetas-mapa.js — el mapa de etiquetas en el formato en que VIAJA.
//
// Con "Pauta" puesta a ~2.000 chats, { telefono: [ids] } pesaba ~40 kB en cada
// inbox-sync (la ruta más cara de Vercel). Viaja al revés y en texto:
//   { "1": "593…,593…", "2": "593…" }   (inbox.etiquetas_compacto, ~26 kB)
// y la pantalla lo expande acá. Módulo PURO (lo usa el navegador).

/** { etiqueta_id: "tel,tel" } → { telefono: [etiqueta_id, …] } */
export function expandirEtiquetas(compacto) {
  const mapa = {}
  if (!compacto || typeof compacto !== 'object') return mapa
  for (const [id, tels] of Object.entries(compacto)) {
    const n = Number(id)
    if (!Number.isFinite(n) || n <= 0) continue
    for (const tel of String(tels || '').split(',')) {
      if (!tel) continue
      ;(mapa[tel] ||= []).push(n)
    }
  }
  return mapa
}
