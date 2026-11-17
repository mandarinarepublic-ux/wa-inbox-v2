// lib/pieza-respuesta.js — Las piezas de UNA respuesta rápida, como salen a mano.
//
// Una sola función para todo lo automático que manda una respuesta rápida suelta
// (respuestas simples y el agente de IA): texto con botones, carrusel de productos,
// formulario de WhatsApp y después sus fotos/audios/documentos, en el orden que
// cargó el vendedor.
//
// El trabajo pesado es de `piezasDeNodos` (lib/flujo.js), que ya sabe de
// carruseles. `piezasDeReceta` NO sabe: con ella un carrusel salía como texto solo.
// Acá solo se suma el formulario, que el lienzo todavía no manda.
import { piezasDeNodos } from './flujo.js'
import { formularioValido } from './formularios.js'

/**
 * @param {object} r         respuesta rápida ya leída (getRespuestas → toRespuesta)
 * @param {object} contacto  { telefono, nombre, alias, phoneId }
 * @param {string} citaId    wamid del mensaje del cliente al que se responde
 */
export function piezasDeRespuestaRapida(r, contacto, citaId = '') {
  if (!r) return []
  const piezas = piezasDeNodos({
    nodos: [{ datos: { origen: 'respuesta', respuestaId: r.id } }],
    respuestas: [r], contacto, citaId,
  })
  const clave = formularioValido(r.formulario)
  const texto = String(r.text || '').trim()
  if (clave && texto && piezas.length) {
    // Con formulario, el texto sale COMO formulario (texto + botón que lo abre).
    const { Mensaje, BotonesInteractivos, Botones, TipoMensaje, Cuerpo, Productos, ...resto } = piezas[0]
    piezas[0] = { ...resto, TipoMensaje: 'flow', Cuerpo: texto, Formulario: clave }
  }
  return piezas
}
