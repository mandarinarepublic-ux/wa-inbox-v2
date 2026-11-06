// lib/transcribir-navegador.js — 📝 Pasa una nota de voz a texto EN ESTE EQUIPO.
//
// El audio nunca sale a un servicio de voz: se decodifica acá y Whisper corre en un
// Worker (public/transcribir/worker.js). Lo único que se baja es el modelo, una vez
// por equipo; el navegador lo deja guardado.

const MUESTREO_WHISPER = 16000 // Whisper solo entiende audio a 16 kHz
const MEMORIA_MINIMA_GB = 4

let worker = null
let cola = Promise.resolve() // de una en una: el modelo no aguanta dos a la vez
let oyentes = null           // { onEstado, resolver, rechazar } de la nota en curso

function obtenerWorker() {
  if (worker) return worker
  worker = new Worker('/transcribir/worker.js', { type: 'module' })
  worker.onmessage = ({ data }) => {
    if (!oyentes) return
    if (data.tipo === 'estado') oyentes.onEstado(data)
    else if (data.tipo === 'listo') oyentes.resolver(data.texto)
    else if (data.tipo === 'error') oyentes.rechazar(new Error(data.error))
  }
  // Se cayó entero (sin memoria, sin internet para la librería): se descarta para
  // que el próximo intento arranque limpio en vez de quedarse esperando para siempre.
  worker.onerror = (e) => {
    worker?.terminate()
    worker = null
    oyentes?.rechazar(new Error(e.message || 'No se pudo cargar el transcriptor'))
  }
  return worker
}

async function decodificar(src) {
  const res = await fetch(src)
  if (!res.ok) throw new Error('Este audio ya no está disponible')
  const bytes = await res.arrayBuffer()
  const ctx = new AudioContext({ sampleRate: MUESTREO_WHISPER })
  try {
    const audio = await ctx.decodeAudioData(bytes)
    return new Float32Array(audio.getChannelData(0))
  } catch {
    throw new Error('Este navegador no puede leer este audio')
  } finally {
    ctx.close()
  }
}

/**
 * Devuelve el texto de la nota de voz ('' si no se entendió nada).
 * `onEstado` recibe { fase: 'cola' | 'descarga' | 'cargando' | 'transcribiendo', pct? }.
 */
export function transcribirNota(src, onEstado = () => {}) {
  // El modelo ocupa ~1,3 GB (medido). Un equipo justo podría matar la pestaña entera
  // del inbox, y eso cuesta más que no tener el texto. `deviceMemory` no existe en
  // Safari ni Firefox: ahí se intenta.
  if (navigator.deviceMemory && navigator.deviceMemory < MEMORIA_MINIMA_GB) {
    return Promise.reject(new Error('Este equipo no tiene memoria suficiente para transcribir. Prueba desde una compu.'))
  }
  onEstado({ fase: 'cola' })
  const turno = cola.then(async () => {
    const audio = await decodificar(src)
    return new Promise((resolver, rechazar) => {
      oyentes = { onEstado, resolver, rechazar }
      obtenerWorker().postMessage({ audio }, [audio.buffer])
    })
  })
  cola = turno.catch(() => {}) // un error no le tranca el turno a la siguiente nota
  return turno
}
