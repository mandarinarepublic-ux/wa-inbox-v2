# HANDOFF · 18-sep-2026 · Reenviar mensajes a otro chat (MANDI e IND)

**Qué es:** en el chat, cada mensaje tiene un botón **↪** al costado de la burbuja. Abre un buscador
de conversaciones y manda ese mismo contenido a la que elijas. Tocar la burbuja sigue mostrando
"↩ Responder" debajo, como antes.

## ☠️ Lo que Meta NO permite (y por eso el alcance es este)

Se verificó contra la documentación de la Cloud API antes de diseñar:

- **No hay endpoint para EDITAR** un mensaje ya enviado por la API.
- **No hay endpoint para BORRAR** ("eliminar para todos") un mensaje ya enviado por la API.
- **No existe "reenviar"**: no hay bandera `forwarded` ni operación de reenvío. Reenviar es mandar el
  mismo contenido otra vez, como mensaje nuevo. Por eso no se le agrega ningún prefijo inventado.

⚠️ **Editar y borrar SÍ ocurren, del lado del cliente**, y Meta nos avisa por webhook (solo en
coexistencia): editar hasta 15 min después, borrar hasta 2 días después. En 60 días IND recibió
**242 ediciones y 112 borrados**, y hasta salieron 35 ediciones hechas desde el celular. Hoy el inbox
pinta una fila nueva ("✏️ Editó un mensaje" / "🚫 Eliminó un mensaje") y **deja el texto viejo tal
cual**: si alguien quiere que el inbox muestre lo que el cliente ve de verdad, ese es el trabajo
pendiente, y los datos ya están llegando.

## Qué se reenvía y qué no

| Tipo | Qué sale |
|---|---|
| Texto | El mismo texto |
| Foto, video | El archivo, con su pie de foto si tenía |
| Nota de voz, documento | El archivo (el documento conserva su nombre) |
| Ubicación | Texto con coordenadas y enlace a Google Maps |
| Pedido del catálogo, reacción, aviso de edición o borrado, aviso de WhatsApp, sticker, `unsupported` | No se reenvía: el botón ni aparece |

☠️ **Un medio sin `mediaUrl` NO se reenvía.** Los entrantes llegan con `mediaId` de Meta y su URL
estable aparece recién cuando termina el archivado a nuestro Storage. Además ese id es de NUESTRO
número: mandarlo a un chat de otro número es apostar a que Meta lo acepte.

## Reglas que respeta

- **El canal es el del chat DESTINO.** No el de la pestaña ni el del chat de origen.
- **Ventana de 24 h por destino:** los chats cerrados salen deshabilitados con el motivo escrito.
  Ofrecerlos habilitados es cómo se pierden mensajes en silencio (Meta acepta la llamada y el
  `failed` llega después, error 131047).
- **El mismo teléfono por otro número es otro destino.** Son conversaciones separadas.
- **No se cita el original** en el destino: llega como mensaje nuevo.

## Dónde vive cada cosa

| pieza | archivo |
|---|---|
| Decisión pura (qué se puede reenviar, en qué piezas, a qué chats) | `lib/reenvio.js` · `tests/reenvio.test.js` (19 pruebas) |
| Botón ↪ en la burbuja | `components/Components.jsx` (`MessageBubble`, prop `onReenviar`) |
| Buscador de destino y envío | `components/App.jsx` (`reenviando`, `destinosReenvio`, `confirmarReenvio`) |
| Envío | `reenviarPieza` en `lib/api-client.js` → `/api/saliente` (sin cambios en el backend) |

Los archivos `lib/reenvio.js` y `tests/reenvio.test.js` son IDÉNTICOS en los dos repos; la burbuja y
la pantalla divergen por la paleta (MANDI verde, IND crema).

## Estado

- Pruebas: MANDI 682 · IND 629, y `next build` limpio en los dos.
- Commits: MANDI `221923a` · IND `81426b9`.
- ⏳ Falta probarlo en vivo: reenviar una foto y un texto a otro chat y confirmar que llegan.
