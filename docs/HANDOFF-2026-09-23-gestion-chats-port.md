# HANDOFF 23-sep-2026 — Port a MANDI de la gestión de chats de IND (etapas 0 y 1)

Diseño original (IND): `ind-inbox-next/docs/superpowers/specs/2026-09-22-gestion-chats-ind-design.md`
Estado de IND: `ind-inbox-next/docs/HANDOFF-2026-09-22-gestion-chats.md`

## Hecho

| Commit | Qué |
|---|---|
| `5c6bffe` | **Etapa 0.** Crons seguimientos y flujos se llamaban por `req.url` (URL del despliegue, protegida por Vercel → 401; verificado). Ahora `lib/url-propia.js` → `https://inbox.apps.mandarinaec.com`. |
| `1559761` | **Etapa 1 (sin cambios de pantalla).** Flujos con etapa/📌/📸 (motor copiado de IND, era idéntico); 📌 🤖 por promesa en `/api/saliente`; `ultimo_humano_at`; al cortar la IA por una foto (`escalarASoporte`) se prende 📌 🎧 "IA: mandó foto"; `/api/pedidos-chat` (para la etapa 2); CAPI: 💳/🛒 se SUMAN a 🔥/SOPORTE; internos fuera de CAPI y Telegram. |
| `88c31a0` | La etapa de un flujo solo avanza (💬 → 💳) y nunca pisa a una persona (también en IND, `52cdcaf`). |

**Datos:**
- 12 chats en bandeja VENTA/SOPORTE con el último mensaje del cliente sin contestar → PENDIENTE; VENTA sin pedido → etapa 🛒; SOPORTE → 📌 "Soporte".
- Flujos: los 6 PAGO marcan 💳 en su primer mensaje; DRAGON BALL: `m_pedido` → 💬, `m_pago` → 💳; sin temperatura en ningún flujo.

## Todavía NO (la pantalla de MANDI sigue igual)
- **Etapa 2 (pantalla):** bandeja 🔴🟢⚫ por número (MANDI/REPUBLIC/GENERAL), temperatura AUTOMÁTICA y fuera los botones manuales (decisión de Rodrigo), etapa/📌/🤫/🏷️ visibles, filtros, etiqueta 🏭📦🚚, freno al 🟢. Al hacerla, retirar 🔥/SOPORTE de la señal a Meta (`lib/capi.js`).
  - ⚠️ Riesgo: el estado de bandeja es POR NÚMERO (`inbox.bandeja`); los filtros/conteos de IND suponen uno por persona.
- **Etapa 3 (reactivación):** no escribir si `camino-seguimiento` da 'despertar' (el agente lleva el chat); la reserva debe mirar `bandeja` del número, no `conversaciones.estado`; textos propios de Mandarina.
- El 📌/etapa escritos hoy no se VEN en MANDI hasta la etapa 2 (están en la base).
- Inbox social FB/IG: fuera por ahora.
