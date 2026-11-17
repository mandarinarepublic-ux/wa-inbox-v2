# HANDOFF 17-nov-2026 — Respuestas simples + agente MANDI v5 (modo sombra)

Sesión larga desde el celular (chat de Claude). Reemplaza a
`HANDOFF-2026-11-17-respuestas-simples.md` como estado del día. Dos repos:
`wa-inbox-v2` (este) y `mandi-agent`. Auditoría completa de MANDI:
https://claude.ai/artifact/6hWf5KCr3QL1GxKvwgEQVR

## Qué está EN PRODUCCIÓN

### 1. Respuestas simples (sin IA, gratis) — PRENDIDAS (MANDI y REPUBLIC, 24/7)
`lib/respuesta-simple.js` (clasificador puro por regex) → `respuestaSimpleSiCorresponde`
en el webhook. Manda la RESPUESTA RÁPIDA asignada a cada tema
(`automatizaciones.respuesta_simple.respuestas`), completa, con
`lib/pieza-respuesta.js` (botones, carrusel, formulario, adjuntos).
- Temas: espera("??"), contra_entrega, internacional, pago, envio, tiempo_entrega,
  ubicacion, horario, retiro_tienda, cambio_talla, colores, factura, tallas
  (guía según la prenda del hilo: `prendaDe`), interes (solo comentarios IG/FB).
- Solo con la IA apagada en el chat y sin persona (`personaEnElChat`:
  `ultimo_humano_at` < 3 h; ☠️ NO `ultimo_mensaje_at`, que lo mueve el saludo).
- Una vez por tema por cliente cada 24 h (se mira la base). El chat NO sale de Pendientes.
- Comentarios IG/FB: respuesta PRIVADA con el texto de la rápida (`comentarios_activo`).
  **Sin probar con un comentario real todavía.**
- Descuentos, posventa, reclamos, precio y material: NO se contestan solos.
- AUTOS → 💬 Respuestas simples: interruptores y selector de respuesta rápida por tema.

### 2. Agente MANDI v5 (`mandi-agent`) — APAGADO para clientes, en MODO SOMBRA
- Cortafuegos `ia` = false en los dos números; todos los chats en HUMANO.
- `ia_sombra.activo = true`: por cada texto entrante se le pregunta al agente y se
  guarda en `inbox.ia_sombra` (mensaje, respuesta, respuestas_rapidas, derivar,
  etapa, tools, tokens, ms, error) **sin enviar nada**. No tiene interruptor en AUTOS aún.
- v5: tools `enviar_respuesta_rapida` (devuelve ids; el inbox las manda completas),
  `derivar_a_persona` (📌 con `updateDeuda`), `buscar_productos` (Shopify: activos,
  publicados, relevancia, stock real por variante). Haiku 5.5 (`MANDI_MODEL`) con
  caché de prompt. Lee la conversación entera (hasta 1000 mensajes, sin INTERNO,
  con transcripciones). Etapas de venta (`lib/etapas.js`): interes → modelo → talla
  → datos → pago (+ posventa/otro); declara `ETAPA: x` en la 1ª línea (se quita).
- Ahorro (`lib/ia-ahorro.js`): no se llama si la regla ya contestó, ni por
  "gracias"/emoji; ráfagas: espera 8 s y contesta solo el último mensaje.
- `/api/chat` de mandi-agent quedó CERRADO con clave (era público).

## ⚠️ Lo que NO está verificado
- **MANDI v5 nunca ha respondido un mensaje real.** A las 14:19 falló por saldo
  ("credit balance is too low"); Rodrigo recargó $20 a las 14:39 y desde entonces
  no entró ningún texto. Primer paso al retomar:
  `select * from inbox.ia_sombra order by id desc limit 20;`
  y revisar: ¿eligió la respuesta rápida correcta?, ¿etapa?, ¿derivó posventa?,
  ¿inventó algo?, tokens y ms. Error 500 → runtime logs de `mandi-agent`.
- No pude ver variables de Vercel (403): no sé si están las de Shopify en mandi-agent
  ni si `MANDI_API_KEY_VIEJA` sigue definida (hay que borrarla).

## Pendiente (en orden)
1. Revisar las primeras respuestas en sombra y ajustar el prompt (`mandi-agent/lib/systemPrompt.js`, `lib/etapas.js`).
2. Audios (60/mes, 9 transcritos): Rodrigo aún no decide. Recomendado: aviso con
   respuesta rápida + 📌; transcripción automática después.
3. Respuestas de Rodrigo que faltan: código de descuento vigente (DESC10 vs
   MANDARINA10; hoy el agente no ofrece ninguno), tabla de niños/tallas grandes
   (−$5; 3XL +$3, 4XL +$6, 5XL +$9), y si firma como Andrés o MANDI (hoy sin nombre).
4. Que el agente escriba la etapa en el inbox (hoy solo la lee): cuidado, la
   reactivación automática depende de `etapa`.
5. Pasar fotos de producto del cliente al agente (hoy una foto con IA prendida → soporte).
6. Pedidos del CRM como contexto del agente. Interruptor de sombra en AUTOS.
7. `/api/crear-pedido` de mandi-agent sigue en Sonnet 4.6 (caro): ofrecer Haiku.
8. Material/tela/bordado: Rodrigo lo va a completar en Shopify; el agente lo lee de la descripción.
9. **IND (`ind-inbox-v2`) no tiene nada de esto** (parche x2, abrir archivos destino).
10. Del pedido original: reporte DIARIO de pauta de Meta y análisis de uso de Claude Code (`npx ccusage@latest`).
11. Recomendado a Rodrigo: repo `mandi-agent` a privado (cédula en el historial) y
    clave de Anthropic propia para MANDI con límite de gasto.

## Políticas confirmadas por Rodrigo (17-nov)
Entrega 72 horas laborables desde el pago · tienda lun–dom 11:00–18:00 · se puede
retirar y pagar en tienda · sin contra entrega · cambio de talla devolviendo la
prenda igual (72 h laborables desde que llega) · cualquier color a pedido ·
descuentos: sí, pero los decide él (derivar) · "usa las respuestas rápidas, siempre".
