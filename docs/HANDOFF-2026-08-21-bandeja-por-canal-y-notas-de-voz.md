# MANDI — bandeja por canal, guardia de ventana y notas de voz (19–21 ago 2026)

Tres días de trabajo encadenado que arrancó con un cliente que **no recibía los
mensajes**. Todo en producción y probado con envíos reales.

Lo que sigue está ordenado por lo que más conviene no volver a aprender a golpes.

---

## 1. El caso que lo destapó todo

Un cliente escribió por **REPUBLIC** a las 11:11 del 19-ago. A las 11:49 le
respondieron tres mensajes **por MANDI**. Meta los rechazó con **131047**:

> *"more than 24 hours have passed since the customer last replied to **this number**"*

**La ventana de 24 h de WhatsApp es por par (cliente ↔ número NUESTRO), no por
cliente.** El inbox la trataba como si fuera por cliente.

No fue un caso aislado: **14 mensajes murieron en agosto** por lo mismo, incluidos
**6 seguidos el 16-ago** a alguien que nunca había escrito a ese número. Se
encontraron por casualidad.

### Las dos causas

1. **GENERAL mezclaba los dos números en un solo hilo.** `/api/inbox-sync` pedía los
   mensajes sin filtro y `buildConvs` los agrupaba **solo por teléfono**. El
   vendedor veía una conversación que no existe: dos hilos cosidos por fecha.
2. **El canal se adivinaba de un campo contaminado.** `phoneIdDe()` leía
   `conversaciones.phone_id` —UNA ficha por persona— y `guardarMensajeSupabase`
   pisaba ese campo con **cualquier** mensaje, incluidos los salientes. Efecto bola
   de nieve: el primer envío equivocado contaminaba la ficha y arrastraba a los
   siguientes.

---

## 2. ⚠️ El primer intento se desplegó y hubo que REVERTIRLO

Vale más que el arreglo. Falló por dos motivos, y **el segundo importa más**:

**Rendimiento.** Metió `getBandejaSupabase(null)` en `/api/inbox-sync` y los dos
contadores también la llamaban → **tres lecturas completas de 1.642 filas por
ciclo** (6 viajes de red, +142 kB) en la ruta que es el **47 % del consumo de
Vercel**. El propio archivo lo advertía en un comentario.

**☠️ Diseño de flujo, el error de fondo.** GENERAL mandaba a la pestaña del número
en cada clic. Además de sacar al vendedor de su cola única, ese camino pasa por
`cambiarLinea`, que **vacía `convs`, `contacts` y `hilosRef` y recarga todo**: abrir
un chat borraba el inbox y lo volvía a bajar. Con 25 chats al día, 25 clics extra y
50 recargas completas.

**La regla, en palabras de Rodrigo:**

> «en general respondo y solo cambia el número»

El canal sale de la **CONVERSACIÓN ABIERTA**, nunca de la pestaña. La pestaña no se
mueve.

---

## 3. Lo que quedó (2.º intento, `02a61b3`)

- `inbox.bandeja` — estado por `(cuenta, telefono, phone_id)`. Contestar por un
  número ya no apaga la conversación del otro.
- `inbox.lista_bandeja` — la lista **con el estado pegado a cada fila**, en una sola
  consulta.
- `inbox.pendientes_bandeja(cuenta)` — contador agregado en la base (0,1 ms).
- GENERAL da **una fila por (cliente, número)** con su chip, y se responde **desde
  ahí**.
- `conversaciones.phone_id` **solo lo mueven los ENTRANTES** → muerto el efecto bola
  de nieve.

**Reparto:** lo que es de la CONVERSACIÓN (estado, no leídos, ventana) va en
`bandeja`; lo que es de la PERSONA (temperatura, notas, venta, IA) sigue en
`conversaciones`, una sola.

⚠️ **`conversaciones.estado` se sigue escribiendo en paralelo** porque lo leen IND y
el CRM. **No quitar esa escritura hasta que IND migre.**

### El índice que faltaba

`ultimos_mensajes_canal` agrupa por `(cuenta, telefono, phone_id)` y no existía ese
índice: **80,2 ms**. Con `mensajes_cuenta_tel_phone_fecha_idx`: **18,3 ms**. También
acelera a IND (su planificador lo elige).

### Números finales

| | Antes | 1.er intento (revertido) | Ahora |
|---|---|---|---|
| SQL por ciclo | 45,0 ms | ~111 ms | **52,8 ms** |
| Consultas a Supabase | 5 | 11 | **4** |
| Peso de la lista | 465 kB | 607 kB | 513 kB |

---

## 4. ☠️ Los tres fallos que cazó la auditoría ANTES de subir

Rodrigo pidió «busca mejoras y levanta escenarios críticos». Aparecieron tres, y el
primero habría anulado el arreglo entero **siendo invisible al probar**.

1. **El estado se perdía en los chats RECIENTES.** Viajaba pegado al último mensaje,
   pero el poll hace `buildConvs([...rows, ...hilos, ...lista])` y se queda con el
   PRIMERO por id — y `rows` va primero y no trae estado. Habría funcionado **solo
   en los chats viejos**. Ahora el estado vive en la CONVERSACIÓN, no en su último
   mensaje. Lo mismo lo rompía una burbuja optimista al responder.
2. **Orden de paginación no total.** Con una fila por (cliente, número),
   `fecha + telefono` ya no es único: pasó **3 veces en agosto** con el número de
   Rodrigo. Es el tope de PostgREST, 4.ª vuelta en este proyecto. Se agregó
   `phone_id` al orden.
3. **El override local no protegía la fila** — marcabas ATENDIDO y reaparecía al
   siguiente poll.

---

## 5. Guardia de ventana y aviso de fallidos

**La guardia ya existía** («Ventana de 24h cerrada — solo plantilla») y ya bloqueaba
el envío; lo que estaba mal era el dato. Ahora manda `ultimoEntranteCanal` —el
último mensaje del cliente **por ese número**— y `ventanaAbierta` **cierra ante la
duda**: sin fecha o con fecha corrupta devuelve false. Un falso «cerrada» solo
obliga a usar plantilla; un falso «abierta» pierde el mensaje.

**Aviso de fallidos:** `/api/cron/entregas` cada 30 min por Telegram. La rpc
`inbox.entregas_fallidas` saca el código real de Meta del **payload crudo** (en
`mensajes` solo queda `'failed'`) y —lo más útil— **el otro número por el que SÍ se
puede escribir**. Verificado contra los fallos reales del 19-ago: devuelve REPUBLIC,
que era la respuesta correcta.

### ⚠️ El cron nació muerto y nadie lo habría notado

Se desplegó **sin estar en el `matcher` de `middleware.js`**: Vercel lo llamaba, el
candado lo mandaba al login, y no corría **nunca**. Un aviso construido para romper
un silencio, muerto en el mismo silencio.

Hay una prueba que lo caza (`tests/rutas-publicas.test.js`) — **y la primera versión
de esa prueba tampoco servía**: hacía `includes` sobre todo el archivo y pasaba por
el COMENTARIO que nombra la ruta. Se descubrió forzando el fallo a propósito. Ahora
mira solo el patrón del matcher, y se verificó que **falla con el bug puesto**.

> Una prueba que no se cae cuando el bug está presente es peor que no tener prueba:
> da permiso para no mirar.

---

## 6. Notas de voz

**Meta solo pinta la burbuja de nota de voz si el archivo es OGG/Opus.** Fish Audio
da MP3 ⇒ siempre hay que convertir, y se convierte **en el navegador**
(`decodeAudioData` es gratis ahí; ffmpeg pesa 80 MB).

Medido: 19,85 s de MP3 (317 KB) → OGG/Opus (81 KB) en **0,55 s**, 4× más liviano.

**Verificar un audio en 5 segundos:**
```js
const b = require('fs').readFileSync('x.ogg')
b.slice(0,4).toString()    // 'OggS'
b.slice(28,36).toString()  // 'OpusHead'  ← si no dice esto, Meta lo rechaza (131053)
```

### Las cuatro trampas

1. **Al codificador hay que PEDIRLE las cabeceras** (`getHeaderPages`, después del
   `ready`). Sin eso: OGG sin `OpusHead` → **131053**.
2. **`writeReply` enumeraba campos a mano** y no incluía `adjuntos`: la respuesta se
   guardaba **sin el audio y sin ningún error**.
3. **Subir dos adjuntos seguidos perdía uno** (6 subidos, 5 guardados): la lista se
   armaba desde el valor del render del clic.
4. **El filtro descartaba respuestas SIN TEXTO** — una que fuera solo audio
   desaparecía.

### El orden manda

> «debe respetar el orden en el que cargué los adjuntos»

WhatsApp entrega cada adjunto como un mensaje aparte ⇒ el orden de carga es el que
ve el cliente. Por eso `respuestas_rapidas.adjuntos` es **una sola lista ordenada**:
dos columnas no pueden expresar "foto, audio, foto". Los audios **no** van en
`imagenes` (la lee IND).

---

## Estado al cerrar el 21-ago

| | MANDI | IND |
|---|---|---|
| Bandeja por canal | ✅ producción | ❌ **sigue con el modelo viejo** |
| Guardia de ventana por canal | ✅ | ❌ |
| Aviso de entregas fallidas | ✅ | ❌ **y es lo que más falta** |
| Notas de voz + respuestas con audio | ✅ | ✅ |

## Lo que sigue

1. **Portar el aviso de fallidos a IND.** Manda ~28.690 salientes al mes y nadie se
   entera si uno muere. La rpc ya funciona para `cuenta='IND'`. ⚠️ Acordarse del
   `matcher` y de portar la prueba que lo vigila.
2. **Migrar IND a `bandeja`.** Cuando toque: sembrar fresco y **decidir la regla del
   estado mirando SUS números** — la siembra que se usó en MANDI le convertía sus
   pendientes, y esas filas ya se borraron a propósito para no dejar datos
   inventados esperando.
3. **Quitar la escritura doble de `conversaciones.estado`** solo cuando IND ya lea
   `bandeja`.
4. Menores: archivar es ahora **por conversación** (archivas MANDI y el cliente
   sigue en REPUBLIC); quedan 6 mensajes viejos sin `phone_id` que podrían dar una
   tercera fila fantasma.
