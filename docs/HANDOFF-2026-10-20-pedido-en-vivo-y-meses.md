# HANDOFF 20-oct-2026 — pedido del catálogo en vivo, hilo por meses, historial tras pedido

Los tres cambios están en producción en los DOS inbox (MANDI `wa-inbox-v2`, IND `ind-inbox-v2`).
Las trampas permanentes quedaron en la skill `inbox-mandarina` (#13 y #14).

| Qué | MANDI | IND |
|---|---|---|
| Pedido manual: el historial del panel se recarga solo al crear el pedido | `a003538` | `aa34daa` |
| Pedido del catálogo con nombre y foto aunque llegue con el chat abierto | `49c8746` | `8bb7adf` |
| Hilo plegado por mes (mes en curso siempre abierto) | `e8eeff9` | `dce3f2c` |

## 1. Pedido del catálogo que llega en vivo

**Síntoma (Rodrigo, pedido de prueba desde su número):** `📦 Pedido del catálogo — 1 artículo ·
$35.00 • 1 × $35.00 (8063557763165)`. El id ES un producto de Shopify (Chaqueta Dragon Ball Z
Roja) y está en `crm.productos_shopify`.

**Causa:** solo el hilo resuelve (`conPedidosResueltos`); el hilo solo se leía al abrir el chat;
el pedido entró por el poll, que no trae `raw`. Prueba: `inbox.catalogo_cache` no tenía el id
(el servidor nunca lo intentó; la caché no se tocaba desde el 18-oct).

**Arreglo:** efecto en `components/App.jsx` → `pedidosPorResolver(msgs, Set)` → `cargarHilo`
una vez por pedido. MANDI: `lib/hilos.js`. IND: `lib/pedido-en-vivo.js`. Prueba guardia:
`tests/pedido-en-vivo.test.js`.

**Pendiente:** `referred_product` (cliente que escribe desde una tarjeta) llegando en vivo sigue
sin resolverse hasta reabrir el chat: el poll no trae nada que lo delate.

## 2. Hilo plegado por mes

Pedido de Rodrigo: "agrupar por mes, siempre dejar las del mes en curso abiertas, y una línea con
botón de mostrar para ver el mes anterior". `lib/meses-chat.js` + `tests/meses-chat.test.js`
(idénticos en los dos). Reglas: mes en curso + último mes con mensajes abiertos; abrir no hace
saltar la pantalla (`anclaScrollRef`); con el mes más viejo plegado no se baja más historial.
Lo abierto no se guarda: al refrescar vuelve a plegarse.

**Sin probar en pantalla** (el inbox pide login). Probar: abrir un chat con varios meses → ver las
líneas, abrir una, subir con el scroll y confirmar que trae historial solo cuando el mes más viejo
está abierto.

## 3. Pedido manual → historial

`components/RightPanel.jsx`, en `onCreado`: `loadHistorial(activeConv.telefono, aviso.pedidoId)`.
Antes el efecto corría una vez por teléfono (`histLoadedRef`) y el pedido nuevo no aparecía hasta
refrescar. Guardia: `tests/historial-tras-pedido.test.js`.

## Otros del día (solo MANDI, sin código)

- 14 respuestas rápidas con carrusel por universo en `inbox.respuestas_rapidas` (grupo `productos`).
  Sin probar envío real.
- Lote de recuperación de clientes del 20-oct armado (5 chats) y NO enviado: falta
  `INBOX_API_TOKEN` en `.env.local` y el "dale" de Rodrigo (skill `ventas-mandi`).
