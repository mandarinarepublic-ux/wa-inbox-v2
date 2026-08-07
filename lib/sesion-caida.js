// Detectar que la sesión se cayó, en UN solo lugar.
//
// Por qué existe: el 7-ago-2026, al encender el candado, tres mensajes salientes
// murieron con 401 y la pantalla solo dijo "no se pudo enviar". Quien atendía lo
// vivió como "se perdieron 3 chats" en vez de "tengo que volver a entrar", y los
// reenvió a mano. El candado hizo lo suyo; lo que faltó fue avisar.
//
// Por qué se intercepta `fetch` en vez de tocar cada llamada: hay 25 en
// lib/api-client.js y más sueltas en los componentes (App.jsx, Notas, RightPanel).
// Parchear una por una garantiza olvidarse de alguna, y justo la olvidada sería
// la que falle en silencio. Acá se engancha una vez y quedan cubiertas todas,
// incluidas las que se escriban después.
//
// Solo mira NUESTRAS rutas `/api/…` del mismo origen: la subida firmada a
// Supabase Storage (`/api/upload-url` devuelve una URL externa) también puede dar
// 401 y ese no es un problema de sesión.

let avisados = []
let caida = false

/** ¿Esta petición es a una API nuestra? Las externas no dicen nada de la sesión. */
function esApiPropia(input) {
  try {
    const url = typeof input === 'string' ? input : (input?.url || String(input))
    // Relativa ('/api/…') o absoluta contra nuestro propio origen.
    if (url.startsWith('/api/')) return true
    if (typeof window === 'undefined') return false
    const u = new URL(url, window.location.href)
    return u.origin === window.location.origin && u.pathname.startsWith('/api/')
  } catch { return false }
}

/** Avisar a quien esté escuchando. Se dispara UNA vez: no queremos 30 avisos. */
function marcarCaida() {
  if (caida) return
  caida = true
  for (const fn of avisados) { try { fn() } catch {} }
}

/** Suscribirse. Devuelve la función para darse de baja. */
export function alCaerLaSesion(fn) {
  avisados.push(fn)
  // Si ya se cayó antes de que este componente se montara, avisarle igual.
  if (caida) { try { fn() } catch {} }
  return () => { avisados = avisados.filter((f) => f !== fn) }
}

export function sesionCaida() { return caida }

/**
 * Engancha el detector. Idempotente: llamarlo dos veces no encadena dos parches.
 *
 * NO cambia ninguna respuesta ni traga errores: mira el código y devuelve la
 * respuesta intacta. Si algo falla acá dentro, el fetch original sigue su curso.
 */
export function vigilarSesion() {
  if (typeof window === 'undefined') return
  if (window.__vigilaSesion) return
  window.__vigilaSesion = true

  const original = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const res = await original(input, init)
    try {
      // 401 = no hay sesión. 403 = hay sesión pero sin permiso para este inbox.
      if ((res.status === 401 || res.status === 403) && esApiPropia(input)) marcarCaida()
    } catch {}
    return res
  }
}
