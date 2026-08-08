// Arrastrar el asa que ensancha el panel derecho, con un iframe al lado.
//
// ⚠️ El problema que resuelve esto: el formulario del CRM es un iframe de OTRO
// origen. Mientras el puntero está encima de él, los eventos del mouse los recibe
// el documento del CRM y NO el nuestro. Si el botón se suelta ahí, nuestro
// `mouseup` NUNCA llega: el arrastre queda "pegado" en true y, a partir de ese
// momento, mover el mouse sin apretar nada redimensiona el panel. Es exactamente
// lo que reportó Rodrigo: "solo pasar el mouse por encima hace que se afecte el
// tamaño de la ventana sin que yo quiera".
//
// La defensa principal es tapar el iframe con una capa transparente mientras se
// arrastra. Esto de acá es el cinturón: aunque el `mouseup` se pierda por
// cualquier otra vía (soltar fuera de la ventana, un alt+tab, algo que no
// previmos), el primer movimiento sin botón apretado corta el arrastre.

/**
 * Qué hacer con un movimiento mientras se cree que se está arrastrando.
 *
 * - `botones`: el `e.buttons` del evento de mouse. `0` = ningún botón apretado,
 *   o sea que el `mouseup` se perdió en el camino.
 * - En un evento táctil no existe `buttons` (llega `undefined`): ahí no se puede
 *   deducir nada y se sigue moviendo, que es lo correcto — el táctil no tiene
 *   este agujero porque los `touchmove`/`touchend` van siempre al elemento donde
 *   empezó el toque, aunque el dedo pase por encima del iframe.
 *
 * @returns {'mover'|'soltar'|'nada'}
 */
export function decidirArrastre({ arrastrando, botones }) {
  if (!arrastrando) return 'nada'
  if (botones === 0) return 'soltar'
  return 'mover'
}
