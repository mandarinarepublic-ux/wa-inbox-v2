// lib/plantilla-nueva.js — Arma y valida una plantilla NUEVA antes de mandarla a Meta.
//
// Por qué existe (24-sep-2026): la WABA de REPUBLIC tiene CERO plantillas, así que
// fuera de la ventana de 24 h ese número no puede escribirle a nadie. Y la revisión
// de la app (acceso avanzado, que es lo que destraba la coexistencia) pide mostrar
// que la app ADMINISTRA plantillas. Crearlas desde el inbox resuelve las dos cosas.
//
// Las plantillas son de la WABA, no de la marca: quien llama pasa la WABA del canal.
//
// Validamos acá lo que Meta rechaza con mensajes poco claros, para que el error
// salga en español y antes de gastar una llamada.

export const CATEGORIAS = ['MARKETING', 'UTILITY']
export const IDIOMAS = ['es', 'es_EC', 'es_ES', 'es_MX', 'en_US']

const TOPE_CUERPO = 1024
const TOPE_PIE = 60

/** "Seguimiento Pedido!" → "seguimiento_pedido". Meta solo acepta [a-z0-9_]. */
export function normalizarNombre(txt) {
  return String(txt || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 512)
}

/** Números de las variables {{n}} del texto, sin repetir y en orden. */
export function variablesDe(txt) {
  const m = String(txt || '').match(/\{\{\s*(\d+)\s*\}\}/g) || []
  return [...new Set(m.map((s) => Number(s.replace(/\D/g, ''))))].sort((a, b) => a - b)
}

/**
 * { nombre, categoria, idioma, cuerpo, ejemplos[], pie } → { ok, payload } | { ok:false, errores[] }
 * `payload` es exactamente lo que va en POST /{waba}/message_templates.
 */
export function armarPlantilla(datos = {}) {
  const errores = []
  const name = normalizarNombre(datos.nombre)
  const category = String(datos.categoria || '').toUpperCase()
  const language = String(datos.idioma || 'es')
  const cuerpo = String(datos.cuerpo || '').trim()
  const pie = String(datos.pie || '').trim()
  const ejemplos = (Array.isArray(datos.ejemplos) ? datos.ejemplos : []).map((e) => String(e || '').trim())

  if (!name) errores.push('Falta el nombre.')
  if (!CATEGORIAS.includes(category)) errores.push('La categoría tiene que ser MARKETING o UTILITY.')
  if (!IDIOMAS.includes(language)) errores.push(`Idioma no soportado: ${language}.`)
  if (!cuerpo) errores.push('Falta el texto del mensaje.')
  if (cuerpo.length > TOPE_CUERPO) errores.push(`El texto pasa de ${TOPE_CUERPO} caracteres.`)
  if (pie.length > TOPE_PIE) errores.push(`El pie pasa de ${TOPE_PIE} caracteres.`)

  // Meta exige variables consecutivas desde {{1}} y un ejemplo por cada una;
  // y rechaza un texto que EMPIEZA o TERMINA en variable.
  const vars = variablesDe(cuerpo)
  if (vars.some((n, i) => n !== i + 1)) errores.push('Las variables tienen que ir seguidas desde {{1}}: {{1}}, {{2}}, …')
  if (vars.length && /^\{\{\s*\d+\s*\}\}/.test(cuerpo)) errores.push('El texto no puede empezar con una variable.')
  if (vars.length && /\{\{\s*\d+\s*\}\}[.!?\s]*$/.test(cuerpo)) errores.push('El texto no puede terminar con una variable.')
  const faltanEjemplos = vars.filter((_, i) => !ejemplos[i])
  if (faltanEjemplos.length) errores.push(`Falta el ejemplo de ${faltanEjemplos.map((n) => `{{${n}}}`).join(', ')}.`)

  if (errores.length) return { ok: false, errores }

  const body = { type: 'BODY', text: cuerpo }
  if (vars.length) body.example = { body_text: [ejemplos.slice(0, vars.length)] }
  const components = [body]
  if (pie) components.push({ type: 'FOOTER', text: pie })

  return { ok: true, payload: { name, category, language, components } }
}
