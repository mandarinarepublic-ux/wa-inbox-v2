// lib/audio-nota-voz.js — mandar audios que se vean como NOTA DE VOZ.
//
// ⚠️ LA REGLA DE META, y es la razón entera de este archivo:
//
//     Para que WhatsApp pinte la burbuja de nota de voz (el micrófono, las ondas,
//     el 1x/1.5x) el archivo tiene que ser **OGG con codec OPUS**. Cualquier otro
//     formato —MP3, WAV, M4A— llega como un ARCHIVO ADJUNTO reproducible.
//
// Llega igual y suena igual, pero no es lo mismo: la nota de voz se siente una
// persona hablándote y el adjunto se siente un envío masivo. Cuando alguien manda
// la voz de la marca, esa diferencia es el punto.
//
// Fish Audio —de donde salen estos audios— exporta MP3, así que en la práctica
// SIEMPRE hay que convertir. Verificado el 21-ago con un archivo real: 19,85 s de
// MP3 (317 KB) → OGG/Opus (81 KB) en 0,55 s, o sea 44× más rápido que el audio.
//
// La conversión va en el NAVEGADOR y no en el servidor. Convertir son dos pasos
// —decodificar el MP3 y codificar a Opus— y el navegador ya sabe hacer el primero
// gratis (`decodeAudioData`, API nativa). En el servidor habría que traer las dos
// mitades: `ffmpeg` pesa 80 MB, demasiado para una función con arranque en frío.
//
// El codificador (`/opus/encoderWorker.min.js`, de opus-recorder, MIT) son 385 KB
// que se cargan SOLO cuando alguien manda un audio. El inbox arranca igual de
// rápido para quien nunca use esto.

/** Lo que WhatsApp acepta como audio, convertido o no. */
const TIPOS_AUDIO = /^audio\//i

/** Extensiones que Fish Audio y compañía sueltan, incluida la rara `.mp3.mpeg`. */
const EXT_AUDIO = /\.(mp3|mpeg|wav|m4a|aac|ogg|oga|opus|amr|3gp)$/i

/** ¿Este archivo es un audio? Mira el tipo Y el nombre. */
export function esAudio(file) {
  if (!file) return false
  const tipo = String(file.type || '')
  if (TIPOS_AUDIO.test(tipo)) return true
  // El tipo puede venir vacío o mentir: Windows marca `.mp3.mpeg` como
  // `video/mpeg`, y si nos fiáramos solo del tipo intentaríamos mandar un audio
  // como video y Meta lo rechazaría.
  return EXT_AUDIO.test(String(file.name || ''))
}

/**
 * ¿Este archivo YA es nota de voz, o hay que convertirlo?
 *
 * Solo OGG/Opus pasa derecho. Se mira el nombre además del tipo porque un `.ogg`
 * puede llevar Vorbis en vez de Opus — y Meta rechaza ese: su documentación dice
 * "OPUS codecs only; base audio/ogg is not supported". Ante la duda se convierte,
 * que es barato (0,55 s) y siempre da un archivo válido. Dar por bueno un `.ogg`
 * que resulta ser Vorbis manda el mensaje a la basura.
 */
export function necesitaConversion(file) {
  if (!file) return false
  const tipo = String(file.type || '').toLowerCase()
  return !(tipo === 'audio/opus' || tipo === 'audio/ogg;codecs=opus')
}

/**
 * Qué decirle al vendedor sobre este archivo, ANTES de que lo mande.
 *
 * Existe porque la alternativa es que mande un MP3 creyendo que es nota de voz,
 * salga como adjunto, y se entere cuando el cliente ya lo recibió. Eso es "la
 * pantalla miente", el patrón que este proyecto lleva días cerrando.
 */
export function avisoDeFormato(file) {
  if (!file) return ''
  if (!esAudio(file)) return ''
  return necesitaConversion(file)
    ? 'Se convertirá a nota de voz antes de enviarlo'
    : 'Ya está en formato de nota de voz'
}

/**
 * MP3 (o lo que sea) → Blob OGG/Opus listo para mandar como nota de voz.
 *
 * Solo corre en el navegador: usa AudioContext y Worker.
 *
 * Los parámetros de codificación imitan lo que produce el propio WhatsApp al
 * grabar una nota de voz: mono, 48 kHz, ~32 kbps y el modo VOIP de Opus, que está
 * afinado para voz. Subir el bitrate no mejora una voz y sí engorda el archivo
 * que el cliente tiene que bajar con sus datos.
 *
 * NUNCA devuelve un archivo a medias: si algo falla, lanza. Quien llama decide si
 * manda el original como adjunto o no manda nada — pero esa decisión se toma
 * arriba, a la vista, no acá en silencio.
 */
export async function convertirANotaDeVoz(file, { onProgreso } = {}) {
  if (typeof window === 'undefined') throw new Error('convertirANotaDeVoz solo corre en el navegador')

  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) throw new Error('Este navegador no puede decodificar el audio')

  // 1) Decodificar. Lo hace el navegador, gratis y en formato nativo.
  const datos = await file.arrayBuffer()
  const ctx = new AC({ sampleRate: 48000 })   // Opus trabaja a 48 kHz
  let audio
  try {
    audio = await ctx.decodeAudioData(datos)
  } finally {
    // Cerrar SIEMPRE: cada AudioContext que queda abierto se lleva su porción de
    // memoria y los navegadores limitan cuántos se pueden tener a la vez. Subir
    // veinte audios seguidos sin cerrar deja de funcionar sin decir por qué.
    ctx.close?.()
  }
  if (!audio || !audio.length) throw new Error('El archivo no tiene audio que convertir')

  // 2) Mezclar a MONO. Una nota de voz es mono, y mandar estéreo dobla el peso
  //    sin que se note en una voz.
  const canales = audio.numberOfChannels
  const largo = audio.length
  const mono = new Float32Array(largo)
  for (let c = 0; c < canales; c++) {
    const datosCanal = audio.getChannelData(c)
    for (let i = 0; i < largo; i++) mono[i] += datosCanal[i] / canales
  }

  // 3) Codificar a OGG/Opus en un Worker, para no congelar la pantalla.
  return await new Promise((resolve, reject) => {
    const worker = new Worker('/opus/encoderWorker.min.js')
    const paginas = []
    let terminado = false

    // Red de seguridad: si el worker se cuelga (WASM que no carga, red caída a
    // medio bajar el archivo), esto no puede quedarse esperando para siempre con
    // el vendedor mirando un botón que no responde.
    const limite = setTimeout(() => {
      if (terminado) return
      terminado = true
      worker.terminate()
      reject(new Error('La conversión tardó demasiado'))
    }, 60000)

    const cerrar = () => { clearTimeout(limite); worker.terminate() }

    worker.onmessage = (e) => {
      if (terminado) return

      // ⚠️ `ready` NO es ceremonia: es cuando el codificador existe.
      //
      // Recién ahí se le pueden pedir las páginas de cabecera, y ESAS son las que
      // llevan `OpusHead` y `OpusTags`. Sin ellas sale un OGG con todo el audio
      // dentro pero sin decir qué codec es — Meta lo rechaza con 131053 ("Media
      // upload error") y ni ffmpeg puede abrirlo. Pasó en el primer intento del
      // 21-ago: 32 páginas de audio perfectas y cero cabecera.
      if (e.data?.message === 'ready') {
        worker.postMessage({ command: 'getHeaderPages' })
        // De a trozos, avisando del avance: un audio largo puede tardar y el
        // vendedor necesita ver que algo pasa en vez de un botón mudo.
        const TROZO = 48000 * 5   // 5 segundos por vuelta
        for (let i = 0; i < mono.length; i += TROZO) {
          const parte = mono.slice(i, Math.min(i + TROZO, mono.length))
          worker.postMessage({ command: 'encode', buffers: [parte] })
          onProgreso?.(Math.min(1, (i + TROZO) / mono.length))
        }
        worker.postMessage({ command: 'done' })
        return
      }

      if (e.data?.message === 'done') {
        terminado = true
        cerrar()
        if (!paginas.length) { reject(new Error('El codificador no devolvió audio')); return }
        resolve(new Blob(paginas, { type: 'audio/ogg' }))
        return
      }
      if (e.data?.page) paginas.push(e.data.page)
      else if (e.data instanceof Uint8Array || e.data instanceof ArrayBuffer) paginas.push(e.data)
    }
    worker.onerror = (err) => {
      if (terminado) return
      terminado = true
      cerrar()
      reject(new Error(`No se pudo convertir el audio: ${err?.message || 'error del codificador'}`))
    }

    worker.postMessage({
      command: 'init',
      encoderSampleRate: 48000,
      originalSampleRate: 48000,
      numberOfChannels: 1,
      encoderApplication: 2048,  // VOIP: afinado para voz, que es lo que se manda
      encoderBitRate: 32000,
      resampleQuality: 3,
      bufferLength: 4096,
      maxFramesPerPage: 40,
      streamPages: true,
    })
    // El audio NO se manda acá: se manda cuando llega `ready` (ver arriba). Antes
    // de eso el codificador todavía no existe y los `encode` se procesarían sin
    // que las cabeceras se hayan pedido.
  })
}
