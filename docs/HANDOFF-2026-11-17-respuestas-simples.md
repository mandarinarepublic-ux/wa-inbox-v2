# HANDOFF 17-nov-2026 — Respuestas simples (WhatsApp + comentarios IG/FB)

Pedido de Rodrigo: "automático en lo simple". Lo de respuesta FIJA sale solo; todo
lo demás sigue en Pendientes para una persona.

## Qué hace
- **WhatsApp** (`app/api/webhook` → `respuestaSimpleSiCorresponde`): con la IA apagada,
  sin persona en el chat (`humanoAtendiendo`) y sin flujo/receta que ya contestó,
  responde con texto fijo a: envío (gratis, Servientrega), envío al exterior (DHL,
  costo aparte), contra entrega (no), dónde están (6 de Diciembre y Mercurio),
  factura (sí, SRI) y "??" (ya te atiendo).
- **Comentarios IG/FB** (`app/api/social/webhook` → `comentarioSimpleSiCorresponde`):
  respuesta PRIVADA (abre el DM) a "precio / info / lo quiero / tallas" y a las mismas
  preguntas fijas. Nunca publica en el post. Reclamos → nada.
- El chat **sigue en Pendientes** (WhatsApp ya lo reabre; social manda `auto:true` →
  `estado: null`).
- Una vez por intención por cliente cada `horas_repetir` (24 h), mirando la BASE.

## Interruptores (pestaña AUTOS → 💬 Respuestas simples)
`respuesta_simple.activo` (WhatsApp) y `respuesta_simple.comentarios_activo` (IG/FB),
**los dos APAGADOS** al desplegar. Por número, por intención y textos editables.

## Por qué textos fijos y no la IA
Son políticas de la tienda: una IA que se equivoca en "¿hacen contra entrega?"
promete algo que no existe. El clasificador es regex, puro y probado con frases
REALES de 60 días (`tests/respuesta-simple.test.js`). La dirección segura es NO
contestar: posventa ("¿cuándo llega mi pedido?"), bloques de datos, tarjetas de
producto ("Me interesa… | Envío Gratis") y reclamos quedan fuera a propósito.

## Pendiente
- **IND (ind-inbox-v2) no tiene esto.** Parche x2: abrir los archivos destino, no copiar.
- "¿Cuánto tarda el envío?" y tarjeta/diferido NO están: falta el dato real de Rodrigo.
- Medir en 1 semana: `select texto, count(*) from inbox.mensajes where direccion='SALIENTE'
  and texto in (<textos>) group by 1` y revisar a mano 20 casos.
