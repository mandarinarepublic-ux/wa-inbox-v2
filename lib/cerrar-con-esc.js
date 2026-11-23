// ⎋ Cerrar ventanas con la tecla Esc (22-nov-2026, web-design-guidelines tanda 3).
//
// Las ventanas (reenviar, carrusel, etiquetas, contactos, guía, la foto ampliada…)
// se cerraban solo con la ✕ o tocando el fondo. Esc hace lo MISMO que tocar el
// fondo, nada más: no cancela un envío que ya salió ni toca la caja de texto.
//
// ☠️ Con dos ventanas abiertas a la vez (la foto ampliada encima de otra), Esc
// cierra SOLO la de más arriba: por eso hay una pila y un único oyente, en vez de
// que cada ventana escuche por su cuenta y se cierren todas de un golpe.
import { useEffect, useRef } from 'react'

const pila = []

/** Apila una ventana abierta. Devuelve la función que la desapila. */
export function registrarEsc(cerrar) {
  pila.push(cerrar)
  return () => {
    const i = pila.lastIndexOf(cerrar)
    if (i >= 0) pila.splice(i, 1)
  }
}

/** Cierra la ventana de más arriba si la tecla es Esc. true si cerró algo. */
export function manejarTeclaEsc(e) {
  if (!e || e.key !== 'Escape' || e.isComposing || pila.length === 0) return false
  pila[pila.length - 1]()
  return true
}

let escuchando = false
function escucharUnaVez() {
  if (escuchando || typeof document === 'undefined') return
  escuchando = true
  document.addEventListener('keydown', (e) => {
    if (manejarTeclaEsc(e)) { e.preventDefault(); e.stopPropagation() }
  })
}

/**
 * La ventana se cierra con Esc mientras `activo` sea true (o sea, mientras se ve).
 * `onCerrar` puede cambiar en cada render: siempre se llama a la más reciente.
 */
export function useCerrarConEsc(onCerrar, activo = true) {
  const ref = useRef(onCerrar)
  ref.current = onCerrar
  useEffect(() => {
    if (!activo) return
    escucharUnaVez()
    return registrarEsc(() => ref.current?.())
  }, [activo])
}
