/**
 * Decidir qué hacer con los archivos que entran a la caja de escribir.
 *
 * Hay TRES puertas por las que llega una foto y las tres terminan en el mismo
 * sitio (`imgFiles` → `handleSendImage`): el 📎 de siempre, Ctrl+V y arrastrar.
 * Lo único que cambia entre ellas es de dónde se sacan los archivos; lo que se
 * hace con ellos es esto, en un solo lugar, para que pegar no pueda comportarse
 * distinto que adjuntar.
 *
 * Todo acá es puro (no toca el DOM ni React) justamente para poder probarlo.
 */

// El tope de siempre del envío por tanda. No es decorativo: cada foto sale con
// una pausa de 800ms, y una tanda más larga tiene más chance de cruzarse con la
// ventana de 24h o con el límite de Meta.
export const TOPE_FOTOS = 10

import { esAudio } from './audio-nota-voz.js'

export const esImagen = (tipo) => String(tipo || '').startsWith('image/')
export const esVideo  = (tipo) => String(tipo || '').startsWith('video/')

/**
 * ¿Un Ctrl+V es texto o es un adjunto?
 *
 * ⚠️ La trampa: al copiar celdas de Excel o de Sheets, Windows deja en el
 * portapapeles el texto Y una imagen de las celdas. Si se mirara solo "¿hay
 * archivos?", copiar un número de pedido de una hoja pegaría una CAPTURA de la
 * hoja en el chat del cliente en vez del número. Por eso manda el texto cuando
 * lo hay: un archivo copiado del Explorador no trae texto, y una captura de
 * pantalla tampoco.
 */
export function decidirPegado({ tieneArchivos = false, texto = '' } = {}) {
  if (String(texto || '').trim()) return 'texto'
  return tieneArchivos ? 'adjuntar' : 'texto'
}

/**
 * Qué hacer con los archivos que acaban de entrar, sabiendo lo que ya estaba
 * seleccionado.
 *
 * Devuelve `{ accion, tipo, archivos, aviso }`:
 *  - `accion`: 'nada' | 'reemplazar' | 'agregar'
 *  - `tipo`  : 'imagen' | 'video'  (solo importa si no es 'nada')
 *  - `aviso` : texto para el vendedor, o '' si no hay nada que decir.
 *
 * El `aviso` no es adorno: sin él, pegar un PDF o pasarse de 10 no hace
 * absolutamente nada en pantalla y parece que el inbox se rompió.
 */
export function decidirAdjuntos({ actuales = 0, esVideoActual = false, entrantes = [], tope = TOPE_FOTOS } = {}) {
  const nada = { accion: 'nada', tipo: '', archivos: [], aviso: '' }
  const lista = Array.from(entrantes || [])
  if (!lista.length) return nada

  const sirven = lista.filter(f => esImagen(f?.type) || esVideo(f?.type) || esAudio(f))
  if (!sirven.length) {
    return { ...nada, aviso: 'Eso no es una foto, un video ni un audio — por acá solo se pueden mandar esos tres.' }
  }

  // Un AUDIO va SOLO, y se decide ANTES que el video a propósito: Fish Audio
  // suelta archivos `.mp3.mpeg` que Windows marca como `video/mpeg`. Si el video
  // se mirara primero, ese audio se mandaría como video y Meta lo rechazaría.
  // `esAudio` mira el nombre además del tipo justo por eso.
  const audio = sirven.find(f => esAudio(f))
  if (audio) {
    return {
      accion: 'reemplazar', tipo: 'audio', archivos: [audio],
      aviso: sirven.length > 1 ? 'El audio va solo: se dejó ese y se ignoró el resto.' : '',
    }
  }

  // Un video va SOLO: se manda por otro camino (`sendVideo`) y de a uno. Si
  // entra un video, se lleva por delante lo que hubiera.
  const video = sirven.find(f => esVideo(f.type))
  if (video) {
    return {
      accion: 'reemplazar', tipo: 'video', archivos: [video],
      aviso: sirven.length > 1 ? 'El video va solo: se dejó ese y se ignoró el resto.' : '',
    }
  }

  const fotos = sirven
  const descartados = lista.length - sirven.length
  const avisoMezcla = descartados > 0
    ? `Se tomaron ${fotos.length} imagen${fotos.length > 1 ? 'es' : ''}; el resto no era foto ni video.`
    : ''

  // Si lo que había era un video, las fotos no se le suman: lo reemplazan.
  if (esVideoActual || actuales <= 0) {
    const recorte = fotos.slice(0, tope)
    return {
      accion: 'reemplazar', tipo: 'imagen', archivos: recorte,
      aviso: fotos.length > tope ? `Solo caben ${tope} fotos por tanda: se tomaron las primeras ${tope}.` : avisoMezcla,
    }
  }

  // Caso normal de pegar/arrastrar: se SUMAN a lo que ya estaba. Pegar dos
  // capturas seguidas tiene que dejar dos fotos en la cola, no la última.
  const espacio = tope - actuales
  if (espacio <= 0) {
    return { ...nada, aviso: `Ya tienes ${tope} fotos en la tanda — manda esas primero.` }
  }
  const recorte = fotos.slice(0, espacio)
  return {
    accion: 'agregar', tipo: 'imagen', archivos: recorte,
    aviso: fotos.length > espacio ? `Solo caben ${tope} fotos por tanda: se agregaron ${espacio}.` : avisoMezcla,
  }
}
