# MANDI · Etapa 2 del port de gestión de chats: la pantalla

> Ejecución nativa en `main` (23-sep-2026, pedido de Rodrigo). Diseño: `ind-inbox-next/docs/superpowers/specs/2026-09-22-gestion-chats-ind-design.md`.

**Objetivo:** que MANDI vea y maneje lo que la etapa 1 ya guarda (etapa, 📌, 🤫, interno, pedido) y retirar la temperatura manual.

**Clave del port:** la lista de MANDI es por FILA (cliente × número). Todo se calcula por fila:
`estado = estadoFila(conv)` (bandeja del número) y `ultimoEntranteAt = conv.last.ultimoEntranteCanal` (ventana por número).
Así los filtros de IND (`lib/filtro-chats.js`) sirven sin tocar la lógica por número. El orden de 🔴 sigue siendo el FIFO propio de MANDI (`lib/orden-bandeja.js`).

## Tareas
1. Copiar de IND `lib/filtro-chats.js`, `lib/overrides.js` (+ pruebas) y adaptar `components/FiltrosLista.jsx` a la paleta azul de MANDI.
2. `lib/api-client.js`: `updateEtapa`, `updateDeuda`, `updateSinAutomaticos`, `updateTipoContacto`, `fetchPedidosChat`; fuera `updateTemperatura`.
3. `/api/contactos/estado`: casos `etapa|deuda|sinAutomaticos|tipoContacto`; estados legados de pestañas viejas (VENTA → 🛒, SOPORTE → 🔴 + 📌 "Soporte" humano); `temperatura` se acepta y se ignora.
4. `components/App.jsx`: bandeja 🔴🟢⚫ con freno al 🟢 (estado de la FILA), etapa, 📌, 🤫, 🏷️; filtros combinables memorizados; chips en la fila; aviso ⏰ por `alertaVentanaCierra`; etiqueta CRM cada 5 min; fuera 🔥🌤️❄️, 💰 y 🎧; `estadoAlResponder` = atendido.
5. `components/Components.jsx`: `FilaChips` en `ContactRow`.
6. CAPI: solo 💳/🛒 (fuera 🔥/SOPORTE).
7. Seguimientos por temperatura: fuera del cron y de AUTOS (la reactivación llega en la etapa 3).
8. Prueba guardia sin temperatura manual (excluye el inbox social FB/IG, que tiene la suya).
9. Tests, lint, build, deploy, verificación.
