// lib/flujos.js — FLUJOS: capa de servidor (Supabase + validación al publicar +
// importación de recetas). Ver docs/superpowers/specs/2026-09-15-flujos-lienzo-design.md
// y lib/flujo.js (el módulo puro: validarFlujo, choquesDeDisparador, recetaAFlujo).
//
// ⚠️ `planDeImportacion` es PURO a propósito (probado en tests/flujos-importar.test.js
// sin tocar Supabase): importar este archivo no debe abrir conexión, así que las
// funciones async solo llaman a getSupabase() (perezoso, vía inbox-supabase.js)
// cuando de verdad corren, nunca al cargar el módulo.
import * as SB from './inbox-supabase.js'
import { validarFlujo, choquesDeDisparador, recetaAFlujo } from './flujo.js'
import { getRespuestas } from './respuestas.js'
import { getAutomatizaciones, setAutomatizaciones } from './automatizaciones.js'

export async function getFlujos() {
  return SB.getFlujosSupabase()
}

export async function guardarFlujo({ flujo_id, nombre, grafo }) {
  return SB.guardarFlujoSupabase({ flujo_id, nombre, grafo })
}

export async function borrarFlujo(flujo_id) {
  return SB.borrarFlujoSupabase(flujo_id)
}

/**
 * publicar=true: valida el borrador (con las respuestas rápidas vivas) y lo cruza
 * contra el Disparador de los DEMÁS flujos publicados. Cualquier error → NO publica
 * y devuelve `{ ok:false, errores }` (misma forma que validarFlujo, más los choques
 * con `flujoId` de a quién choca). publicar=false solo despublica (deja el borrador).
 */
export async function publicarFlujo(flujo_id, publicar) {
  if (!publicar) {
    return SB.setPublicadoFlujoSupabase(flujo_id, false)
  }

  const flujos = await SB.getFlujosSupabase()
  const fila = flujos.find((f) => String(f.flujo_id) === String(flujo_id))
  if (!fila) return { ok: false, errores: [{ texto: 'ese flujo ya no existe' }] }

  const respuestas = await getRespuestas()
  const errores = validarFlujo(fila.grafo, { respuestas })

  const publicados = await SB.getFlujosPublicadosSupabase()
  const otros = publicados.filter((f) => String(f.flujo_id) !== String(flujo_id))
  for (const choque of choquesDeDisparador(fila.grafo, otros)) {
    errores.push({ flujoId: choque.flujoId, texto: `choca con "${choque.nombre}" (${choque.motivo})` })
  }

  if (errores.length) return { ok: false, errores }

  await SB.setPublicadoFlujoSupabase(flujo_id, true)
  return { ok: true }
}

/**
 * PURO: por cada receta de `config.recetas.lista`, junta los `source_id` de
 * `por_anuncio` que apuntan a ella, si es la del orgánico, si queda publicada
 * (`recetas.activo && receta.activa`) y si ya existe un flujo con el nombre que
 * le tocaría (`[receta] <nombre>`) — eso es lo que hace idempotente a importarRecetas.
 */
export function planDeImportacion(config, flujosExistentes) {
  const recetasCfg = config?.recetas || {}
  const activo = !!recetasCfg.activo
  const porAnuncio = recetasCfg.por_anuncio || {}
  const lista = Array.isArray(recetasCfg.lista) ? recetasCfg.lista : []
  const existentes = Array.isArray(flujosExistentes) ? flujosExistentes : []

  return lista.map((receta) => {
    const organico = String(porAnuncio.organico ?? '') === String(receta.id)
    const sourceIds = Object.keys(porAnuncio)
      .filter((k) => k !== 'organico' && String(porAnuncio[k]) === String(receta.id))
    const publicado = activo && !!receta.activa
    const nombre = `[receta] ${receta?.nombre || ''}`.trim()
    const yaExiste = existentes.some((f) => f?.nombre === nombre)
    return { receta, sourceIds, organico, publicado, yaExiste }
  })
}

/**
 * Conversión ÚNICA de las recetas de bienvenida a flujos (spec §7). Idempotente:
 * una receta que ya tiene su flujo (`[receta] <nombre>`) se salta. Al final apaga
 * `recetas.activo` para que el motor viejo deje de correr en paralelo del nuevo.
 */
export async function importarRecetas() {
  const config = await getAutomatizaciones()
  const existentes = await SB.getFlujosSupabase()
  const plan = planDeImportacion(config, existentes)

  let creados = 0
  let saltados = 0
  for (const item of plan) {
    if (item.yaExiste) { saltados++; continue }
    const { grafo, publicado } = recetaAFlujo(item.receta, {
      sourceIds: item.sourceIds,
      organico: item.organico,
      publicado: item.publicado,
    })
    const nombre = `[receta] ${item.receta?.nombre || ''}`.trim()
    const fila = await SB.guardarFlujoSupabase({ nombre, grafo })
    if (publicado) await SB.setPublicadoFlujoSupabase(fila.flujo_id, true)
    creados++
  }

  await setAutomatizaciones({ recetas: { activo: false } })
  return { ok: true, creados, saltados }
}
