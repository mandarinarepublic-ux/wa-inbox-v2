// 📝 Whisper en el navegador: el audio se queda en este equipo. Ver lib/transcribir-navegador.js.
// Lo único que se baja es la librería (versión fija) y el modelo; el navegador los guarda.
// Va fuera del candado de sesión en middleware.js: no tiene nada privado.
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js'

env.allowLocalModels = false

// Elegido con 6 notas reales de MANDI (6-nov-2026), no por la tabla de pesos:
//   whisper-base            → 73 MB, pero se inventa palabras y entra en bucle ("Hola. Hola…")
//   whisper-small q8 entero → pierde frases enteras: la compresión daña al encoder
//   small en WebGPU         → con decoder q8 sale basura en varios idiomas
// Por eso: small, encoder sin comprimir y decoder q8, en el procesador. Unos 485 MB y
// 20-30 s por nota en una compu de 8 hilos.
const MODELO = 'onnx-community/whisper-small'

let transcriptor = null

function avisarDescarga() {
  const archivos = {}
  return (p) => {
    if (p.status !== 'progress' || !p.total) return
    archivos[p.file] = { cargado: p.loaded, total: p.total }
    const lista = Object.values(archivos)
    const cargado = lista.reduce((s, a) => s + a.cargado, 0)
    const total = lista.reduce((s, a) => s + a.total, 0)
    self.postMessage({ tipo: 'estado', fase: 'descarga', pct: Math.floor((cargado / total) * 100) })
  }
}

async function obtenerTranscriptor() {
  if (transcriptor) return transcriptor
  self.postMessage({ tipo: 'estado', fase: 'cargando' })
  transcriptor = await pipeline('automatic-speech-recognition', MODELO, {
    device: 'wasm',
    dtype: { encoder_model: 'fp32', decoder_model_merged: 'q8' },
    progress_callback: avisarDescarga(),
  })
  return transcriptor
}

self.onmessage = async ({ data: { audio } }) => {
  try {
    const transcribir = await obtenerTranscriptor()
    self.postMessage({ tipo: 'estado', fase: 'transcribiendo' })
    const { text } = await transcribir(audio, {
      language: 'spanish',
      task: 'transcribe',
      // Notas largas: se parten en tramos de 30 s que se pisan 5 s para no cortar palabras.
      chunk_length_s: 30,
      stride_length_s: 5,
      // Sin esto Whisper puede repetir la misma frase hasta llenar el texto.
      no_repeat_ngram_size: 3,
    })
    self.postMessage({ tipo: 'listo', texto: text })
  } catch (err) {
    self.postMessage({ tipo: 'error', error: 'No se pudo transcribir: ' + (err?.message || err) })
  }
}
