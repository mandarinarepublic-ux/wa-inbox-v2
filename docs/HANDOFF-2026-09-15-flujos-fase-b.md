# HANDOFF · 15-sep-2026 · FLUJOS, Fase B (estado por cliente) — MANDI

**Qué es:** la Fase B hace que un flujo publicado corra ENTERO. Ramas por botón,
"Otra respuesta", esperar la respuesta del cliente, esperas en las líneas, Condición,
citar la última respuesta y contadores por nodo en el lienzo.

Plan: `docs/superpowers/plans/2026-09-15-flujos-fase-b.md` · Diseño:
`docs/superpowers/specs/2026-09-15-flujos-lienzo-design.md` · Fase A: `docs/HANDOFF-2026-09-15-flujos-fase-a.md`.

## Estado al cerrar la sesión

| pieza | estado |
|---|---|
| Tablas `inbox.flujo_estado` y `inbox.flujo_pasos` + `inbox.flujo_pasos_contar()` | ✅ migración `inbox_flujo_estado_fase_b`, probada con insert/cascada |
| Motor puro (`lib/flujo.js`) y `correrTanda` (`lib/flujo-motor.js`) | ✅ 653 pruebas en verde |
| Webhook avanza con cada entrante; salientes humanos (inbox y celular) cancelan | ✅ en producción, deploy `7d2c823` verificado por sha |
| Cron `/api/cron/flujos` cada 5 min | ✅ en producción; sin clave responde `{"error":"no autorizado"}` (la ruta vive, no la atrapa el candado) |
| Contadores 👤 por nodo en el lienzo | ✅ commit `51b7ca8` |
| Retirar el motor de recetas (Task 8) | ⛔ **NO hecho a propósito**: las recetas siguen PRENDIDAS y hay 0 flujos. Se hace después de que Rodrigo importe |
| Prueba real con un número | ⏳ pendiente de Rodrigo (abajo) |

Hoy no corre nada nuevo en producción: con 0 flujos publicados el webhook ni lee `flujo_estado`.

## Cómo funciona

- Cuando el camino se detiene en un Mensaje con botones o "esperar respuesta", se guarda
  `flujo_estado` con `vence_at` = fin de la ventana de 24 h. En una línea con espera se guarda
  `esperando='tiempo'` con `vence_at` = ahora + espera.
- **Webhook, antes de los disparadores:** si el cliente tiene estado, se avanza.
  - Botón tocado → su rama. El id `rc_N` corresponde al puerto `btn_N`. Escribir el título del botón también cuenta.
  - Texto libre → "otra".
  - Esperando respuesta → "respuesta", sea lo que sea.
  - Si está esperando un reloj, su mensaje va a PENDIENTES y ningún otro flujo entra encima.
- **Cron:** las esperas vencidas se siguen solo si la ventana sigue abierta, con 5 min de margen. Si no, se borra el estado.
  También borra los estados de botón o respuesta que caducaron.
- **Cancelan el flujo:** contestar desde el inbox (`/api/saliente` sin `auto`), contestar desde el
  celular (eco de coexistencia), o que la IA tome el chat.
- La Condición se evalúa al pasar. Lee temperatura, si tiene venta, bandeja y hora de Ecuador en rango
  `HH:MM-HH:MM`, que puede cruzar la medianoche. Todo lo raro va por "no".
- Todo termina en PENDIENTES: el motor nunca toca la bandeja.

## Dónde vive cada cosa

| pieza | archivo |
|---|---|
| Decisiones puras (`avanzarDesde`, `evaluarCondicion`, `puertoDeEntrante`, `paradaDeCamino`, `decidirEntranteEnFlujo`, `decidirVencido`) | `lib/flujo.js` · `tests/flujo.test.js` |
| Correr una tanda (el ÚNICO que manda piezas y escribe estado) | `lib/flujo-motor.js` · `tests/flujo-motor.test.js` |
| Lectura y escritura de estado y pasos | `lib/inbox-supabase.js` (final) · `lib/flujos.js` |
| Webhook | `app/api/webhook/route.js` → `flujoEnCursoSiCorresponde`, `flujoSiCorresponde`, `procesarEchoes` |
| Cancelar al contestar desde el inbox | `app/api/saliente/route.js` (bloque `if (!body.auto)`) |
| Cron | `app/api/cron/flujos/route.js` + `vercel.json` + `lib/rutas-publicas.js` + matcher de `middleware.js` |
| Contadores | `GET /api/flujos/pasos` · `components/flujos/nodos.jsx` (`Tarjeta`) |

## Controles

```sql
select telefono, nodo_id, esperando, puerto_tiempo, vence_at from inbox.flujo_estado where cuenta='MANDI' order by actualizado_at desc;
select f.nombre, p.nodo_id, count(distinct p.telefono) clientes from inbox.flujo_pasos p join inbox.flujos f using (flujo_id)
 where p.cuenta='MANDI' and p.pasado_at > now() - interval '7 days' group by 1,2 order by 1,3 desc;
```
Logs de Vercel: `[flujo] <nombre> a <tel> N/M piezas (motivo)` · `[/api/webhook] flujo en curso se retira: <motivo>` ·
`[/api/cron/flujos] vencidos … seguidos … borrados … caducados …`.

## Prueba real (pendiente de Rodrigo)

1. En FLUJOS, crea el flujo "PRUEBA B":
   - Disparador **palabra** `pruebaflujo`, que lleva a un Mensaje con botones "Sí" y "No".
   - [Sí] Mensaje "Perfecto 🧡", luego una línea con **espera de 2 min**, luego Mensaje "¿Sigues ahí?" con *citar última respuesta*, luego Fin.
   - [No] Mensaje "Listo", luego Fin.
   - [otra] Condición hora `09:00-20:00`. En [si] "Te escribo ya", en [no] "Mañana te escribo", luego Fin.
   - Publícalo.
2. Desde un número al que NO le hayamos escrito en 24 h, escribe `pruebaflujo`. Llega la pregunta con botones.
   SQL: una fila con `esperando='boton'`.
3. Toca **Sí**. Llega "Perfecto 🧡". SQL: `esperando='tiempo'`. En 7 min o menos llega "¿Sigues ahí?" citando el "Sí",
   y la fila desaparece.
4. Repite con otro número escribiendo texto en vez de tocar. Entra por "otra" y la hora elige la rama.
5. Repite y, durante la espera, contesta a mano desde el inbox. La fila desaparece y el cron no manda nada.
6. Despublica "PRUEBA B".

## Pendiente

- **Task 8 (retirar recetas):** solo cuando `recetas.activo=false` y haya flujos importados. Borra
  `recetaSiCorresponde` del webhook y el interruptor de recetas de AUTOS.
- **Port a IND** (mismo código, plan aparte).
- El webhook hace un `delete` por clave primaria por cada eco del celular aunque no haya flujos. Es barato, pero
  si IND lo hereda, con su volumen conviene saltarlo cuando no hay flujos publicados.
