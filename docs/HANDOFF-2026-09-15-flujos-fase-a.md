> ⚠️ **Superado por `docs/HANDOFF-2026-09-15-flujos-fase-b.md`** (la Fase B ya está en producción).

# HANDOFF · 15-sep-2026 · FLUJOS, Fase A (lienzo + motor lineal) — MANDI

**Qué es:** la pestaña **FLUJOS** del inbox: un lienzo de nodos (React Flow) donde Rodrigo dibuja
qué le pasa a un cliente: **Disparador → Mensajes → Fin**, con botones, esperas en las líneas,
condiciones y temperatura al llegar a un nodo. Reemplaza a las "recetas de bienvenida" del
14-sep: una receta es un flujo lineal, y se importan con un botón.

Diseño: `docs/superpowers/specs/2026-09-15-flujos-lienzo-design.md` · Plan Fase A:
`docs/superpowers/plans/2026-09-15-flujos-fase-a.md`.

## Qué corre en la Fase A y qué NO

| se dibuja y se valida | corre hoy |
|---|---|
| Disparador por anuncio / orgánico / palabra clave | **sí** |
| Mensajes en cadena (respuesta rápida o texto con adjuntos) | **sí**: el camino lineal desde el disparador hasta el primer punto que necesita estado |
| Un Mensaje con botones al final de la cadena | **sí** se manda (con sus botones); lo que el cliente toque llega como texto y el chat sigue en PENDIENTES |
| Ramas por botón, "Otra respuesta", esperar respuesta, espera en la línea, Condición, citar la última respuesta | **no** (Fase B): el flujo se detiene ahí, el chat queda en PENDIENTES. Las tarjetas lo dicen: "corre desde la Fase B" |
| Temperatura al llegar a un nodo | **sí** para los nodos del camino lineal |

Reglas que el código hace cumplir: sin flujo publicado que aplique NO sale nada · un disparo por
cliente por 24 h (`conversaciones.ultima_receta_at`, marcado ANTES de enviar) · el bot activo en el
chat gana · `auto:true` → PENDIENTES · la primera pieza cita el mensaje del cliente · tope 15 piezas.

## Cómo se usa

1. FLUJOS → "+ Nuevo flujo". Cada flujo nace con un Disparador (orgánico) y un Fin.
2. Clic en el Disparador → panel derecho: tipo (anuncio con casillas de los anuncios vistos /
   orgánico / palabra clave).
3. "+ Mensaje", conectar puertos arrastrando (un puerto, una línea). En el panel: respuesta
   rápida o texto libre, botones (máx 3 × 20), esperar respuesta, citar, temperatura.
4. "Guardar borrador" guarda; **"Publicar" valida** (errores en rojo, choques con otro flujo
   publicado con su nombre) y copia el borrador a `grafo_vivo`, que es lo que corre. Editar
   después NO cambia lo que corre hasta volver a publicar.
5. Primera vez: si hay recetas en AUTOS, el botón "Importar las recetas de AUTOS" las convierte en
   flujos lineales (publicados si estaban activas) y **apaga el motor de recetas**.

## Dónde vive cada cosa

| pieza | archivo |
|---|---|
| Modelo, validación, elección de flujo, camino lineal, piezas, conversión de recetas (puro, 30+ pruebas) | `lib/flujo.js` · `tests/flujo.test.js` |
| Tabla + lectura/escritura | `inbox.flujos` (`grafo` borrador, `grafo_vivo` publicado) · `lib/inbox-supabase.js` · `lib/flujos.js` |
| API (detrás del login) | `GET/POST/DELETE /api/flujos` · `POST /api/flujos/publicar` · `POST /api/flujos/importar-recetas` |
| El motor | `app/api/webhook/route.js` → `flujoSiCorresponde` (flujos primero; recetas solo si `recetas.activo`) |
| El lienzo | `components/flujos/Flujos.jsx`, `nodos.jsx`, `PanelEdicion.jsx`, `grafo-reactflow.js` (puro, ida y vuelta probada) |
| Pestaña | `components/App.jsx` (`FLUJOS`, cargada con `next/dynamic` la primera vez que se abre) |
| AUTOS | la tarjeta 📣 pasó a solo lectura: anuncios vistos con "→ flujo: <nombre>" |

⚠️ **Los disparadores por PALABRA** aplican a cualquier texto de cualquier cliente. Guardas: solo
mensajes de tipo texto (no ubicaciones ni botones tocados), no si el último mensaje previo del chat
fue nuestro dentro de 24 h, y el tope de 24 h por cliente. Hay un interruptor global de flujos.

## Controles

```sql
select nombre, publicado, actualizado_at from inbox.flujos where cuenta='MANDI' order by actualizado_at desc;
select telefono, ultima_receta_at from inbox.conversaciones where cuenta='MANDI' and ultima_receta_at is not null order by 2 desc limit 20;
select config->'recetas'->>'activo' recetas_activo from inbox.automatizaciones where cuenta='MANDI';  -- false tras importar
```
Logs de Vercel: `[/api/webhook] flujo <nombre> a <tel> N/M piezas` · `flujo … se detuvo en <motivo> (Fase B)` ·
alarma Telegram "Flujo sin enviar" si 0/N.

## Prueba real (pendiente de Rodrigo)

1. Importar las recetas. Ver los flujos lineales dibujados.
2. Abrir el de Orgánico (o crear uno), publicar, escribir desde un número nuevo: llegan las piezas,
   la primera citando el "hola". El chat queda en PENDIENTES.
3. Despublicar el de Orgánico si era de prueba.

## Pendiente — Fase B (plan aparte)

Estado por cliente (`inbox.flujo_estado`), ramas por botón y "Otra respuesta", esperar respuesta,
esperas en las líneas (cron cada hora), Condición, citar la última respuesta, contadores por nodo,
retirar el motor de recetas. Y el port a IND.
