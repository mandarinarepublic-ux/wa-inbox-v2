# FLUJOS — creador visual de flujos por nodos (diseño)

**Fecha:** 15-sep-2026 · **Repo:** wa-inbox-next (MANDI primero; IND después)
**Estado:** aprobado en conversación con Rodrigo el 15-sep ("dale con todo").
**Reemplaza a:** las "recetas de bienvenida" del 14-sep (`2026-09-14-recetas-bienvenida-design.md`),
que pasan a ser el caso lineal de un flujo. Un solo modelo, una sola pantalla.

## 1. Qué quiere Rodrigo

Un lienzo tipo Manychat / Typebot / Node-RED: cada mensaje es una tarjeta, las líneas entre
tarjetas definen el flujo y sus ramas, y se ve de un vistazo todo lo que le pasará a un cliente.
Comparado bloque por bloque con Manychat (15-sep), lo que tiene sentido en WhatsApp y en cómo
vende Mandarina se reduce a **cuatro nodos y una cajita de espera en cada línea**.

Decisiones tomadas por Rodrigo:
- **Cualquier mensaje humano cancela el flujo** de ese cliente. El lienzo nunca compite con una persona.
- **Todo flujo, termine como termine, deja el chat en PENDIENTES.**
- La Pregunta tiene una salida extra **"Otra respuesta"** para cuando el cliente escribe en vez de tocar.
- La espera va **en la línea**, no en un nodo: en blanco = inmediato.
- **Sin nodo "recopilar datos" ni campos del contacto:** se manda "pásame tus datos" y se **espera la
  respuesta**; lo que conteste queda en el chat.
- **La temperatura se marca desde el nodo** ("si llegas hasta acá eres 🔥"), no con etiquetas aparte.
- **El primer mensaje sale citando el mensaje del cliente** (como "Responder"), para que no se sienta
  automático; y un nodo puede **citar la última respuesta del cliente** más adelante.

## 2. Los nodos

| nodo | entradas | datos | salidas |
|---|---|---|---|
| **Disparador** (uno por flujo) | — | `tipo`: `anuncio` (lista de `source_id`), `organico` (contacto nuevo sin anuncio), `palabra` (lista de palabras; contiene, sin mayúsculas/acentos) | `siguiente` |
| **Mensaje** | 1 | `origen`: `respuesta` (`respuestaId`) o `texto` (texto + adjuntos por URL) · `botones[]` (máx 3 × 20) · `esperarRespuesta` (bool) · `citarUltimaRespuesta` (bool) · `temperatura` al llegar (`''`/`caliente`/`tibio`/`frio`) | sin botones y sin esperar: `siguiente` · con botones: un puerto por botón + `otra` · con esperar (sin botones): `respuesta` |
| **Condición** | 1 | `campo`: `temperatura` / `tiene_venta` / `hora` (rango HH:MM–HH:MM, hora Ecuador) / `bandeja` · `valor` | `si`, `no` |
| **Fin** | 1 | — | — |

**Líneas:** `{ de, puerto, a, esperaMin }`. `esperaMin` vacío o 0 = inmediato. Un puerto sin línea
equivale a Fin.

**Validación** (puro, `lib/flujo.js`): exactamente un Disparador; todo nodo alcanzable desde él;
sin ciclos sin espera (un ciclo con espera se permite, pero cada paso por el motor respeta la
ventana); un Mensaje con `origen=respuesta` cuya respuesta rápida no exista se marca en rojo y se
salta al ejecutar; botones ≤3, títulos ≤20; `esperaMin` ≤ 23 h (el motor igual lo corta si la
ventana cerró). Un flujo con errores se puede guardar pero **no publicar**.

**Exclusividad de disparadores:** un `source_id`, la entrada `organico` y una palabra clave solo
pueden estar en UN flujo publicado. Publicar un flujo que choca con otro publicado se rechaza
con el nombre del otro.

## 3. Datos

```sql
create table inbox.flujos (
  flujo_id     uuid primary key default gen_random_uuid(),
  cuenta       text not null,
  nombre       text not null,
  publicado    boolean not null default false,
  grafo        jsonb not null default '{"nodos":[],"lineas":[]}',   -- borrador (lo que se edita)
  grafo_vivo   jsonb,                                                -- lo publicado (lo que corre)
  creado_at    timestamptz not null default now(),
  actualizado_at timestamptz not null default now()
);
create index flujos_cuenta_publicado on inbox.flujos (cuenta, publicado);

-- Fase B
create table inbox.flujo_estado (
  cuenta       text not null,
  telefono     text not null,
  flujo_id     uuid not null references inbox.flujos(flujo_id) on delete cascade,
  nodo_id      text not null,          -- dónde está parado
  esperando    text not null,          -- 'boton' | 'respuesta' | 'tiempo'
  puerto_tiempo text,                  -- para 'tiempo': qué puerto seguir al vencer
  vence_at     timestamptz not null,   -- ventana 24 h desde el último entrante, o la espera
  ultimo_wamid text,                   -- para citar la última respuesta
  actualizado_at timestamptz not null default now(),
  primary key (cuenta, telefono)       -- un cliente está en UN flujo a la vez
);
```

`grafo` = borrador; `grafo_vivo` = copia al **Publicar**. El motor lee solo `grafo_vivo` de los
flujos con `publicado=true`. Guardar no cambia lo que corre; publicar sí. Despublicar deja el
borrador.

`conversaciones.ultima_receta_at` se conserva como **tope de un disparo por cliente por 24 h**
(mismo significado, nombre viejo; renombrarla no vale la migración).

## 4. Motor

### Fase A (este plan): el camino lineal
El webhook, por cada entrante con referral / contacto nuevo / texto:
1. `elegirFlujo({ flujos, sourceId, esNuevo, texto })` → el flujo publicado cuyo Disparador aplica
   (prioridad: anuncio > palabra > orgánico).
2. Guardias de siempre: bot activo → nada; `ultima_receta_at` < 24 h → nada; marcar ANTES de enviar.
3. `caminoLineal(grafo)` recorre desde el Disparador siguiendo `siguiente` **mientras** la línea no
   tenga espera y el Mensaje no tenga botones ni `esperarRespuesta`; se detiene en el primer
   punto que necesita estado (Fase B) o en Fin. Devuelve los nodos Mensaje en orden.
4. `piezasDeMensajes(nodos, respuestas, contacto, citaId)` → los cuerpos para `/api/saliente`
   (misma función que hoy arma las recetas, generalizada: un Mensaje con botones cierra como
   `interactive_buttons`). La primera pieza cita el entrante.
5. Envío en tarea diferida, alarma si 0/N, temperatura del nodo se aplica al pasar por él.

Con eso **todo lo que hoy hace una receta lo hace un flujo lineal**, y lo que necesita ramas queda
dibujado y validado pero termina donde empieza la rama (el chat sigue en PENDIENTES).

### Fase B (plan aparte): estado por cliente
- Al detenerse en un Mensaje con botones/esperar, o en una línea con espera, se escribe
  `flujo_estado` con `vence_at` = min(espera, último entrante + 24 h).
- Webhook: **antes** de evaluar disparadores, si el cliente tiene `flujo_estado`, se avanza:
  botón tocado → puerto del botón; texto → `otra` (o `respuesta` si esperaba respuesta); se sigue
  el camino lineal desde ahí; `citarUltimaRespuesta` usa el wamid del entrante.
- Cron cada hora: estados con `esperando='tiempo'` vencidos → si la ventana sigue abierta, seguir
  por `puerto_tiempo`; si no, borrar (termina en Pendientes).
- Cualquier saliente **no automático** (`auto` ausente) borra el estado del cliente.
- Condición se evalúa al pasar. Un cliente nuevo que dispara otro flujo mientras está en uno: gana
  el que está (no se reinicia).
- Contadores por nodo (clientes que pasaron en 30 d) desde una tabla de eventos `flujo_pasos`.

## 5. El lienzo (pestaña FLUJOS)

- Librería **React Flow** (`@xyflow/react` 12): lienzo con paneo/zoom, arrastrar, conectar puertos,
  minimapa, selección, borrar con Supr. Estilos propios sobre la paleta del inbox.
- Columna izquierda: lista de flujos (nombre, publicado/borrador, disparador, último cambio),
  "+ Nuevo flujo", duplicar, eliminar. Al elegir uno se abre en el lienzo.
- Paleta arriba del lienzo: Mensaje, Condición, Fin (el Disparador ya viene en cada flujo nuevo).
- Panel derecho al seleccionar un nodo o una línea: sus datos (selector de respuesta rápida con
  vista previa, editor de botones, casillas, temperatura; en la línea: minutos/horas de espera).
- Cabecera: nombre editable, **Guardar borrador**, **Publicar** (valida; muestra errores y choques
  de disparador), **Despublicar**, deshacer/rehacer.
- Fase A pinta en gris punteado lo que aún no corre (ramas, esperas, Condición) con la nota
  "corre desde la Fase B".
- Al abrir FLUJOS por primera vez, las recetas del 14-sep aparecen ya convertidas en flujos
  lineales (conversión única, §7), y la tarjeta 📣 de AUTOS pasa a mostrar los anuncios con su
  etiqueta y **a qué flujo pertenecen**, sin editor.

## 6. API

- `GET /api/flujos` → `{ ok, flujos:[{ flujo_id, nombre, publicado, grafo, grafo_vivo, actualizado_at }] }`
- `POST /api/flujos` `{ flujo_id?, nombre, grafo }` → guarda borrador (crea si no hay id) → `{ ok, flujo }`
- `POST /api/flujos/publicar` `{ flujo_id, publicar:boolean }` → valida + choques → `{ ok }` o `{ ok:false, errores:[…] }`
- `DELETE /api/flujos?flujo_id=` → `{ ok }`
- Todas detrás del login (no entran en `lib/rutas-publicas.js`; `tests/rutas-publicas.test.js` las lista como PROTEGIDAS).

## 7. Conversión de las recetas actuales (una vez)

`recetaAFlujo(receta, anuncios)` (puro): Disparador `anuncio` con los `source_id` que apuntan a esa
receta (o `organico`) → un Mensaje por paso (`origen=respuesta`) → si hay `pregunta`, un Mensaje
`origen=texto` con sus botones → Fin. Publicado si `recetas.activo && receta.activa`. Se corre desde
un endpoint de una sola vez (`POST /api/flujos/importar-recetas`, detrás del login, idempotente:
no importa dos veces la misma receta) y después se apaga `recetas.activo` para que no corran dos
motores. El código de recetas se retira en la Fase B cuando el motor nuevo cubra todo.

## 8. Riesgos y cómo se cubren

- **Dos motores a la vez** (recetas y flujos): la importación apaga `recetas.activo`; el webhook
  evalúa flujos primero y recetas solo si `recetas.activo`. Se retira en Fase B.
- **Publicar un borrador roto:** la validación es la misma función pura en pantalla y en el
  endpoint; el motor además salta nodos huérfanos con log.
- **Cliente atrapado (Fase B):** todo estado tiene `vence_at`; el cron lo limpia; un humano lo borra.
- **Ruta caliente:** una lectura de `flujos` publicados por ciclo de `procesar` (cacheada en el
  ciclo), solo si hay referral / contacto nuevo / texto; Fase B suma una lectura de `flujo_estado`
  por entrante, por clave primaria.
- **React Flow en el bundle:** ~150 kB gz, se carga solo con la pestaña FLUJOS (`next/dynamic`).

## 9. Fuera de alcance (por ahora)

Aleatorizador, "comenzar otro flujo", solicitud HTTP, bloque dinámico, campos del contacto,
variables en el texto, plantillas fuera de la ventana de 24 h, listas interactivas de 10 opciones
(se suma cuando haga falta: el nodo Mensaje ya tiene el sitio).
