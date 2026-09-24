# HANDOFF 23-sep-2026 — Port a MANDI de la gestión de chats de IND (etapas 0, 1 y 2)

Diseño original (IND): `ind-inbox-next/docs/superpowers/specs/2026-09-22-gestion-chats-ind-design.md`
Estado de IND: `ind-inbox-next/docs/HANDOFF-2026-09-22-gestion-chats.md`

## Hecho

| Commit | Qué |
|---|---|
| `5c6bffe` | **Etapa 0.** Crons seguimientos y flujos se llamaban por `req.url` (URL del despliegue, protegida por Vercel → 401; verificado). Ahora `lib/url-propia.js` → `https://inbox.apps.mandarinaec.com`. |
| `1559761` | **Etapa 1 (sin cambios de pantalla).** Flujos con etapa/📌/📸 (motor copiado de IND, era idéntico); 📌 🤖 por promesa en `/api/saliente`; `ultimo_humano_at`; al cortar la IA por una foto (`escalarASoporte`) se prende 📌 🎧 "IA: mandó foto"; `/api/pedidos-chat` (para la etapa 2); CAPI: 💳/🛒 se SUMAN a 🔥/SOPORTE; internos fuera de CAPI y Telegram. |
| `88c31a0` | La etapa de un flujo solo avanza (💬 → 💳) y nunca pisa a una persona (también en IND, `52cdcaf`). |
| _(etapa 2)_ | **Pantalla.** Bandeja 🔴🟢⚫ por FILA (cliente × número) con freno al 🟢; etapa 💬💳🛒🔁, 📌, 🤫, 🏷️ en la cabecera; filtros combinables (`lib/filtro-chats.js`, `components/FiltrosLista.jsx`) memorizados; chips por fila (temperatura AUTOMÁTICA por la ventana de ESE número, etapa, 📌, pedido 🏭📦🚚); ⏰ por `alertaVentanaCierra`. Fuera 🔥🌤️❄️ manual, 💰 Venta y 🎧 Soporte. `/api/contactos/estado`: VENTA → 🛒, SOPORTE → 🔴 + 📌 "Soporte" (humano), `temperatura` se ignora. CAPI: solo 💳/🛒. Cron de seguimientos por temperatura retirado (las 3 reglas estaban apagadas) y su tarjeta de AUTOS también. Plan: `docs/superpowers/plans/2026-09-23-mandi-etapa2-pantalla.md`. |

**Datos:**
- 12 chats en bandeja VENTA/SOPORTE con el último mensaje del cliente sin contestar → PENDIENTE; VENTA sin pedido → etapa 🛒; SOPORTE → 📌 "Soporte".
- Flujos: los 6 PAGO marcan 💳 en su primer mensaje; DRAGON BALL: `m_pedido` → 💬, `m_pago` → 💳; sin temperatura en ningún flujo.

## Todavía NO
- La columna `conversaciones.temperatura` sigue en la base (congelada) y el `/dashboard` todavía la cuenta como "🌡️ Temperatura de leads" — igual que en IND. Retirar las columnas viejas en los dos cuando se confirme que nada las lee.
- `automatizaciones.config.seguimientos` (MANDI) quedó en la base con `activo:true` y las 3 reglas apagadas: el cron ya no la lee.
- **Etapa 3 (reactivación):** no escribir si `camino-seguimiento` da 'despertar' (el agente lleva el chat); la reserva debe mirar `bandeja` del número, no `conversaciones.estado`; textos propios de Mandarina.
- Inbox social FB/IG: fuera por ahora.
